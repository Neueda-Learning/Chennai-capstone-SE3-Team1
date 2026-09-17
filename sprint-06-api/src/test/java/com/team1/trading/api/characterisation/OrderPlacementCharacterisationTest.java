package com.team1.trading.api.characterisation;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.eventbus.Envelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Characterisation tests that pin the Sprint 7 order placement path: an accepted order is
 * written at {@code NEW}, answered {@code NEW} with message "Order accepted", and an
 * {@link Envelope} wrapping the {@code ORDER_PLACED} payload is published to the {@code orders}
 * Kafka topic keyed by the account.
 *
 * <p>The observations they deliberately freeze are:
 *
 * <ul>
 *   <li>an accepted order answers HTTP 200 with status {@code NEW}, message "Order accepted";</li>
 *   <li>the order row stores {@code client_id = account_id}, {@code order_type = POSITION},
 *       {@code status = NEW}, a null {@code executed_price}, the submitted limit price and a null
 *       {@code external_order_id};</li>
 *   <li>the placement moves no cash and writes no position books: the wallet and version are
 *       untouched and no {@code portfolio_positions} / {@code portfolio_holding} row appears;</li>
 *   <li>the event is delivered to the {@code orders} topic, keyed by the account id, wrapped in
 *       the shared five-field envelope ({@code eventId}, {@code eventType}, {@code eventTime},
 *       {@code source}, {@code schemaVersion}) whose payload carries the order id, symbol, side,
 *       quantity, limit price, the idempotency key and a created-on timestamp;</li>
 *   <li>an unaffordable buy answers ORD-400, an unknown symbol INS-404, an inactive account
 *       ACC-403, and none of them write an order or publish an event;</li>
 *   <li>a reused idempotency key answers ORD-409, writes nothing twice and publishes nothing
 *       again.</li>
 * </ul>
 *
 * <p>These pins changed together with the Sprint 7 source change (the previous baseline pinned
 * a synchronous FILLED, a cash debit and a started position), and again when the JIRA-3 producer
 * was wrapped in the envelope. The Kafka template is a mock - the pin is about what is sent and
 * when, not about a broker.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ContextConfiguration(initializers = PostgresCharactDbInitializer.class)
@TestPropertySource(properties = {
        "jwt.secret=" + OrderPlacementCharacterisationTest.TEST_SECRET,
        "jwt.issuer=auth-service"
})
class OrderPlacementCharacterisationTest {

    static final String TEST_SECRET = "characterisation-test-secret-for-sprint-7-only";

    private static final String ORDERS_TOPIC = "orders";

    private static final BigDecimal ONE_HUNDRED = new BigDecimal("100.00");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private KafkaTemplate<String, Envelope> kafkaTemplate;

    private String tokenAccountOne;
    private String tokenAccountTwo;
    private String tokenAccountThree;
    private String tokenAccountFive;

    @BeforeEach
    void mintTokens() {
        tokenAccountOne = tokenFor(1L);
        tokenAccountTwo = tokenFor(2L);
        tokenAccountThree = tokenFor(3L);
        tokenAccountFive = tokenFor(5L);
        clearInvocations(kafkaTemplate);
    }

    @Test
    @DisplayName("Pinned: an affordable order answers each response field, status NEW")
    void pinAcceptedOrderResponseFieldByField() throws Exception {
        String idempotencyKey = "charact-1-pin-response-fields-0001";

        MvcResult result = postOrder(tokenAccountTwo,
                requestBody(2L, "INFY", "BUY", 10, "100.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).as("HTTP status").isEqualTo(200);
        JsonNode body = bodyOf(result);
        assertThat(body.path("orderId").asText()).startsWith("ORD-");
        assertThat(body.path("orderId").asText()).hasSize("ORD-".length() + 36);
        assertThat(body.path("status").asText()).as("pinned status").isEqualTo("NEW");
        assertThat(body.path("message").asText()).as("pinned message").isEqualTo("Order accepted");
        assertThat(body.path("symbol").asText()).isEqualTo("INFY");
        assertThat(body.path("side").asText()).isEqualTo("BUY");
        assertThat(body.path("quantity").asInt()).isEqualTo(10);
        assertThat(body.path("price").decimalValue()).isEqualByComparingTo(ONE_HUNDRED);
    }

    @Test
    @DisplayName("Pinned: an accepted order writes a NEW row and moves neither cash nor positions")
    void pinAcceptedOrderWritesNewRowAndNothingElse() throws Exception {
        String idempotencyKey = "charact-2-pin-db-writes-0002";

        MvcResult result = postOrder(tokenAccountThree,
                requestBody(3L, "INFY", "BUY", 5, "100.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        UUID orderUuid = orderUuidFrom(result);

        Map<String, Object> order = jdbc.queryForMap(
                "SELECT client_id, account_id, instrument_id, order_type, side, quantity, "
                        + "price, executed_price, status, idempotency_key, external_order_id "
                        + "FROM orders WHERE order_id = ?",
                orderUuid);
        assertThat(order.get("client_id")).isEqualTo(3L);
        assertThat(order.get("account_id")).isEqualTo(3L);
        assertThat(order.get("instrument_id")).isEqualTo("INFY");
        assertThat(order.get("order_type")).isEqualTo("HOLDING");
        assertThat(order.get("side")).isEqualTo("BUY");
        assertThat(number(order.get("quantity"))).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(number(order.get("price"))).isEqualByComparingTo(ONE_HUNDRED);
        assertThat(order.get("executed_price")).as("no execution price until the executor fills")
                .isNull();
        assertThat(order.get("status")).isEqualTo("NEW");
        assertThat(order.get("idempotency_key")).isEqualTo(idempotencyKey);
        assertThat(order.get("external_order_id")).isNull();

        Map<String, Object> client = jdbc.queryForMap(
                "SELECT wallet_balance, version FROM clients WHERE client_id = 3");
        assertThat(number(client.get("wallet_balance"))).isEqualByComparingTo(new BigDecimal("310400.75"));
        assertThat(((Number) client.get("version")).intValue()).isEqualTo(0);

        assertThat(positionCount(3L, "portfolio_positions")).as("no position book row").isZero();
        assertThat(positionCount(3L, "portfolio_holding")).as("no holdings row").isZero();
    }

    @Test
    @DisplayName("Pinned: an accepted order publishes ORDER_PLACED to the orders topic keyed by the account")
    void pinOrderPlacedPublishedKeyedByAccount() throws Exception {
        String idempotencyKey = "charact-2b-pin-event-0012";

        MvcResult result = postOrder(tokenAccountTwo,
                requestBody(2L, "INFY", "BUY", 10, "100.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        String orderUuid = orderUuidFrom(result).toString();

        ArgumentCaptor<Envelope> envelopeCaptor = ArgumentCaptor.forClass(Envelope.class);
        verify(kafkaTemplate).send(eq(ORDERS_TOPIC), eq("2"), envelopeCaptor.capture());

        Envelope envelope = envelopeCaptor.getValue();
        assertThat(envelope.eventType()).isEqualTo("ORDER_PLACED");
        assertThat(envelope.source()).isEqualTo("trade-api");
        assertThat(envelope.schemaVersion()).isEqualTo(1);
        assertThat(envelope.eventId()).isNotNull();
        assertThat(envelope.eventTime()).isNotNull();

        JsonNode payload = envelope.payload();
        assertThat(payload.path("orderId").asText()).isEqualTo(orderUuid);
        assertThat(payload.path("accountId").asLong()).isEqualTo(2L);
        assertThat(payload.path("symbol").asText()).isEqualTo("INFY");
        assertThat(payload.path("side").asText()).isEqualTo("BUY");
        assertThat(payload.path("quantity").asInt()).isEqualTo(10);
        assertThat(payload.path("price").decimalValue()).isEqualByComparingTo(ONE_HUNDRED);
        assertThat(payload.path("idempotencyKey").asText()).isEqualTo(idempotencyKey);
        assertThat(payload.path("createdOn").asText()).isNotBlank();
    }

    @Test
    @DisplayName("Pinned: a reused idempotency key answers ORD-409, debits nothing and publishes only once")
    void pinReusedIdempotencyKey() throws Exception {
        String idempotencyKey = "charact-3-pin-idempotency-0003";
        String request = requestBody(5L, "INFY", "BUY", 1, "50.00", idempotencyKey);

        MvcResult first = postOrder(tokenAccountFive, request);
        assertThat(first.getResponse().getStatus()).isEqualTo(200);
        assertThat(walletBalance(5L)).as("cash untouched by acceptance")
                .isEqualByComparingTo(new BigDecimal("92750.25"));

        MvcResult second = postOrder(tokenAccountFive, request);
        assertThat(second.getResponse().getStatus()).as("HTTP status").isEqualTo(409);
        JsonNode body = bodyOf(second);
        assertThat(body.path("errorCode").asText()).isEqualTo("ORD-409");
        assertThat(body.path("message").asText()).isEqualTo("Duplicate order");

        assertThat(walletBalance(5L)).as("no second cash move").isEqualByComparingTo(new BigDecimal("92750.25"));
        assertThat(ordersWithKey(idempotencyKey)).as("one order row only").isEqualTo(1);

        ArgumentCaptor<Envelope> envelopeCaptor = ArgumentCaptor.forClass(Envelope.class);
        verify(kafkaTemplate, times(1)).send(eq(ORDERS_TOPIC), eq("5"), envelopeCaptor.capture());
        assertThat(envelopeCaptor.getValue().payload().path("idempotencyKey").asText())
                .isEqualTo(idempotencyKey);
    }

    @Test
    @DisplayName("Pinned: an unaffordable buy answers ORD-400 and writes no order, no event")
    void pinUnaffordableBuy() throws Exception {
        String idempotencyKey = "charact-4-pin-unaffordable-0004";
        MvcResult result = postOrder(tokenAccountOne,
                requestBody(1L, "INFY", "BUY", 100, "2000.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        JsonNode body = bodyOf(result);
        assertThat(body.path("errorCode").asText()).isEqualTo("ORD-400");
        assertThat(body.path("message").asText()).isEqualTo("Insufficient funds");

        assertThat(ordersWithKey(idempotencyKey)).as("unaffordable buy writes no order row").isZero();
        verify(kafkaTemplate, never()).send(any(), any(), any());
    }

    @Test
    @DisplayName("Pinned: an unknown symbol answers INS-404 and writes no order, no event")
    void pinUnknownSymbol() throws Exception {
        String idempotencyKey = "charact-5-pin-unknown-sym-0005";
        MvcResult result = postOrder(tokenAccountOne,
                requestBody(1L, "UNKNOWNX", "BUY", 1, "10.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).isEqualTo(404);
        JsonNode body = bodyOf(result);
        assertThat(body.path("errorCode").asText()).isEqualTo("INS-404");
        assertThat(body.path("message").asText()).isEqualTo("Instrument not found");

        assertThat(ordersWithKey(idempotencyKey)).isZero();
        verify(kafkaTemplate, never()).send(any(), any(), any());
    }

    @Test
    @DisplayName("Pinned: an account that is not ACTIVE answers ACC-403 and writes no order, no event")
    void pinInactiveAccount() throws Exception {
        String idempotencyKey = "charact-6-pin-inactive-acct-0006";
        MvcResult result = postOrder(tokenFor(4L),
                requestBody(4L, "INFY", "BUY", 1, "10.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).isEqualTo(403);
        JsonNode body = bodyOf(result);
        assertThat(body.path("errorCode").asText()).isEqualTo("ACC-403");
        assertThat(body.path("message").asText()).isEqualTo("Account not active");

        assertThat(ordersWithKey(idempotencyKey)).isZero();
        verify(kafkaTemplate, never()).send(any(), any(), any());
    }

    private MvcResult postOrder(String token, String requestBody) throws Exception {
        return mockMvc.perform(post("/api/v1/orders")
                        .header("Authorization", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andReturn();
    }

    private String requestBody(Long accountId, String symbol, String side, int quantity,
                               String price, String idempotencyKey) {
        return """
                {"accountId":%d,"symbol":"%s","side":"%s","quantity":%d,"price":%s,"idempotencyKey":"%s"}
                """.formatted(accountId, symbol, side, quantity, price, idempotencyKey);
    }

    private JsonNode bodyOf(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private UUID orderUuidFrom(MvcResult result) throws Exception {
        String orderId = bodyOf(result).path("orderId").asText();
        assertThat(orderId).startsWith("ORD-");
        return UUID.fromString(orderId.substring("ORD-".length()));
    }

    private BigDecimal walletBalance(Long clientId) {
        return jdbc.queryForObject("SELECT wallet_balance FROM clients WHERE client_id = ?",
                BigDecimal.class, clientId);
    }

    private Integer ordersWithKey(String idempotencyKey) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM orders WHERE idempotency_key = ?", Integer.class, idempotencyKey);
        return count == null ? 0 : count;
    }

    private Integer positionCount(Long clientId, String table) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE client_id = ?", Integer.class, clientId);
        return count == null ? 0 : count;
    }

    private static BigDecimal number(Object value) {
        return value instanceof BigDecimal bd ? bd : new BigDecimal(String.valueOf(value));
    }

    private static String tokenFor(Long accountId) {
        Instant now = Instant.now();
        return "Bearer " + JWT.create()
                .withSubject("test-user-" + accountId)
                .withClaim("accountId", accountId)
                .withClaim("roles", java.util.List.of("CUSTOMER"))
                .withIssuedAt(now)
                .withExpiresAt(now.plus(15, ChronoUnit.MINUTES))
                .sign(Algorithm.HMAC256(TEST_SECRET));
    }
}