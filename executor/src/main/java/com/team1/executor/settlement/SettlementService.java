package com.team1.executor.settlement;

import com.team1.executor.mapper.AccountMapper;
import com.team1.executor.mapper.OrderMapper;
import com.team1.executor.mapper.PositionMapper;
import com.team1.executor.model.AccountRow;
import com.team1.executor.model.OrderRow;
import com.team1.executor.model.PositionRow;
import com.team1.executor.rule.FillDecision;
import com.team1.executor.rule.FillRule;
import com.team1.executor.rule.FillRuleResult;
import com.team1.trading.domain.entity.Order;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;
import com.team1.trading.domain.exception.AccountNotActiveException;
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
    private final AccountMapper accountMapper;
    private final PositionMapper positionMapper;
    private final int maxOptimisticLockRetries;

    public SettlementService(OrderMapper orderMapper,
                             AccountMapper accountMapper,
                             PositionMapper positionMapper,
                             @org.springframework.beans.factory.annotation.Value("${executor.optimistic-lock-max-retries}") int maxOptimisticLockRetries) {
        this.orderMapper = orderMapper;
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

        int rowsUpdated = 0;
        if (fillResult.decision() == FillDecision.FILL) {
            rowsUpdated = executeFill(order, orderRow, accountRow, fillResult, quoteSnapshot);
        } else {
            rowsUpdated = executeReject(order, orderRow, fillResult);
        }

        if (rowsUpdated == 0) {
            return SettlementResult.alreadySettled(orderRow.status());
        }

        return SettlementResult.success(fillResult.decision(), fillResult.executedPrice());
    }

    private int executeFill(Order order, OrderRow orderRow, AccountRow accountRow,
                            FillRuleResult fillResult, QuoteSnapshot quoteSnapshot) {
        BigDecimal executedPrice = fillResult.executedPrice();
        BigDecimal cashDelta = calculateCashDelta(order, executedPrice);
        BigDecimal newBalance = accountRow.walletBalance().add(cashDelta);

        if (newBalance.compareTo(BigDecimal.ZERO) < 0) {
            throw new InsufficientFundsException(accountRow.clientId(), cashDelta.abs(), accountRow.walletBalance());
        }

        int rows = orderMapper.updateStatusAndExecutedPrice(
                order.getOrderId(), "FILLED", executedPrice, LocalDateTime.now());
        if (rows == 0) {
            return 0;
        }

        boolean balanceUpdated = updateAccountBalanceWithRetry(accountRow.clientId(), cashDelta, accountRow.version());
        if (!balanceUpdated) {
            throw new OptimisticLockingFailureException("Optimistic lock exhausted for account " + accountRow.clientId());
        }

        updatePosition(order, executedPrice);

        return 1;
    }

    private int executeReject(Order order, OrderRow orderRow, FillRuleResult fillResult) {
        int rows = orderMapper.updateStatusAndReason(order.getOrderId(), "REJECTED");
        if (rows == 0) {
            return 0;
        }
        return 1;
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

    private void updatePosition(Order order, BigDecimal executedPrice) {
        BigDecimal price = executedPrice != null ? executedPrice : order.getPrice();
        Integer quantity = order.getQuantity().intValue();

        var holdingOpt = positionMapper.findHoldingForUpdate(order.getClientId(), order.getInstrumentId());

        if (order.getSide() == OrderSide.BUY) {
            if (holdingOpt.isEmpty()) {
                PositionRow newHolding = new PositionRow(
                        null, order.getClientId(), order.getInstrumentId(),
                        quantity, price, BigDecimal.ZERO,
                        LocalDateTime.now(), LocalDateTime.now());
                positionMapper.insertHolding(newHolding);
            } else {
                positionMapper.updateHoldingBuy(order.getClientId(), order.getInstrumentId(), quantity, price);
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
        }
    }

    public record QuoteSnapshot(BigDecimal bid, BigDecimal ask) {}

    public record SettlementResult(
            boolean success,
            FillDecision decision,
            BigDecimal executedPrice,
            String reason
    ) {
        public static SettlementResult success(FillDecision decision, BigDecimal executedPrice) {
            return new SettlementResult(true, decision, executedPrice, null);
        }
        public static SettlementResult alreadySettled(String status) {
            return new SettlementResult(false, null, null, "ALREADY_SETTLED_" + status);
        }
        public static SettlementResult orderNotFound() {
            return new SettlementResult(false, null, null, "ORDER_NOT_FOUND");
        }
        public static SettlementResult accountNotFound() {
            return new SettlementResult(false, null, null, "ACCOUNT_NOT_FOUND");
        }
        public static SettlementResult accountNotActive() {
            return new SettlementResult(false, null, null, "ACCOUNT_NOT_ACTIVE");
        }
    }
}