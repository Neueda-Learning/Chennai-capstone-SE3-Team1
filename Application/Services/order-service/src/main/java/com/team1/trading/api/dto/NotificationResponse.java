package com.team1.trading.api.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/**
 * One account notification, as served by {@code GET /api/v1/accounts/{id}/notifications}.
 *
 * <p>There is no notifications table: each entry is derived from something that really happened
 * to the account - an order placed, filled, rejected or cancelled, or money moved between the
 * wallet and the bank - so a notification can never disagree with the blotter or the balance.
 * {@code id} is stable for a given event, which is what lets a client tell new from already-seen.
 */
public class NotificationResponse {

    private String id;
    /** ORDER_PLACED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, TRANSFER_IN or TRANSFER_OUT. */
    private String kind;
    /** A sentence ready to show; the structured fields below are for clients that want to format their own. */
    private String message;
    private String symbol;
    private String side;
    private Integer quantity;
    private BigDecimal price;
    private BigDecimal executedPrice;
    private BigDecimal amount;
    /** Why a REJECTED order was refused. */
    private String reason;
    private OffsetDateTime occurredAt;

    public NotificationResponse() {
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getKind() { return kind; }
    public void setKind(String kind) { this.kind = kind; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }

    public String getSide() { return side; }
    public void setSide(String side) { this.side = side; }

    public Integer getQuantity() { return quantity; }
    public void setQuantity(Integer quantity) { this.quantity = quantity; }

    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }

    public BigDecimal getExecutedPrice() { return executedPrice; }
    public void setExecutedPrice(BigDecimal executedPrice) { this.executedPrice = executedPrice; }

    public BigDecimal getAmount() { return amount; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }

    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }

    public OffsetDateTime getOccurredAt() { return occurredAt; }
    public void setOccurredAt(OffsetDateTime occurredAt) { this.occurredAt = occurredAt; }
}
