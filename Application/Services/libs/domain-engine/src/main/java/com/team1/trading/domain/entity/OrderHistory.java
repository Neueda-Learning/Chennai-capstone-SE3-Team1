package com.team1.trading.domain.entity;

import com.team1.trading.domain.entity.types.OrderStatus;
import java.math.BigDecimal;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderType;

import java.time.LocalDateTime;
import java.util.Objects;

public class OrderHistory {

    private Long historyId;
    private Long orderId;
    private String eventType;
    private OrderStatus previousStatus;
    private OrderStatus newStatus;
    private String externalStatus;
    private String externalOrderId;
    private String requestId;
    private String failureCode;
    private String failureReason;
    private String apiResponse;
    private LocalDateTime eventTimestamp;
    private LocalDateTime createdAt;

    // Migration 010: orders holds live orders only, and the row is deleted once an order
    // settles. The terminal history row is therefore the only surviving record of the order
    // itself, so it carries the order's own fields. They are null on a non-terminal event.
    private Long clientId;
    private Long accountId;
    private String instrumentId;
    private OrderType orderType;
    private OrderSide side;
    private BigDecimal quantity;
    private BigDecimal price;
    private BigDecimal executedPrice;
    private String idempotencyKey;
    private LocalDateTime orderCreatedAt;

    public OrderHistory(Long historyId, Long orderId, String eventType,
                        OrderStatus previousStatus, OrderStatus newStatus,
                        String externalStatus, String externalOrderId, String requestId,
                        String failureCode, String failureReason, String apiResponse) {
        this.historyId = historyId;
        this.orderId = Objects.requireNonNull(orderId, "orderId must not be null");
        this.eventType = eventType;
        this.previousStatus = previousStatus;
        this.newStatus = newStatus;
        this.externalStatus = externalStatus;
        this.externalOrderId = externalOrderId;
        this.requestId = requestId;
        this.failureCode = failureCode;
        this.failureReason = failureReason;
        this.apiResponse = apiResponse;
        this.eventTimestamp = LocalDateTime.now();
        this.createdAt = this.eventTimestamp;
    }

    public Long getHistoryId() { return historyId; }
    public Long getOrderId() { return orderId; }
    public String getEventType() { return eventType; }
    public OrderStatus getPreviousStatus() { return previousStatus; }
    public OrderStatus getNewStatus() { return newStatus; }
    public String getExternalStatus() { return externalStatus; }
    public String getExternalOrderId() { return externalOrderId; }
    public String getRequestId() { return requestId; }
    public String getFailureCode() { return failureCode; }
    public String getFailureReason() { return failureReason; }
    public String getApiResponse() { return apiResponse; }
    public LocalDateTime getEventTimestamp() { return eventTimestamp; }
    public LocalDateTime getCreatedAt() { return createdAt; }


    public Long getClientId() { return clientId; }

    public Long getAccountId() { return accountId; }

    public String getInstrumentId() { return instrumentId; }

    public OrderType getOrderType() { return orderType; }

    public OrderSide getSide() { return side; }

    public BigDecimal getQuantity() { return quantity; }

    public BigDecimal getPrice() { return price; }

    public BigDecimal getExecutedPrice() { return executedPrice; }

    public String getIdempotencyKey() { return idempotencyKey; }

    public LocalDateTime getOrderCreatedAt() { return orderCreatedAt; }

    /** True when this row is an order that has left the live book, not a bare transition. */
    public boolean isTerminalRecord() {
        return idempotencyKey != null;
    }
}
