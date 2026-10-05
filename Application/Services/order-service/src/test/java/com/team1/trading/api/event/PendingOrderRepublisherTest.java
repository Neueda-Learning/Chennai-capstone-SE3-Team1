package com.team1.trading.api.event;

import com.team1.trading.api.mapper.OrderMapper;
import com.team1.trading.api.mapper.OrderMapper.OrderRow;
import com.team1.trading.domain.entity.types.OrderSide;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PendingOrderRepublisherTest {

    private final OrderMapper orderMapper = mock(OrderMapper.class);
    private final KafkaOrderEventPublisher publisher = mock(KafkaOrderEventPublisher.class);
    private final PendingOrderRepublisher republisher =
            new PendingOrderRepublisher(orderMapper, publisher, 3, 1, 1000);

    private static OrderRow row(String uuid) {
        OrderRow row = new OrderRow();
        row.setOrderUuid(uuid);
        row.setAccountId(7L);
        row.setClientId(7L);
        row.setSymbol("INFY");
        row.setSide(OrderSide.BUY);
        row.setQuantity(5);
        row.setPrice(new BigDecimal("1500.00"));
        row.setIdempotencyKey("key-" + uuid);
        row.setCreatedAt(LocalDateTime.of(2026, 10, 5, 9, 30));
        return row;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static CompletableFuture ok() {
        return CompletableFuture.completedFuture(null);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static CompletableFuture failed() {
        return CompletableFuture.failedFuture(new IllegalStateException("broker down"));
    }

    @Test
    @DisplayName("every NEW order is sent again, with the fields it was placed with")
    @SuppressWarnings("unchecked")
    void resendsPendingOrders() {
        when(orderMapper.findNew()).thenReturn(List.of(row("a"), row("b")));
        when(publisher.send(any())).thenReturn(ok());

        republisher.republishPending();

        ArgumentCaptor<OrderPlacedEvent> sent = ArgumentCaptor.forClass(OrderPlacedEvent.class);
        verify(publisher, times(2)).send(sent.capture());
        assertThat(sent.getAllValues()).extracting(OrderPlacedEvent::orderUuid).containsExactly("a", "b");
        OrderPlacedEvent first = sent.getAllValues().get(0);
        assertThat(first.symbol()).isEqualTo("INFY");
        assertThat(first.side()).isEqualTo(OrderSide.BUY);
        assertThat(first.quantity()).isEqualTo(5);
        assertThat(first.idempotencyKey()).isEqualTo("key-a");
    }

    @Test
    @DisplayName("nothing pending sends nothing")
    void nothingPending() {
        when(orderMapper.findNew()).thenReturn(List.of());

        republisher.republishPending();

        verify(publisher, never()).send(any());
    }

    @Test
    @DisplayName("an order the broker refused is retried, and one already sent is not sent twice")
    @SuppressWarnings("unchecked")
    void retriesOnlyWhatFailed() {
        when(orderMapper.findNew()).thenReturn(List.of(row("a"), row("b")));
        when(publisher.send(any()))
                .thenReturn(ok())
                .thenReturn(failed())
                .thenReturn(ok());

        republisher.republishPending();

        verify(publisher, times(3)).send(any());
    }

    @Test
    @DisplayName("gives up after the configured attempts instead of looping forever")
    @SuppressWarnings("unchecked")
    void givesUp() {
        when(orderMapper.findNew()).thenReturn(List.of(row("a")));
        when(publisher.send(any())).thenReturn(failed());

        republisher.republishPending();

        verify(publisher, times(3)).send(any());
    }
}
