package com.team1.trading.api.characterisation;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Characterisation tests that pin the Sprint 6 order placement path as it behaves TODAY,
 * before the Sprint 7 change (NEW + Kafka publish) touches any source.
 *
 * <p>These tests record what the Sprint 6 service does, not what it should do. The
 * observations they deliberately freeze are:
 *
 * <ul>
 *   <li>an accepted order is synchronously FILLED and the response is HTTP 200,
 *       message "Order executed" (not 201, not "accepted", not NEW);</li>
 *   <li>the order row stores {@code client_id = account_id}, {@code order_type = POSITION},
 *       {@code status = FILLED} and an {@code executed_price} equal to the submitted limit,
 *       and a null {@code external_order_id};</li>
 *   <li>the cash move is not a naive subtraction: the position upsert overwrites
 *       {@code price_per_unit} with the new price rather than a true weighted average,
 *       and the sell path would leave it unchanged;</li>
 *   <li>an unaffordable buy answers ORD-400 before writing anything, and a reused
 *       idempotency key answers ORD-409 and writes nothing twice.</li>
 * </ul>
 *
 * <p>Any of these pins that the Sprint 7 change deliberately alters must be updated in the
 * same commit as the source change, and the commit message must say so.
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

    private static final BigDecimal ONE_HUNDRED = new BigDecimal("100.00");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ObjectMapper objectMapper;

    private String tokenAccountOne;
    private String tokenAccountTwo;
    private String tokenAccountThree;
    private String tokenAccountFour;
    private String tokenAccountFive;

    @BeforeEach
    void mintTokens() {
        tokenAccountOne = tokenFor(1L);
        tokenAccountTwo = tokenFor(2L);
        tokenAccountThree = tokenFor(3L);
        tokenAccountFour = tokenFor(4L);
        tokenAccountFive = tokenFor(5L);
    }

    @Test
    @DisplayName("Pinned: an affordable order answers each response field, status FILLED")
    void pinAcceptedOrderResponseFieldByField() throws Exception {
        String idempotencyKey = "charact-1-pin-response-fields-0001";

        MvcResult result = postOrder(tokenAccountTwo,
                requestBody(2L, "INFY", "BUY", 10, "100.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).as("HTTP status").isEqualTo(200);
        JsonNode body = bodyOf(result);
        assertThat(body.path("orderId").asText()).startsWith("ORD-");
        assertThat(body.path("orderId").asText()).hasSize("ORD-".length() + 36);
        assertThat(body.path("status").asText()).as("pinned status").isEqualTo("FILLED");
        assertThat(body.path("message").asText()).as("pinned message").isEqualTo("Order executed");
        assertThat(body.path("symbol").asText()).isEqualTo("INFY");
        assertThat(body.path("side").asText()).isEqualTo("BUY");
        assertThat(body.path("quantity").asInt()).isEqualTo(10);
        assertThat(body.path("price").decimalValue()).isEqualByComparingTo(ONE_HUNDRED);
    }

    @Test
    @DisplayName("Pinned: an accepted order writes the order row, the cash and the two position books")
    void pinOrderRowCashAndPosition() throws Exception {
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
        assertThat(order.get("order_type")).isEqualTo("POSITION");
        assertThat(order.get("side")).isEqualTo("BUY");
        assertThat(number(order.get("quantity"))).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(number(order.get("price"))).isEqualByComparingTo(ONE_HUNDRED);
        assertThat(number(order.get("executed_price"))).isEqualByComparingTo(ONE_HUNDRED);
        assertThat(order.get("status")).isEqualTo("FILLED");
        assertThat(order.get("idempotency_key")).isEqualTo(idempotencyKey);
        assertThat(order.get("external_order_id")).isNull();

        Map<String, Object> client = jdbc.queryForMap(
                "SELECT wallet_balance, version FROM clients WHERE client_id = 3");
        assertThat(number(client.get("wallet_balance"))).isEqualByComparingTo(new BigDecimal("309900.75"));
        assertThat(((Number) client.get("version")).intValue()).isEqualTo(1);

        Map<String, Object> position = jdbc.queryForMap(
                "SELECT quantity, price_per_unit FROM portfolio_positions "
                        + "WHERE client_id = 3 AND instrument_id = 'INFY'");
        assertThat(number(position.get("quantity"))).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(number(position.get("price_per_unit"))).isEqualByComparingTo(ONE_HUNDRED);

        Map<String, Object> holding = jdbc.queryForMap(
                "SELECT quantity, price_per_unit FROM portfolio_holding "
                        + "WHERE client_id = 3 AND instrument_id = 'INFY'");
        assertThat(number(holding.get("quantity"))).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(number(holding.get("price_per_unit"))).isEqualByComparingTo(ONE_HUNDRED);
    }

    @Test
    @DisplayName("Pinned: a reused idempotency key answers ORD-409 and debits cash only once")
    void pinReusedIdempotencyKey() throws Exception {
        String idempotencyKey = "charact-3-pin-idempotency-0003";
        String request = requestBody(5L, "INFY", "BUY", 1, "50.00", idempotencyKey);

        MvcResult first = postOrder(tokenAccountFive, request);
        assertThat(first.getResponse().getStatus()).isEqualTo(200);
        BigDecimal balanceAfterFirst = walletBalance(5L);
        assertThat(balanceAfterFirst).isEqualByComparingTo(new BigDecimal("92700.25"));

        MvcResult second = postOrder(tokenAccountFive, request);
        assertThat(second.getResponse().getStatus()).as("HTTP status").isEqualTo(409);
        JsonNode body = bodyOf(second);
        assertThat(body.path("errorCode").asText()).isEqualTo("ORD-409");
        assertThat(body.path("message").asText()).isEqualTo("Duplicate order");

        assertThat(walletBalance(5L)).as("no second debit").isEqualByComparingTo(balanceAfterFirst);
    }

    @Test
    @DisplayName("Pinned: an unaffordable buy answers ORD-400 and writes no order")
    void pinUnaffordableBuy() throws Exception {
        String idempotencyKey = "charact-4-pin-unaffordable-0004";
        MvcResult result = postOrder(tokenAccountOne,
                requestBody(1L, "INFY", "BUY", 100, "2000.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        JsonNode body = bodyOf(result);
        assertThat(body.path("errorCode").asText()).isEqualTo("ORD-400");
        assertThat(body.path("message").asText()).isEqualTo("Insufficient funds");

        assertThat(ordersWithKey(idempotencyKey)).as("unaffordable buy writes no order row").isZero();
    }

    @Test
    @DisplayName("Pinned: an unknown symbol answers INS-404 and writes no order")
    void pinUnknownSymbol() throws Exception {
        String idempotencyKey = "charact-5-pin-unknown-sym-0005";
        MvcResult result = postOrder(tokenAccountOne,
                requestBody(1L, "UNKNOWNX", "BUY", 1, "10.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).isEqualTo(404);
        JsonNode body = bodyOf(result);
        assertThat(body.path("errorCode").asText()).isEqualTo("INS-404");
        assertThat(body.path("message").asText()).isEqualTo("Instrument not found");

        assertThat(ordersWithKey(idempotencyKey)).isZero();
    }

    @Test
    @DisplayName("Pinned: an account that is not ACTIVE answers ACC-403 and writes no order")
    void pinInactiveAccount() throws Exception {
        String idempotencyKey = "charact-6-pin-inactive-acct-0006";
        MvcResult result = postOrder(tokenAccountFour,
                requestBody(4L, "INFY", "BUY", 1, "10.00", idempotencyKey));

        assertThat(result.getResponse().getStatus()).isEqualTo(403);
        JsonNode body = bodyOf(result);
        assertThat(body.path("errorCode").asText()).isEqualTo("ACC-403");
        assertThat(body.path("message").asText()).isEqualTo("Account not active");

        assertThat(ordersWithKey(idempotencyKey)).isZero();
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