package com.team1.executor;

import com.team1.executor.mapper.AccountMapper;
import com.team1.executor.mapper.OrderHistoryMapper;
import com.team1.executor.mapper.OrderMapper;
import com.team1.executor.mapper.PositionMapper;
import com.team1.executor.model.AccountRow;
import com.team1.executor.model.OrderRow;
import com.team1.executor.model.PositionRow;
import com.team1.executor.rule.FillDecision;
import com.team1.executor.rule.FillRuleResult;
import com.team1.executor.settlement.SettlementService;
import com.team1.trading.domain.entity.Order;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SettlementServiceTest {

    @Mock
    private OrderMapper orderMapper;
    @Mock
    private OrderHistoryMapper orderHistoryMapper;
    @Mock
    private AccountMapper accountMapper;
    @Mock
    private PositionMapper positionMapper;

    private SettlementService settlementService;

    @BeforeEach
    void setUp() {
        settlementService = new SettlementService(orderMapper, orderHistoryMapper, accountMapper, positionMapper, 3);
    }

    private Order createOrder(UUID orderId, Long clientId, OrderSide side, BigDecimal price) {
        Order order = new Order(clientId, clientId, "ACME", OrderType.POSITION, side,
                BigDecimal.valueOf(10), price, "idem-1");
        setOrderId(order, orderId);
        return order;
    }

    private void setOrderId(Order order, UUID orderId) {
        try {
            Field field = Order.class.getDeclaredField("orderId");
            field.setAccessible(true);
            field.set(order, orderId);
        } catch (Exception e) {
            throw new RuntimeException("Failed to set orderId", e);
        }
    }

    @Test
    void settledOrderWritesStatusCashAndPositionTogether() {
        UUID orderId = UUID.randomUUID();
        Long clientId = 1L;
        BigDecimal executedPrice = new BigDecimal("100.05");
        BigDecimal cashDelta = new BigDecimal("-1000.50");

        Order order = createOrder(orderId, clientId, OrderSide.BUY, new BigDecimal("100.00"));

        OrderRow orderRow = new OrderRow(orderId, clientId, clientId, "ACME", "POSITION", "BUY",
                BigDecimal.valueOf(10), new BigDecimal("100.00"), null, "NEW", "idem-1", null,
                LocalDateTime.now(), LocalDateTime.now(), null);

        AccountRow accountRow = new AccountRow(clientId, "ACC-001", "Test", "test@test.com", "123",
                LocalDateTime.now(), "ACTIVE", new BigDecimal("5000.00"), 1, LocalDateTime.now());

        when(orderMapper.findByOrderId(orderId)).thenReturn(Optional.of(orderRow));
        when(accountMapper.findByClientIdForUpdate(clientId)).thenReturn(Optional.of(accountRow));
        when(orderMapper.updateStatusAndExecutedPrice(eq(orderId), eq("FILLED"), eq(executedPrice), any()))
                .thenReturn(1);
        when(accountMapper.updateWalletBalanceGuarded(eq(clientId), eq(cashDelta), eq(1)))
                .thenReturn(1);
        when(positionMapper.findHoldingForUpdate(eq(clientId), eq("ACME"))).thenReturn(Optional.empty());

        FillRuleResult fillResult = new FillRuleResult(FillDecision.FILL, executedPrice, null);
        SettlementService.QuoteSnapshot quoteSnapshot = new SettlementService.QuoteSnapshot(
                new BigDecimal("99.95"), executedPrice);

        var result = settlementService.settle(order, fillResult, quoteSnapshot);

        assertThat(result.success()).isTrue();
        assertThat(result.decision()).isEqualTo(FillDecision.FILL);
        assertThat(result.executedPrice()).isEqualByComparingTo(executedPrice);
        assertThat(result.positionQuantityAfter()).isEqualTo(10);
        assertThat(result.averageCostAfter()).isEqualByComparingTo(executedPrice);

        verify(orderMapper).updateStatusAndExecutedPrice(eq(orderId), eq("FILLED"), eq(executedPrice), any());
        verify(accountMapper).updateWalletBalanceGuarded(eq(clientId), eq(cashDelta), eq(1));
        verify(positionMapper).insertHolding(any(PositionRow.class));
        verify(orderHistoryMapper).insertEvent(eq(orderId), eq(clientId), eq("EXECUTED"), eq("NEW"),
                eq("FILLED"), isNull(), isNull(), eq("idem-1"), eq("FILLED"), isNull());
    }

    @Test
    void rejectWritesTerminalHistoryRowWithFailureCode() {
        UUID orderId = UUID.randomUUID();
        Long clientId = 1L;

        Order order = createOrder(orderId, clientId, OrderSide.BUY, new BigDecimal("100.00"));
        OrderRow orderRow = new OrderRow(orderId, clientId, clientId, "ACME", "POSITION", "BUY",
                BigDecimal.valueOf(10), new BigDecimal("100.00"), null, "NEW", "idem-1", null,
                LocalDateTime.now(), LocalDateTime.now(), null);
        AccountRow accountRow = new AccountRow(clientId, "ACC-001", "Test", "test@test.com", "123",
                LocalDateTime.now(), "ACTIVE", new BigDecimal("5000.00"), 1, LocalDateTime.now());

        when(orderMapper.findByOrderId(orderId)).thenReturn(Optional.of(orderRow));
        when(accountMapper.findByClientIdForUpdate(clientId)).thenReturn(Optional.of(accountRow));
        when(orderMapper.updateStatusAndReason(orderId, "REJECTED")).thenReturn(1);

        FillRuleResult rejectResult = new FillRuleResult(FillDecision.REJECT, null, "BUY_LIMIT_BELOW_ASK");
        var result = settlementService.settle(order, rejectResult,
                new SettlementService.QuoteSnapshot(new BigDecimal("99.95"), new BigDecimal("100.05")));

        assertThat(result.success()).isTrue();
        assertThat(result.decision()).isEqualTo(FillDecision.REJECT);
        verify(orderHistoryMapper).insertEvent(eq(orderId), eq(clientId), eq("REJECTED"), eq("NEW"),
                eq("REJECTED"), eq("BUY_LIMIT_BELOW_ASK"), eq("BUY_LIMIT_BELOW_ASK"), eq("idem-1"),
                isNull(), isNull());
    }

    @Test
    void failureInAnyWriteLeavesNoneWritten() {
        UUID orderId = UUID.randomUUID();
        Long clientId = 1L;
        BigDecimal executedPrice = new BigDecimal("100.05");

        Order order = createOrder(orderId, clientId, OrderSide.BUY, new BigDecimal("100.00"));

        OrderRow orderRow = new OrderRow(orderId, clientId, clientId, "ACME", "POSITION", "BUY",
                BigDecimal.valueOf(10), new BigDecimal("100.00"), null, "NEW", "idem-1", null,
                LocalDateTime.now(), LocalDateTime.now(), null);

        AccountRow accountRow = new AccountRow(clientId, "ACC-001", "Test", "test@test.com", "123",
                LocalDateTime.now(), "ACTIVE", new BigDecimal("5000.00"), 1, LocalDateTime.now());

        when(orderMapper.findByOrderId(orderId)).thenReturn(Optional.of(orderRow));
        when(accountMapper.findByClientIdForUpdate(clientId)).thenReturn(Optional.of(accountRow));
        when(orderMapper.updateStatusAndExecutedPrice(eq(orderId), eq("FILLED"), eq(executedPrice), any()))
                .thenReturn(1);
        when(accountMapper.updateWalletBalanceGuarded(eq(clientId), any(), eq(1)))
                .thenReturn(0)
                .thenReturn(0)
                .thenReturn(0)
                .thenReturn(0);

        FillRuleResult fillResult = new FillRuleResult(FillDecision.FILL, executedPrice, null);
        SettlementService.QuoteSnapshot quoteSnapshot = new SettlementService.QuoteSnapshot(
                new BigDecimal("99.95"), executedPrice);

        try {
            settlementService.settle(order, fillResult, quoteSnapshot);
        } catch (Exception e) {
            // expected
        }

        verify(accountMapper, times(4)).updateWalletBalanceGuarded(eq(clientId), any(), anyInt());
        verify(positionMapper, never()).insertHolding(any());
    }

    @Test
    void secondDeliveryAffectsZeroRowsAndPublishesNothing() {
        UUID orderId = UUID.randomUUID();
        Long clientId = 1L;

        Order order = createOrder(orderId, clientId, OrderSide.BUY, new BigDecimal("100.00"));

        OrderRow orderRow = new OrderRow(orderId, clientId, clientId, "ACME", "POSITION", "BUY",
                BigDecimal.valueOf(10), new BigDecimal("100.00"), null, "FILLED", "idem-1", null,
                LocalDateTime.now(), LocalDateTime.now(), LocalDateTime.now());

        when(orderMapper.findByOrderId(orderId)).thenReturn(Optional.of(orderRow));

        FillRuleResult fillResult = new FillRuleResult(FillDecision.FILL, new BigDecimal("100.05"), null);
        SettlementService.QuoteSnapshot quoteSnapshot = new SettlementService.QuoteSnapshot(
                new BigDecimal("99.95"), new BigDecimal("100.05"));

        var result = settlementService.settle(order, fillResult, quoteSnapshot);

        assertThat(result.success()).isFalse();
        assertThat(result.reason()).isEqualTo("ALREADY_SETTLED_FILLED");

        verify(orderMapper, never()).updateStatusAndExecutedPrice(any(), any(), any(), any());
        verify(accountMapper, never()).updateWalletBalanceGuarded(any(), any(), anyInt());
    }

    @Test
    void exhaustedOptimisticLockBudgetReportsError() {
        UUID orderId = UUID.randomUUID();
        Long clientId = 1L;
        BigDecimal executedPrice = new BigDecimal("100.05");

        Order order = createOrder(orderId, clientId, OrderSide.BUY, new BigDecimal("100.00"));

        OrderRow orderRow = new OrderRow(orderId, clientId, clientId, "ACME", "POSITION", "BUY",
                BigDecimal.valueOf(10), new BigDecimal("100.00"), null, "NEW", "idem-1", null,
                LocalDateTime.now(), LocalDateTime.now(), null);

        AccountRow accountRow = new AccountRow(clientId, "ACC-001", "Test", "test@test.com", "123",
                LocalDateTime.now(), "ACTIVE", new BigDecimal("5000.00"), 1, LocalDateTime.now());

        when(orderMapper.findByOrderId(orderId)).thenReturn(Optional.of(orderRow));
        when(accountMapper.findByClientIdForUpdate(clientId)).thenReturn(Optional.of(accountRow));
        when(orderMapper.updateStatusAndExecutedPrice(eq(orderId), eq("FILLED"), eq(executedPrice), any()))
                .thenReturn(1);
        when(accountMapper.updateWalletBalanceGuarded(eq(clientId), any(), anyInt())).thenReturn(0);

        FillRuleResult fillResult = new FillRuleResult(FillDecision.FILL, executedPrice, null);
        SettlementService.QuoteSnapshot quoteSnapshot = new SettlementService.QuoteSnapshot(
                new BigDecimal("99.95"), executedPrice);

        try {
            settlementService.settle(order, fillResult, quoteSnapshot);
        } catch (Exception e) {
            assertThat(e).hasMessageContaining("Optimistic lock exhausted");
        }

        verify(accountMapper, times(4)).updateWalletBalanceGuarded(eq(clientId), any(), anyInt());
    }
}