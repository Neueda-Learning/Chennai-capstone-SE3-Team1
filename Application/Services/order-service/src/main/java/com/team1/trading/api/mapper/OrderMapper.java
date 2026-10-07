package com.team1.trading.api.mapper;

import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Mapper
public interface OrderMapper {

    @Insert("""
            INSERT INTO orders (
                order_id, client_id, account_id, instrument_id, order_type, side, 
                quantity, price, executed_price, status, idempotency_key, 
                external_order_id, created_at, updated_at,
                condition_type, trigger_price, short_window, long_window, band_width, expires_at
            ) VALUES (
                #{order.orderUuid}::uuid, #{order.clientId}, #{order.accountId}, 
                #{order.instrumentId}, #{order.orderType}, #{order.side}, 
                #{order.quantity}, #{order.price}, #{order.executedPrice}, 
                #{order.status}, #{order.idempotencyKey}, #{order.externalOrderId}, 
                now(), now(),
                #{order.conditionType, jdbcType=VARCHAR}, #{order.triggerPrice, jdbcType=NUMERIC},
                #{order.shortWindow, jdbcType=INTEGER}, #{order.longWindow, jdbcType=INTEGER},
                #{order.bandWidth, jdbcType=NUMERIC}, #{order.expiresAt, jdbcType=TIMESTAMP}
            )
            """)
    int insert(@Param("order") OrderInsert order);

    @Select("""
            SELECT * FROM (
                SELECT 0 AS liveFirst,
                       order_id AS orderUuid, client_id AS clientId, account_id AS accountId,
                       instrument_id AS symbol, order_type AS orderType, side, quantity, price,
                       executed_price AS executedPrice,
                       status, idempotency_key AS idempotencyKey, created_at AS createdAt,
                       CAST(NULL AS VARCHAR) AS reason
                FROM orders
                WHERE order_id = #{orderUuid}::uuid
                UNION ALL
                SELECT 1,
                       order_id, client_id, account_id, instrument_id, order_type, side,
                       quantity, price,
                       executed_price, new_status, idempotency_key, order_created_at,
                       failure_code
                FROM order_history
                WHERE order_id = #{orderUuid}::uuid
                  AND idempotency_key IS NOT NULL
            ) o
            ORDER BY o.liveFirst
            LIMIT 1
            """)
    Optional<OrderRow> findByUuid(@Param("orderUuid") String orderUuid);

    @Select("""
            SELECT order_id AS orderUuid, client_id AS clientId, account_id AS accountId,
                   instrument_id AS symbol, order_type AS orderType, side, quantity, price,
                   executed_price AS executedPrice, status,
                   idempotency_key AS idempotencyKey, created_at AS createdAt
            FROM orders
            WHERE status = 'NEW'
            ORDER BY created_at
            """)
    List<OrderRow> findNew();

    @Select("""
            SELECT count(*) FROM order_history
            WHERE idempotency_key = #{idempotencyKey}
            """)
    int countSettledWithIdempotencyKey(@Param("idempotencyKey") String idempotencyKey);

    @Insert("""
            INSERT INTO order_history (
                order_id, event_type, previous_status, new_status, external_status,
                client_id, account_id, instrument_id, order_type, side,
                quantity, price, executed_price, idempotency_key, order_created_at
            ) VALUES (
                #{order.orderUuid}::uuid, 'CANCELLED', #{order.status}, 'CANCELLED', 'CANCELLED',
                #{order.clientId}, #{order.accountId}, #{order.symbol},
                #{order.orderType}, #{order.side},
                #{order.quantity}, #{order.price}, #{order.executedPrice},
                #{order.idempotencyKey}, #{order.createdAt}
            )
            """)
    int archiveCancelled(@Param("order") OrderRow order);

    @Delete("""
            DELETE FROM orders
            WHERE order_id = #{orderUuid}::uuid
              AND status IN ('NEW', 'PENDING')
            """)
    int deleteIfNew(@Param("orderUuid") String orderUuid);

    /** The condition of a live conditional order; empty for an ordinary order or one that has left the book. */
    @Select("""
            SELECT condition_type AS type, trigger_price AS triggerPrice, short_window AS shortWindow,
                   long_window AS longWindow, band_width AS bandWidth, condition_state AS state,
                   expires_at AS expiresAt, last_checked_at AS lastCheckedAt,
                   triggered_at AS triggeredAt, trigger_reason AS triggerReason
            FROM orders
            WHERE order_id = #{orderUuid}::uuid
              AND condition_type IS NOT NULL
            """)
    Optional<ConditionRow> findCondition(@Param("orderUuid") String orderUuid);

    @Select("SELECT count(*) FROM orders WHERE client_id = #{accountId} AND status = 'PENDING'")
    int countPending(@Param("accountId") Long accountId);

    @Select("""
            SELECT * FROM (
                SELECT order_id AS orderUuid, client_id AS clientId, account_id AS accountId,
                       instrument_id AS symbol, side, quantity, price,
                       executed_price AS executedPrice, status,
                       idempotency_key AS idempotencyKey, created_at AS createdAt,
                       CAST(NULL AS VARCHAR) AS reason
                FROM orders
                WHERE client_id = #{filter.clientId}
                UNION ALL
                SELECT order_id, client_id, account_id, instrument_id, side, quantity, price,
                       executed_price, new_status, idempotency_key, order_created_at,
                       failure_code
                FROM order_history
                WHERE client_id = #{filter.clientId}
                  AND idempotency_key IS NOT NULL
            ) o
            WHERE (#{filter.status, jdbcType=VARCHAR}::varchar IS NULL OR o.status = #{filter.status, jdbcType=VARCHAR}::varchar)
              AND (#{filter.from, jdbcType=TIMESTAMP}::timestamp IS NULL OR o.createdAt >= #{filter.from, jdbcType=TIMESTAMP}::timestamp)
              AND (#{filter.to, jdbcType=TIMESTAMP}::timestamp IS NULL OR o.createdAt <= #{filter.to, jdbcType=TIMESTAMP}::timestamp)
            ORDER BY o.createdAt DESC
            """)
    List<OrderRow> listByAccount(@Param("filter") OrderHistoryFilter filter);

    class OrderRow {
        private String orderUuid;
        private Long clientId;
        private Long accountId;
        private String symbol;
        private OrderSide side;
        private Integer quantity;
        private BigDecimal price;
        private BigDecimal executedPrice;
        private String orderType;
        private OrderStatus status;
        private String idempotencyKey;
        private LocalDateTime createdAt;
        private String reason;

        public String getOrderUuid() { return orderUuid; }
        public void setOrderUuid(String orderUuid) { this.orderUuid = orderUuid; }
        public Long getClientId() { return clientId; }
        public void setClientId(Long clientId) { this.clientId = clientId; }
        public Long getAccountId() { return accountId; }
        public void setAccountId(Long accountId) { this.accountId = accountId; }
        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }
        public OrderSide getSide() { return side; }
        public void setSide(OrderSide side) { this.side = side; }
        public Integer getQuantity() { return quantity; }
        public void setQuantity(Integer quantity) { this.quantity = quantity; }
        public BigDecimal getPrice() { return price; }
        public void setPrice(BigDecimal price) { this.price = price; }
        public BigDecimal getExecutedPrice() { return executedPrice; }
        public void setExecutedPrice(BigDecimal executedPrice) { this.executedPrice = executedPrice; }
        public OrderStatus getStatus() { return status; }
        public void setStatus(OrderStatus status) { this.status = status; }
        public String getIdempotencyKey() { return idempotencyKey; }
        public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }
        public LocalDateTime getCreatedAt() { return createdAt; }
        public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
        public String getReason() { return reason; }
        public void setReason(String reason) { this.reason = reason; }
        public String getOrderType() { return orderType; }
        public void setOrderType(String orderType) { this.orderType = orderType; }
    }

    class OrderInsert {
        private String orderUuid;
        private Long clientId;
        private Long accountId;
        private String instrumentId;
        private String orderType;
        private OrderSide side;
        private Integer quantity;
        private BigDecimal price;
        private BigDecimal executedPrice;
        private String status;
        private String idempotencyKey;
        private String externalOrderId;
        private String conditionType;
        private BigDecimal triggerPrice;
        private Integer shortWindow;
        private Integer longWindow;
        private BigDecimal bandWidth;
        private LocalDateTime expiresAt;

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
        public LocalDateTime getExpiresAt() { return expiresAt; }
        public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }

        public String getOrderUuid() { return orderUuid; }
        public void setOrderUuid(String orderUuid) { this.orderUuid = orderUuid; }
        public Long getClientId() { return clientId; }
        public void setClientId(Long clientId) { this.clientId = clientId; }
        public Long getAccountId() { return accountId; }
        public void setAccountId(Long accountId) { this.accountId = accountId; }
        public String getInstrumentId() { return instrumentId; }
        public void setInstrumentId(String instrumentId) { this.instrumentId = instrumentId; }
        public String getOrderType() { return orderType; }
        public void setOrderType(String orderType) { this.orderType = orderType; }
        public OrderSide getSide() { return side; }
        public void setSide(OrderSide side) { this.side = side; }
        public Integer getQuantity() { return quantity; }
        public void setQuantity(Integer quantity) { this.quantity = quantity; }
        public BigDecimal getPrice() { return price; }
        public void setPrice(BigDecimal price) { this.price = price; }
        public BigDecimal getExecutedPrice() { return executedPrice; }
        public void setExecutedPrice(BigDecimal executedPrice) { this.executedPrice = executedPrice; }
        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }
        public String getIdempotencyKey() { return idempotencyKey; }
        public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }
        public String getExternalOrderId() { return externalOrderId; }
        public void setExternalOrderId(String externalOrderId) { this.externalOrderId = externalOrderId; }
    }

    class ConditionRow {
        private String type;
        private BigDecimal triggerPrice;
        private Integer shortWindow;
        private Integer longWindow;
        private BigDecimal bandWidth;
        private String state;
        private LocalDateTime expiresAt;
        private LocalDateTime lastCheckedAt;
        private LocalDateTime triggeredAt;
        private String triggerReason;

        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
        public BigDecimal getTriggerPrice() { return triggerPrice; }
        public void setTriggerPrice(BigDecimal triggerPrice) { this.triggerPrice = triggerPrice; }
        public Integer getShortWindow() { return shortWindow; }
        public void setShortWindow(Integer shortWindow) { this.shortWindow = shortWindow; }
        public Integer getLongWindow() { return longWindow; }
        public void setLongWindow(Integer longWindow) { this.longWindow = longWindow; }
        public BigDecimal getBandWidth() { return bandWidth; }
        public void setBandWidth(BigDecimal bandWidth) { this.bandWidth = bandWidth; }
        public String getState() { return state; }
        public void setState(String state) { this.state = state; }
        public LocalDateTime getExpiresAt() { return expiresAt; }
        public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
        public LocalDateTime getLastCheckedAt() { return lastCheckedAt; }
        public void setLastCheckedAt(LocalDateTime lastCheckedAt) { this.lastCheckedAt = lastCheckedAt; }
        public LocalDateTime getTriggeredAt() { return triggeredAt; }
        public void setTriggeredAt(LocalDateTime triggeredAt) { this.triggeredAt = triggeredAt; }
        public String getTriggerReason() { return triggerReason; }
        public void setTriggerReason(String triggerReason) { this.triggerReason = triggerReason; }
    }

    class OrderHistoryFilter {
        private Long clientId;
        private OrderStatus status;
        private LocalDateTime from;
        private LocalDateTime to;

        public Long getClientId() { return clientId; }
        public void setClientId(Long clientId) { this.clientId = clientId; }
        public OrderStatus getStatus() { return status; }
        public void setStatus(OrderStatus status) { this.status = status; }
        public LocalDateTime getFrom() { return from; }
        public void setFrom(LocalDateTime from) { this.from = from; }
        public LocalDateTime getTo() { return to; }
        public void setTo(LocalDateTime to) { this.to = to; }
    }
}