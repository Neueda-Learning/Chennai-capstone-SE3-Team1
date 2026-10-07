package com.team1.trading.domain.entity;

import com.team1.trading.domain.entity.types.ConditionType;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;
import com.team1.trading.domain.entity.types.OrderType;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConditionalOrderTest {

    private static Order order() {
        return new Order(1L, 1L, "TCS", OrderType.HOLDING, OrderSide.BUY, BigDecimal.TEN,
                new BigDecimal("3600"), "idem-key-123");
    }

    private static LocalDateTime later() {
        return LocalDateTime.now().plusDays(7);
    }

    @Test
    void anOrdinaryOrderHasNoCondition() {
        Order order = order();
        assertFalse(order.isConditional());
        assertEquals(OrderStatus.NEW, order.getStatus());
    }

    @Test
    void aHeldOrderIsPendingWithItsConditionAndOnlyTheParametersItNeeds() {
        Order order = order();
        order.holdUntil(ConditionType.PRICE_AT_OR_BELOW, new BigDecimal("3500"), 5, 20, BigDecimal.ONE, later());

        assertEquals(OrderStatus.PENDING, order.getStatus());
        assertTrue(order.isConditional());
        assertEquals(new BigDecimal("3500"), order.getTriggerPrice());
        assertNull(order.getShortWindow());
        assertNull(order.getLongWindow());
        assertNull(order.getBandWidth());
    }

    @Test
    void releaseMovesPendingToNewAndRecordsWhy() {
        Order order = order();
        order.holdUntil(ConditionType.MA_CROSS_ABOVE, null, 5, 20, null, later());
        order.release("5-quote average crossed above the 20-quote average");

        assertEquals(OrderStatus.NEW, order.getStatus());
        assertNotNull(order.getTriggeredAt());
        assertEquals("5-quote average crossed above the 20-quote average", order.getTriggerReason());
    }

    @Test
    void aShortWindowOfOneIsThePriceCrossingItsAverage() {
        Order order = order();
        order.holdUntil(ConditionType.MA_CROSS_BELOW, null, 1, 20, null, later());
        assertEquals(1, order.getShortWindow());
        assertThrows(IllegalArgumentException.class,
                () -> order().holdUntil(ConditionType.MA_CROSS_ABOVE, null, 0, 20, null, later()));
    }

    @Test
    void onlyAPendingOrderIsReleased() {
        assertThrows(IllegalStateException.class, () -> order().release("why"));
    }

    @Test
    void aPendingOrderCanBeCancelled() {
        Order order = order();
        order.holdUntil(ConditionType.BOLLINGER_BELOW_LOWER, null, null, 20, new BigDecimal("2"), later());
        order.cancel();
        assertEquals(OrderStatus.CANCELLED, order.getStatus());
    }

    @Test
    void missingParametersAreRefused() {
        assertThrows(IllegalArgumentException.class,
                () -> order().holdUntil(ConditionType.PRICE_AT_OR_ABOVE, null, null, null, null, later()));
        assertThrows(IllegalArgumentException.class,
                () -> order().holdUntil(ConditionType.MA_CROSS_BELOW, null, 20, 20, null, later()));
        assertThrows(IllegalArgumentException.class,
                () -> order().holdUntil(ConditionType.BOLLINGER_ABOVE_UPPER, null, null, 20, null, later()));
        assertThrows(IllegalArgumentException.class,
                () -> order().holdUntil(ConditionType.PRICE_AT_OR_ABOVE, BigDecimal.ONE, null, null, null,
                        LocalDateTime.now().minusDays(1)));
    }
}
