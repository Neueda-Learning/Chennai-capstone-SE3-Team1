package com.team1.executor.settlement;

import com.team1.executor.mapper.AccountMapper;
import com.team1.executor.mapper.OrderHistoryMapper;
import com.team1.executor.mapper.OrderMapper;
import com.team1.executor.mapper.PositionMapper;
import com.team1.executor.model.AccountRow;
import com.team1.executor.model.OrderRow;
import com.team1.executor.model.PositionRow;
import com.team1.executor.rule.FillDecision;
import com.team1.executor.rule.FillRuleResult;
import com.team1.trading.domain.entity.Order;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.exception.InsufficientFundsException;
import com.team1.trading.domain.exception.InsufficientHoldingsException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.Optional;

@Service
public class SettlementService {

    private final OrderMapper orderMapper;
    private final OrderHistoryMapper orderHistoryMapper;
    private final AccountMapper accountMapper;
    private final PositionMapper positionMapper;
    private final int maxOptimisticLockRetries;

    public SettlementService(OrderMapper orderMapper,
                             OrderHistoryMapper orderHistoryMapper,
                             AccountMapper accountMapper,
                             PositionMapper positionMapper,
                             @org.springframework.beans.factory.annotation.Value("${executor.optimistic-lock-max-retries}") int maxOptimisticLockRetries) {
        this.orderMapper = orderMapper;
        this.orderHistoryMapper = orderHistoryMapper;
        this.accountMapper = accountMapper;
        this.positionMapper = positionMapper;
        this.maxOptimisticLockRetries = maxOptimisticLockRetries;
    }

    @Transactional
    public SettlementResult settle(Order order, FillRuleResult fillResult, QuoteSnapshot quoteSnapshot) {
        var orderRowOpt = orderMapper.findByOrderId(order.getOrderId());
        if (orderRowOpt.isEmpty()) {
            return SettlementResult.orderNotFound();
        }

        OrderRow orderRow = orderRowOpt.get();
        if (!"NEW".equals(orderRow.status())) {
            return SettlementResult.alreadySettled(orderRow.status());
        }

        var accountRowOpt = accountMapper.findByClientIdForUpdate(order.getClientId());
        if (accountRowOpt.isEmpty()) {
            return SettlementResult.accountNotFound();
        }

        AccountRow accountRow = accountRowOpt.get();
        if (!accountRow.isActive()) {
            return SettlementResult.accountNotActive();
        }

        if (fillResult.decision() == FillDecision.FILL) {
            return executeFill(order, orderRow, accountRow, fillResult, quoteSnapshot);
        } else {
            return executeReject(order, orderRow, fillResult.reason());
        }
    }

    @Transactional
    public void rejectIfNew(java.util.UUID orderId, Long clientId, String reasonCode) {
        var orderRowOpt = orderMapper.findByOrderId(orderId);
        if (orderRowOpt.isEmpty()) {
            return;
        }
        OrderRow orderRow = orderRowOpt.get();
        if (!"NEW".equals(orderRow.status())) {
            return;
        }
        int rows = orderMapper.updateStatusAndReason(orderId, "REJECTED");
        if (rows > 0) {
            appendHistory(orderId, clientId, "REJECTED", "NEW", "REJECTED", reasonCode, reasonCode,
                    orderRow.idempotencyKey(), null, orderRow.externalOrderId());
        }
    }

    private SettlementResult executeFill(Order order, OrderRow orderRow, AccountRow accountRow,
                                         FillRuleResult fillResult, QuoteSnapshot quoteSnapshot) {
        BigDecimal executedPrice = fillResult.executedPrice();
        BigDecimal cashDelta = calculateCashDelta(order, executedPrice);
        BigDecimal newBalance = accountRow.walletBalance().add(cashDelta);

        if (newBalance.compareTo(BigDecimal.ZERO) < 0) {
            throw new InsufficientFundsException(accountRow.clientId(), cashDelta.abs(), accountRow.walletBalance());
        }

        Optional<PositionRow> lockedSellHolding = Optional.empty();
        if (order.getSide() == OrderSide.SELL) {
            lockedSellHolding = positionMapper.findHoldingForUpdate(order.getClientId(), order.getInstrumentId());
            if (lockedSellHolding.isEmpty()) {
                throw new InsufficientHoldingsException(order.getClientId(), order.getInstrumentId(),
                        order.getQuantity(), BigDecimal.ZERO);
            }
            PositionRow holding = lockedSellHolding.get();
            if (holding.quantity() < order.getQuantity().intValue()) {
                throw new InsufficientHoldingsException(order.getClientId(), order.getInstrumentId(),
                        order.getQuantity(), BigDecimal.valueOf(holding.quantity()));
            }
        }

        int rows = orderMapper.updateStatusAndExecutedPrice(
                order.getOrderId(), "FILLED", executedPrice, LocalDateTime.now());
        if (rows == 0) {
            return SettlementResult.alreadySettled(orderRow.status());
        }

        boolean balanceUpdated = updateAccountBalanceWithRetry(accountRow.clientId(), cashDelta, accountRow.version());
        if (!balanceUpdated) {
            throw new OptimisticLockingFailureException("Optimistic lock exhausted for account " + accountRow.clientId());
        }

        PositionAfter positionAfter = updatePosition(order, executedPrice, lockedSellHolding);

        appendHistory(order.getOrderId(), order.getClientId(), "EXECUTED", "NEW", "FILLED", null, null,
                order.getIdempotencyKey(), "FILLED", orderRow.externalOrderId());

        return SettlementResult.success(FillDecision.FILL, executedPrice,
                positionAfter.quantity(), positionAfter.averageCost());
    }

    private SettlementResult executeReject(Order order, OrderRow orderRow, String reasonCode) {
        int rows = orderMapper.updateStatusAndReason(order.getOrderId(), "REJECTED");
        if (rows == 0) {
            return SettlementResult.alreadySettled(orderRow.status());
        }

        appendHistory(order.getOrderId(), order.getClientId(), "REJECTED", "NEW", "REJECTED", reasonCode,
                reasonCode, order.getIdempotencyKey(), null, orderRow.externalOrderId());
        return SettlementResult.success(FillDecision.REJECT, null, 0, BigDecimal.ZERO);
    }

    private BigDecimal calculateCashDelta(Order order, BigDecimal executedPrice) {
        BigDecimal quantity = order.getQuantity();
        BigDecimal price = executedPrice != null ? executedPrice : order.getPrice();
        BigDecimal tradeValue = quantity.multiply(price).setScale(2, RoundingMode.HALF_UP);

        if (order.getSide() == OrderSide.BUY) {
            return tradeValue.negate();
        } else {
            return tradeValue;
        }
    }

    private boolean updateAccountBalanceWithRetry(Long clientId, BigDecimal cashDelta, int expectedVersion) {
        for (int attempt = 0; attempt <= maxOptimisticLockRetries; attempt++) {
            var accountOpt = accountMapper.findByClientIdForUpdate(clientId);
            if (accountOpt.isEmpty()) {
                return false;
            }
            AccountRow current = accountOpt.get();
            int rows = accountMapper.updateWalletBalanceGuarded(clientId, cashDelta, current.version());
            if (rows > 0) {
                return true;
            }
        }
        return false;
    }

    private PositionAfter updatePosition(Order order, BigDecimal executedPrice, Optional<PositionRow> lockedSellHolding) {
        BigDecimal price = executedPrice != null ? executedPrice : order.getPrice();
        Integer quantity = order.getQuantity().intValue();

        var holdingOpt = order.getSide() == OrderSide.SELL
                ? lockedSellHolding
                : positionMapper.findHoldingForUpdate(order.getClientId(), order.getInstrumentId());

        if (order.getSide() == OrderSide.BUY) {
            if (holdingOpt.isEmpty()) {
                PositionRow newHolding = new PositionRow(
                        null, order.getClientId(), order.getInstrumentId(),
                        quantity, price, BigDecimal.ZERO,
                        LocalDateTime.now(), LocalDateTime.now());
                positionMapper.insertHolding(newHolding);
                return new PositionAfter(quantity, price);
            } else {
                positionMapper.updateHoldingBuy(order.getClientId(), order.getInstrumentId(), quantity, price);
                PositionRow updated = positionMapper.findHolding(order.getClientId(), order.getInstrumentId())
                        .orElseThrow(() -> new IllegalStateException("HOLDING_NOT_FOUND_AFTER_BUY_UPDATE"));
                return new PositionAfter(updated.quantity(), updated.pricePerUnit());
            }
        } else {
            if (holdingOpt.isEmpty()) {
                throw new InsufficientHoldingsException(order.getClientId(), order.getInstrumentId(),
                        BigDecimal.valueOf(quantity), BigDecimal.ZERO);
            }
            PositionRow holding = holdingOpt.get();
            if (holding.quantity() < quantity) {
                throw new InsufficientHoldingsException(order.getClientId(), order.getInstrumentId(),
                        BigDecimal.valueOf(quantity), BigDecimal.valueOf(holding.quantity()));
            }
            positionMapper.updateHoldingSell(order.getClientId(), order.getInstrumentId(), quantity);
            return new PositionAfter(holding.quantity() - quantity, holding.pricePerUnit());
        }
    }

    private void appendHistory(java.util.UUID orderId,
                               Long clientId,
                               String eventType,
                               String previousStatus,
                               String newStatus,
                               String failureCode,
                               String failureReason,
                               String requestId,
                               String externalStatus,
                               String externalOrderId) {
        orderHistoryMapper.insertEvent(orderId, clientId, eventType, previousStatus, newStatus,
                failureCode, failureReason, requestId, externalStatus, externalOrderId);
    }

    private record PositionAfter(Integer quantity, BigDecimal averageCost) {}

    public record QuoteSnapshot(BigDecimal bid, BigDecimal ask) {}

    public record SettlementResult(
            boolean success,
            FillDecision decision,
            BigDecimal executedPrice,
            Integer positionQuantityAfter,
            BigDecimal averageCostAfter,
            String reason
    ) {
        public static SettlementResult success(FillDecision decision, BigDecimal executedPrice,
                                               Integer positionQuantityAfter, BigDecimal averageCostAfter) {
            return new SettlementResult(true, decision, executedPrice, positionQuantityAfter, averageCostAfter, null);
        }
        public static SettlementResult alreadySettled(String status) {
            return new SettlementResult(false, null, null, null, null, "ALREADY_SETTLED_" + status);
        }
        public static SettlementResult orderNotFound() {
            return new SettlementResult(false, null, null, null, null, "ORDER_NOT_FOUND");
        }
        public static SettlementResult accountNotFound() {
            return new SettlementResult(false, null, null, null, null, "ACCOUNT_NOT_FOUND");
        }
        public static SettlementResult accountNotActive() {
            return new SettlementResult(false, null, null, null, null, "ACCOUNT_NOT_ACTIVE");
        }
    }
}