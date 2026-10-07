package com.team1.trading.api.conditional;

import com.team1.trading.api.conditional.ConditionalOrderMapper.PendingRow;
import com.team1.trading.api.event.OrderPlacedEvent;
import com.team1.trading.domain.entity.types.OrderSide;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * The two writes that end a PENDING order's wait, each in its own transaction.
 *
 * release publishes the same OrderPlacedEvent placeOrder publishes, and through the same after-commit
 * listener, so from here on the order is indistinguishable from one the customer just placed: the executor
 * fills or rejects it, and if the broker is down the row is NEW and the startup republisher resends it.
 */
@Component
public class ConditionalOrderReleaser {

    private final ConditionalOrderMapper mapper;
    private final ApplicationEventPublisher events;

    public ConditionalOrderReleaser(ConditionalOrderMapper mapper, ApplicationEventPublisher events) {
        this.mapper = mapper;
        this.events = events;
    }

    /** Returns false when the order was cancelled or released a moment ago and nothing was done. */
    @Transactional
    public boolean release(PendingRow order, String reason, LocalDateTime now) {
        String trimmed = reason.length() > 300 ? reason.substring(0, 300) : reason;
        if (mapper.release(order.getOrderUuid(), trimmed, now) == 0) {
            return false;
        }
        events.publishEvent(OrderPlacedEvent.of(order.getOrderUuid(), order.getAccountId(), order.getSymbol(),
                OrderSide.valueOf(order.getSide()), order.getQuantity(), order.getPrice(),
                order.getIdempotencyKey(), order.getCreatedAt()));
        return true;
    }

    /** Moves an expired PENDING order to order_history as CANCELLED, external status EXPIRED. */
    @Transactional
    public boolean expire(PendingRow order) {
        if (mapper.deletePending(order.getOrderUuid()) == 0) {
            return false;
        }
        mapper.archiveExpired(order);
        return true;
    }
}
