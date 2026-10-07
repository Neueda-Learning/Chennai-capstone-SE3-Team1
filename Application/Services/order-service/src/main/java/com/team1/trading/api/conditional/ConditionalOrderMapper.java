package com.team1.trading.api.conditional;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/** The PENDING rows of the orders table, and the market_quotes they are checked against. */
@Mapper
public interface ConditionalOrderMapper {

    String PENDING_COLUMNS = """
            CAST(order_id AS VARCHAR(36)) AS orderUuid, client_id AS clientId, account_id AS accountId,
            instrument_id AS symbol, order_type AS orderType, side, CAST(quantity AS INT) AS quantity, price,
            idempotency_key AS idempotencyKey, created_at AS createdAt,
            condition_type AS conditionType, trigger_price AS triggerPrice, short_window AS shortWindow,
            long_window AS longWindow, band_width AS bandWidth, condition_state AS conditionState,
            expires_at AS expiresAt, last_checked_at AS lastCheckedAt
            """;

    @Select("SELECT " + PENDING_COLUMNS + " FROM orders WHERE status = 'PENDING' ORDER BY instrument_id, created_at")
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<PendingRow> findPending();

    @Select("SELECT " + PENDING_COLUMNS
            + " FROM orders WHERE status = 'PENDING' AND client_id = #{accountId} ORDER BY created_at DESC")
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<PendingRow> findPendingForAccount(@Param("accountId") long accountId);

    /** The latest quote for a symbol, so the checker can see how old it is and whether the poller flagged it. */
    @Select("""
            SELECT price, stale, received_at AS receivedAt
            FROM market_quotes
            WHERE instrument_id = #{symbol}
            ORDER BY received_at DESC, quote_id DESC
            LIMIT 1
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    Optional<LatestQuote> latestQuote(@Param("symbol") String symbol);

    @Update("""
            UPDATE orders
            SET condition_state = #{state, jdbcType=VARCHAR}, last_checked_at = #{now}
            WHERE order_id = CAST(#{orderUuid} AS UUID) AND status = 'PENDING'
            """)
    int markChecked(@Param("orderUuid") String orderUuid, @Param("state") String state,
                    @Param("now") LocalDateTime now);

    /** The release. Zero rows means it was cancelled or released a moment ago: publish nothing. */
    @Update("""
            UPDATE orders
            SET status = 'NEW', triggered_at = #{now}, trigger_reason = #{reason},
                last_checked_at = #{now}, updated_at = #{now}
            WHERE order_id = CAST(#{orderUuid} AS UUID) AND status = 'PENDING'
            """)
    int release(@Param("orderUuid") String orderUuid, @Param("reason") String reason,
                @Param("now") LocalDateTime now);

    @Insert("""
            INSERT INTO order_history (
                order_id, event_type, previous_status, new_status, external_status, failure_code, failure_reason,
                client_id, account_id, instrument_id, order_type, side,
                quantity, price, idempotency_key, order_created_at
            ) VALUES (
                CAST(#{o.orderUuid} AS UUID), 'EXPIRED', 'PENDING', 'CANCELLED', 'EXPIRED', 'EXPIRED',
                'The condition was not met before the order expired',
                #{o.clientId}, #{o.accountId}, #{o.symbol}, #{o.orderType}, #{o.side},
                #{o.quantity}, #{o.price}, #{o.idempotencyKey}, #{o.createdAt}
            )
            """)
    int archiveExpired(@Param("o") PendingRow order);

    @Delete("DELETE FROM orders WHERE order_id = CAST(#{orderUuid} AS UUID) AND status = 'PENDING'")
    int deletePending(@Param("orderUuid") String orderUuid);

    class LatestQuote {
        private BigDecimal price;
        private boolean stale;
        private LocalDateTime receivedAt;

        public BigDecimal getPrice() { return price; }
        public void setPrice(BigDecimal price) { this.price = price; }
        public boolean isStale() { return stale; }
        public void setStale(boolean stale) { this.stale = stale; }
        public LocalDateTime getReceivedAt() { return receivedAt; }
        public void setReceivedAt(LocalDateTime receivedAt) { this.receivedAt = receivedAt; }
    }

    class PendingRow {
        private String orderUuid;
        private Long clientId;
        private Long accountId;
        private String symbol;
        private String orderType;
        private String side;
        private Integer quantity;
        private BigDecimal price;
        private String idempotencyKey;
        private LocalDateTime createdAt;
        private String conditionType;
        private BigDecimal triggerPrice;
        private Integer shortWindow;
        private Integer longWindow;
        private BigDecimal bandWidth;
        private String conditionState;
        private LocalDateTime expiresAt;
        private LocalDateTime lastCheckedAt;

        public String getOrderUuid() { return orderUuid; }
        public void setOrderUuid(String orderUuid) { this.orderUuid = orderUuid; }
        public Long getClientId() { return clientId; }
        public void setClientId(Long clientId) { this.clientId = clientId; }
        public Long getAccountId() { return accountId; }
        public void setAccountId(Long accountId) { this.accountId = accountId; }
        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }
        public String getOrderType() { return orderType; }
        public void setOrderType(String orderType) { this.orderType = orderType; }
        public String getSide() { return side; }
        public void setSide(String side) { this.side = side; }
        public Integer getQuantity() { return quantity; }
        public void setQuantity(Integer quantity) { this.quantity = quantity; }
        public BigDecimal getPrice() { return price; }
        public void setPrice(BigDecimal price) { this.price = price; }
        public String getIdempotencyKey() { return idempotencyKey; }
        public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }
        public LocalDateTime getCreatedAt() { return createdAt; }
        public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
        public String getConditionType() { return conditionType; }
        public void setConditionType(String conditionType) { this.conditionType = conditionType; }
        public BigDecimal getTriggerPrice() { return triggerPrice; }
        public void setTriggerPrice(BigDecimal triggerPrice) { this.triggerPrice = triggerPrice; }
        public Integer getShortWindow() { return shortWindow; }
        public void setShortWindow(Integer shortWindow) { this.shortWindow = shortWindow; }
        public Integer getLongWindow() { return longWindow; }
        public void setLongWindow(Integer longWindow) { this.longWindow = longWindow; }
        public BigDecimal getBandWidth() { return bandWidth; }
        public void setBandWidth(BigDecimal bandWidth) { this.bandWidth = bandWidth; }
        public String getConditionState() { return conditionState; }
        public void setConditionState(String conditionState) { this.conditionState = conditionState; }
        public LocalDateTime getExpiresAt() { return expiresAt; }
        public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
        public LocalDateTime getLastCheckedAt() { return lastCheckedAt; }
        public void setLastCheckedAt(LocalDateTime lastCheckedAt) { this.lastCheckedAt = lastCheckedAt; }
    }
}
