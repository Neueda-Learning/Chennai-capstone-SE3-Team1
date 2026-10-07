package com.team1.trading.domain.entity;

import com.team1.trading.domain.entity.types.ConditionType;
import com.team1.trading.domain.entity.types.OrderStatus;
import com.team1.trading.domain.entity.types.OrderType;
import com.team1.trading.domain.entity.types.OrderSide;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Objects;

public class Order {

    private java.util.UUID orderId;
    private Long clientId;
    private Long accountId;
    private String instrumentId;
    private OrderType orderType;
    private OrderSide side;
    private BigDecimal quantity;
    private BigDecimal price;
    private BigDecimal executedPrice;
    private OrderStatus status;
    private String idempotencyKey;
    private String externalOrderId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // The condition of a conditional order; all null for an ordinary one.
    private ConditionType conditionType;
    private BigDecimal triggerPrice;
    private Integer shortWindow;
    private Integer longWindow;
    private BigDecimal bandWidth;
    private String conditionState;
    private LocalDateTime expiresAt;
    private LocalDateTime lastCheckedAt;
    private LocalDateTime triggeredAt;
    private String triggerReason;

    public Order(Long clientId, Long accountId, String instrumentId, OrderType orderType,
                 OrderSide side, BigDecimal quantity, BigDecimal price, String idempotencyKey) {
        this.clientId = Objects.requireNonNull(clientId, "clientId must not be null");
        this.accountId = Objects.requireNonNull(accountId, "accountId must not be null");
        this.instrumentId = Objects.requireNonNull(instrumentId, "instrumentId must not be null");
        this.orderType = Objects.requireNonNull(orderType, "orderType must not be null");
        this.side = Objects.requireNonNull(side, "side must not be null");
        if (quantity == null || quantity.signum() <= 0) throw new IllegalArgumentException("quantity must be greater than zero");
        this.quantity = quantity;
        this.price = price;
        this.idempotencyKey = idempotencyKey;
        this.status = OrderStatus.NEW;
        this.createdAt = LocalDateTime.now();
        this.updatedAt = this.createdAt;
    }

    public java.util.UUID getOrderId() { return orderId; }
    public void setOrderId(java.util.UUID orderId) { this.orderId = orderId; }
    public Long getClientId() { return clientId; }
    public Long getAccountId() { return accountId; }
    public String getInstrumentId() { return instrumentId; }
    public OrderType getOrderType() { return orderType; }
    public OrderSide getSide() { return side; }
    public BigDecimal getQuantity() { return quantity; }
    public BigDecimal getPrice() { return price; }
    public BigDecimal getExecutedPrice() { return executedPrice; }
    public OrderStatus getStatus() { return status; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public String getExternalOrderId() { return externalOrderId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public ConditionType getConditionType() { return conditionType; }
    public BigDecimal getTriggerPrice() { return triggerPrice; }
    public Integer getShortWindow() { return shortWindow; }
    public Integer getLongWindow() { return longWindow; }
    public BigDecimal getBandWidth() { return bandWidth; }
    public String getConditionState() { return conditionState; }
    public LocalDateTime getExpiresAt() { return expiresAt; }
    public LocalDateTime getLastCheckedAt() { return lastCheckedAt; }
    public LocalDateTime getTriggeredAt() { return triggeredAt; }
    public String getTriggerReason() { return triggerReason; }

    public boolean isConditional() {
        return conditionType != null;
    }

    /**
     * Turns a new order into a conditional one: it is held as PENDING until {@link #release} and is never
     * sent to the executor before then. The parameters the condition type needs must be present; the
     * others are dropped.
     */
    public void holdUntil(ConditionType type, BigDecimal triggerPrice, Integer shortWindow, Integer longWindow,
                          BigDecimal bandWidth, LocalDateTime expiresAt) {
        requireTransitionableFromNew();
        Objects.requireNonNull(type, "condition type must not be null");
        Objects.requireNonNull(expiresAt, "expiresAt must not be null");
        if (type.isPriceLevel() && (triggerPrice == null || triggerPrice.signum() <= 0)) {
            throw new IllegalArgumentException("a price condition needs a positive triggerPrice");
        }
        if (type.isCrossover()
                && (shortWindow == null || longWindow == null || shortWindow < 1 || longWindow <= shortWindow
                    || longWindow < 2)) {
            // shortWindow 1 is the price itself: "the price crosses its longWindow average".
            throw new IllegalArgumentException("a crossover needs 1 <= shortWindow < longWindow");
        }
        if (type.isBand() && (longWindow == null || longWindow < 2 || bandWidth == null || bandWidth.signum() <= 0)) {
            throw new IllegalArgumentException("a band condition needs longWindow >= 2 and a positive bandWidth");
        }
        if (!expiresAt.isAfter(createdAt)) {
            throw new IllegalArgumentException("expiresAt must be after the order is created");
        }
        this.conditionType = type;
        this.triggerPrice = type.isPriceLevel() ? triggerPrice : null;
        this.shortWindow = type.isCrossover() ? shortWindow : null;
        this.longWindow = type.isPriceLevel() ? null : longWindow;
        this.bandWidth = type.isBand() ? bandWidth : null;
        this.expiresAt = expiresAt;
        this.status = OrderStatus.PENDING;
        this.updatedAt = LocalDateTime.now();
    }

    /** The condition was met: the order becomes NEW and goes to the executor like any other. */
    public void release(String reason) {
        if (this.status != OrderStatus.PENDING) {
            throw new IllegalStateException("order " + orderId + " is " + status + ", only a PENDING order is released");
        }
        this.status = OrderStatus.NEW;
        this.triggeredAt = LocalDateTime.now();
        this.triggerReason = reason;
        this.updatedAt = this.triggeredAt;
    }

    public void markInProgress() {
        requireTransitionableFromNew();
        this.status = OrderStatus.NEW;
        this.updatedAt = LocalDateTime.now();
    }

    public void markCompleted(BigDecimal executedPrice) {
        requireTransitionableFromNew();
        this.executedPrice = Objects.requireNonNull(executedPrice, "executedPrice must not be null");
        this.status = OrderStatus.FILLED;
        this.updatedAt = LocalDateTime.now();
    }

    public void markFailed() {
        requireTransitionableFromNew();
        this.status = OrderStatus.REJECTED;
        this.updatedAt = LocalDateTime.now();
    }

    public void cancel() {
        if (this.status != OrderStatus.PENDING) {
            requireTransitionableFromNew();
        }
        this.status = OrderStatus.CANCELLED;
        this.updatedAt = LocalDateTime.now();
    }

    private void requireTransitionableFromNew() {
        if (this.status != OrderStatus.NEW) {
            throw new IllegalStateException("order " + orderId + " is " + status + ", cannot transition");
        }
    }

}
