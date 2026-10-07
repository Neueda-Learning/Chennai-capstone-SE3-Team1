package com.team1.trading.api.conditional;

import com.team1.trading.api.dto.ConditionSpec;
import com.team1.trading.api.dto.ConditionalOrderRequest;
import com.team1.trading.api.dto.OrderResponse;
import com.team1.trading.api.dto.OrderStatusResponse;
import com.team1.trading.api.event.OrderPlacedEvent;
import com.team1.trading.api.service.OrderService;
import com.team1.trading.domain.dto.PlaceOrderRequest;
import com.team1.trading.domain.entity.types.ConditionType;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;
import com.team1.trading.domain.exception.AccountNotActiveException;
import com.team1.trading.domain.exception.DuplicateOrderException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:conditionalflow;DB_CLOSE_DELAY=-1")
@Import({OrderService.class, ConditionalOrderChecker.class, ConditionalOrderReleaser.class,
        ConditionalOrderQueries.class})
@RecordApplicationEvents
class ConditionalOrderFlowTest {

    @Autowired
    private OrderService orders;
    @Autowired
    private ConditionalOrderChecker checker;
    @Autowired
    private ConditionalOrderQueries queries;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private ApplicationEvents events;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM market_quotes");
        jdbc.update("DELETE FROM orders");
    }

    private void quote(String symbol, String price, boolean stale, LocalDateTime at) {
        jdbc.update("INSERT INTO market_quotes (instrument_id, price, stale, received_at) VALUES (?, ?, ?, ?)",
                symbol, new BigDecimal(price), stale, Timestamp.valueOf(at));
    }

    private void quotes(String symbol, String... prices) {
        LocalDateTime start = LocalDateTime.now().minusSeconds(prices.length * 60L);
        for (int i = 0; i < prices.length; i++) {
            quote(symbol, prices[i], false, start.plusSeconds(60L * (i + 1)));
        }
    }

    private OrderResponse place(ConditionSpec condition) {
        return place(condition, 30);
    }

    private OrderResponse place(ConditionSpec condition, Integer days) {
        return orders.placeConditionalOrder(new ConditionalOrderRequest(1L, "TCS", OrderSide.BUY, 2,
                new BigDecimal("3650.00"), "cond-" + UUID.randomUUID(), condition, days), 1L);
    }

    private static ConditionSpec below(String price) {
        return new ConditionSpec(ConditionType.PRICE_AT_OR_BELOW, new BigDecimal(price), null, null, null);
    }

    private Map<String, Object> row(OrderResponse response) {
        return jdbc.queryForMap("SELECT * FROM orders WHERE order_id = ?",
                UUID.fromString(response.getOrderId().substring(4)));
    }

    private long published() {
        return events.stream(OrderPlacedEvent.class).count();
    }

    @Test
    @DisplayName("A conditional order is held in orders as PENDING with its condition and is not sent to the executor")
    void heldAsPending() {
        OrderResponse response = place(below("3500"));

        assertThat(response.getStatus()).isEqualTo(OrderStatus.PENDING);
        assertThat(response.getMessage()).isEqualTo("Held until the price falls to 3500.00 or lower");
        Map<String, Object> row = row(response);
        assertThat(row.get("STATUS")).isEqualTo("PENDING");
        assertThat(row.get("CONDITION_TYPE")).isEqualTo("PRICE_AT_OR_BELOW");
        assertThat(row.get("EXPIRES_AT")).isNotNull();
        assertThat(published()).isZero();
    }

    @Test
    @DisplayName("When the poller sees the condition met it releases the order to NEW and publishes it")
    void releasedWhenMet() {
        OrderResponse response = place(below("3500"));
        quotes("TCS", "3520", "3498.50");

        ConditionalOrderChecker.Pass pass = checker.checkAll();

        assertThat(pass.released()).isEqualTo(1);
        Map<String, Object> row = row(response);
        assertThat(row.get("STATUS")).isEqualTo("NEW");
        assertThat(row.get("TRIGGER_REASON")).isEqualTo("Price 3498.50 fell to 3500.00");
        assertThat(row.get("TRIGGERED_AT")).isNotNull();
        assertThat(events.stream(OrderPlacedEvent.class))
                .singleElement()
                .satisfies(e -> {
                    assertThat(e.orderUuid()).isEqualTo(response.getOrderId().substring(4));
                    assertThat(e.price()).isEqualByComparingTo("3650.00");
                    assertThat(e.quantity()).isEqualTo(2);
                });

        assertThat(checker.checkAll().released()).as("a released order is not released again").isZero();
        assertThat(published()).isEqualTo(1);
    }

    @Test
    @DisplayName("Not met: the order stays PENDING and records when it was checked")
    void notMetStaysPending() {
        OrderResponse response = place(below("3500"));
        quotes("TCS", "3520", "3510");

        ConditionalOrderChecker.Pass pass = checker.checkAll();

        assertThat(pass.checked()).isEqualTo(1);
        assertThat(pass.released()).isZero();
        assertThat(row(response).get("STATUS")).isEqualTo("PENDING");
        assertThat(row(response).get("LAST_CHECKED_AT")).isNotNull();
        assertThat(published()).isZero();
    }

    @Test
    @DisplayName("A stale or old quote is never acted on, even when it would meet the condition")
    void staleOrOldQuoteIgnored() {
        OrderResponse response = place(below("3500"));
        quote("TCS", "3400", true, LocalDateTime.now());

        assertThat(checker.checkAll().skippedNoQuote()).isEqualTo(1);
        jdbc.update("DELETE FROM market_quotes");
        quote("TCS", "3400", false, LocalDateTime.now().minusHours(2));
        assertThat(checker.checkAll().skippedNoQuote()).isEqualTo(1);

        assertThat(row(response).get("STATUS")).isEqualTo("PENDING");
        assertThat(published()).isZero();
    }

    @Test
    @DisplayName("A crossover waits for the averages to cross after it is placed")
    void crossoverWaitsForACrossing() {
        OrderResponse response = place(new ConditionSpec(ConditionType.MA_CROSS_ABOVE, null, 2, 4, null));
        quotes("TCS", "100", "100", "99", "98");

        checker.checkAll();
        assertThat(row(response).get("CONDITION_STATE")).isEqualTo("BELOW");

        jdbc.update("DELETE FROM market_quotes");
        quotes("TCS", "98", "98", "101", "104");
        assertThat(checker.checkAll().released()).isEqualTo(1);
        assertThat((String) row(response).get("TRIGGER_REASON")).contains("crossed above");
    }

    @Test
    @DisplayName("An order past its expiry is moved to history as CANCELLED, external status EXPIRED")
    void expires() {
        OrderResponse response = place(below("3500"), 1);
        String uuid = response.getOrderId().substring(4);
        jdbc.update("UPDATE orders SET expires_at = ? WHERE order_id = ?",
                Timestamp.valueOf(LocalDateTime.now().minusMinutes(1)), UUID.fromString(uuid));

        assertThat(checker.checkAll().expired()).isEqualTo(1);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders", Integer.class)).isZero();
        Map<String, Object> history = jdbc.queryForMap(
                "SELECT * FROM order_history WHERE order_id = ?", UUID.fromString(uuid));
        assertThat(history.get("PREVIOUS_STATUS")).isEqualTo("PENDING");
        assertThat(history.get("NEW_STATUS")).isEqualTo("CANCELLED");
        assertThat(history.get("EXTERNAL_STATUS")).isEqualTo("EXPIRED");
        assertThat(orders.getOrder(response.getOrderId(), 1L).status()).isEqualTo(OrderStatus.CANCELLED);
    }

    @Test
    @DisplayName("The customer can cancel a PENDING order; it is archived with its previous status")
    void cancelPending() {
        OrderResponse response = place(below("3500"));

        assertThat(orders.cancel(response.getOrderId(), 1L).getStatus()).isEqualTo(OrderStatus.CANCELLED);
        assertThat(jdbc.queryForObject("SELECT previous_status FROM order_history WHERE order_id = ?", String.class,
                UUID.fromString(response.getOrderId().substring(4)))).isEqualTo("PENDING");
        quotes("TCS", "3400");
        assertThat(checker.checkAll().released()).isZero();
    }

    @Test
    @DisplayName("Order status shows a pending order with its condition; another account is refused")
    void status() {
        OrderResponse response = place(below("3500"));
        quotes("TCS", "3520");
        checker.checkAll();

        OrderStatusResponse status = orders.getOrder(response.getOrderId(), 1L);
        assertThat(status.status()).isEqualTo(OrderStatus.PENDING);
        assertThat(status.condition().description()).isEqualTo("when the price falls to 3500.00 or lower");
        assertThat(status.condition().lastCheckedAt()).isNotNull();
        assertThatThrownBy(() -> orders.getOrder(response.getOrderId(), 2L))
                .isInstanceOf(AccountNotActiveException.class);

        assertThat(queries.pending(1L)).singleElement()
                .satisfies(p -> assertThat(p.condition()).contains("3500.00"));
        assertThat(queries.pending(2L)).isEmpty();
    }

    @Test
    @DisplayName("Placement runs the ordinary order checks: token account, duplicate key")
    void ordinaryChecksApply() {
        ConditionalOrderRequest other = new ConditionalOrderRequest(1L, "TCS", OrderSide.BUY, 2,
                new BigDecimal("3650.00"), "cond-other-account", below("3500"), 30);
        assertThatThrownBy(() -> orders.placeConditionalOrder(other, 2L)).isInstanceOf(AccountNotActiveException.class);

        ConditionalOrderRequest first = new ConditionalOrderRequest(1L, "TCS", OrderSide.BUY, 2,
                new BigDecimal("3650.00"), "cond-same-key", below("3500"), 30);
        orders.placeConditionalOrder(first, 1L);
        assertThatThrownBy(() -> orders.placeConditionalOrder(first, 1L)).isInstanceOf(DuplicateOrderException.class);
    }

    @Test
    @DisplayName("A condition missing what it needs is COND-422")
    void invalidCondition() {
        assertThatThrownBy(() -> place(new ConditionSpec(ConditionType.MA_CROSS_ABOVE, null, 20, 5, null)))
                .isInstanceOf(ConditionInvalidException.class);
        assertThatThrownBy(() -> place(new ConditionSpec(ConditionType.PRICE_AT_OR_ABOVE, null, null, null, null)))
                .isInstanceOf(ConditionInvalidException.class);
    }

    @Test
    @DisplayName("An account can have at most 25 conditional orders waiting")
    void cap() {
        for (int i = 0; i < OrderService.MAX_PENDING_CONDITIONAL; i++) {
            place(below("3500"));
        }
        assertThatThrownBy(() -> place(below("3500"))).isInstanceOf(ConditionalOrderLimitException.class);
    }

    @Test
    @DisplayName("An ordinary order is unchanged: NEW, published at once, no condition")
    void ordinaryOrderUnchanged() {
        OrderResponse response = orders.placeOrder(new PlaceOrderRequest(1L, "TCS", OrderSide.BUY, 1,
                new BigDecimal("3650.00"), "plain-" + UUID.randomUUID()), 1L);

        assertThat(response.getStatus()).isEqualTo(OrderStatus.NEW);
        assertThat(published()).isEqualTo(1);
        assertThat(orders.getOrder(response.getOrderId(), 1L).condition()).isNull();
    }
}
