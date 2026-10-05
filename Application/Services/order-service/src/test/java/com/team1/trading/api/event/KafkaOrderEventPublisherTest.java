package com.team1.trading.api.event;

import com.fasterxml.jackson.databind.JsonNode;
import com.team1.eventbus.Envelope;
import com.team1.trading.api.dto.OrderResponse;
import com.team1.trading.api.service.OrderService;
import com.team1.trading.domain.dto.PlaceOrderRequest;
import com.team1.trading.domain.entity.types.OrderSide;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Pins the delivery guarantee the Sprint 7 ticket demands: {@code ORDER_PLACED} is published to
 * the {@code orders} Kafka topic only after the transaction that wrote the order has committed,
 * never from inside it, and a request that fails validation publishes nothing.
 *
 * <p>A full Spring context (H2 in memory, the {@code test} profile) is used so the
 * {@link KafkaOrderEventPublisher} listener is registered against the real transaction manager.
 * The {@code KafkaTemplate} is a mock: no broker is needed, the pin is about when the send happens.
 */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:ordereventctx;DB_CLOSE_DELAY=-1")
class KafkaOrderEventPublisherTest {

    private static final String TOPIC = "orders";

    @Autowired
    private OrderService orderService;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @MockitoBean
    private KafkaTemplate<String, Envelope> kafkaTemplate;

    @Test
    @DisplayName("ORDER_PLACED is not sent inside the transaction, and is sent once the commit is done")
    void publishesOnlyAfterCommit() {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        AtomicReference<OrderResponse> response = new AtomicReference<>();

        tx.executeWithoutResult(status -> {
            response.set(orderService.placeOrder(fundedBuy(), 1L));
            verify(kafkaTemplate, never()).send(any(), any(), any());
        });

        ArgumentCaptor<Envelope> captor = ArgumentCaptor.forClass(Envelope.class);
        verify(kafkaTemplate).send(eq(TOPIC), eq("1"), captor.capture());

        Envelope envelope = captor.getValue();
        assertThat(envelope.eventType()).isEqualTo("ORDER_PLACED");
        assertThat(envelope.source()).isEqualTo("trade-api");
        assertThat(envelope.schemaVersion()).isEqualTo(1);
        assertThat(envelope.eventId()).isNotNull();
        assertThat(envelope.eventTime()).isNotNull();

        JsonNode payload = envelope.payload();
        assertThat(payload.has("orderId")).isTrue();
        assertThat(payload.path("orderId").asText())
                .isEqualTo(response.get().getOrderId().substring("ORD-".length()));
        assertThat(payload.path("accountId").asLong()).isEqualTo(1L);
        assertThat(payload.path("symbol").asText()).isEqualTo("INFY");
        assertThat(payload.path("side").asText()).isEqualTo("BUY");
        assertThat(payload.path("quantity").asInt()).isEqualTo(10);
        assertThat(payload.path("price").decimalValue()).isEqualByComparingTo(new BigDecimal("100.00"));
        assertThat(payload.path("idempotencyKey").asText()).isNotBlank();
        assertThat(payload.path("createdOn").asText()).isNotBlank();
    }

    @Test
    @DisplayName("An order whose transaction rolls back is never published")
    void publishesNothingWhenRolledBack() {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);

        tx.executeWithoutResult(status -> {
            orderService.placeOrder(fundedBuy(), 1L);
            status.setRollbackOnly();
        });

        verify(kafkaTemplate, never()).send(any(), any(), any());
    }

    @Test
    @DisplayName("An order rejected by validation is never published")
    void publishesNothingOnValidationFailure() {
        PlaceOrderRequest invalid = new PlaceOrderRequest(1L, "INFY", OrderSide.BUY, 0,
                new BigDecimal("100.00"), "idempotency-" + UUID.randomUUID());

        try {
            orderService.placeOrder(invalid, 1L);
        } catch (RuntimeException expected) {
            // caller-visible rejection; the point of the test is that nothing is published
        }

        verify(kafkaTemplate, never()).send(any(), any(), any());
    }

    private PlaceOrderRequest fundedBuy() {
        return new PlaceOrderRequest(1L, "INFY", OrderSide.BUY, 10,
                new BigDecimal("100.00"), "idem-" + UUID.randomUUID());
    }
}