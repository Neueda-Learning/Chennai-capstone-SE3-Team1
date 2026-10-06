package com.team1.trading.api.watchlists;

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

@Mapper
public interface PriceAlertMapper {

    String COLUMNS = """
            CAST(alert_id AS VARCHAR(36)) AS id, account_id AS accountId, instrument_id AS symbol,
            threshold, direction, state, delivery_state AS deliveryState,
            fired_at AS firedAt, fired_price AS firedPrice, created_at AS createdAt
            """;

    @Insert("""
            INSERT INTO price_alerts (alert_id, account_id, instrument_id, threshold, direction,
                                      state, created_at, updated_at)
            VALUES (CAST(#{id} AS UUID), #{accountId}, #{symbol}, #{threshold}, #{direction},
                    'ARMED', #{now}, #{now})
            """)
    int insert(@Param("id") String id, @Param("accountId") long accountId, @Param("symbol") String symbol,
               @Param("threshold") BigDecimal threshold, @Param("direction") String direction,
               @Param("now") LocalDateTime now);

    @Select("SELECT COUNT(*) FROM price_alerts WHERE account_id = #{accountId}")
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int countForAccount(@Param("accountId") long accountId);

    @Select("SELECT " + COLUMNS + """
            FROM price_alerts
            WHERE account_id = #{accountId}
            ORDER BY created_at DESC, alert_id
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<AlertRow> findForAccount(@Param("accountId") long accountId);

    @Select("SELECT " + COLUMNS + """
            FROM price_alerts
            WHERE account_id = #{accountId} AND alert_id = CAST(#{id} AS UUID)
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    Optional<AlertRow> find(@Param("accountId") long accountId, @Param("id") String id);

    @Delete("""
            DELETE FROM price_alerts
            WHERE account_id = #{accountId} AND alert_id = CAST(#{id} AS UUID)
            """)
    int delete(@Param("accountId") long accountId, @Param("id") String id);

    @Update("""
            UPDATE price_alerts
            SET state = 'ARMED', delivery_state = NULL, fired_at = NULL, fired_price = NULL,
                updated_at = #{now}
            WHERE account_id = #{accountId} AND alert_id = CAST(#{id} AS UUID)
              AND state IN ('FIRED', 'DISABLED')
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int rearm(@Param("accountId") long accountId, @Param("id") String id, @Param("now") LocalDateTime now);

    @Update("""
            UPDATE price_alerts
            SET state = 'DISABLED', updated_at = #{now}
            WHERE account_id = #{accountId} AND alert_id = CAST(#{id} AS UUID)
              AND state IN ('ARMED', 'FIRED')
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int disable(@Param("accountId") long accountId, @Param("id") String id, @Param("now") LocalDateTime now);

    @Select("SELECT " + COLUMNS + """
            FROM price_alerts
            WHERE instrument_id = #{symbol}
              AND state = 'ARMED'
              AND ((direction = 'ABOVE' AND #{price} >= threshold)
                OR (direction = 'BELOW' AND #{price} <= threshold))
            ORDER BY created_at, alert_id
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<AlertRow> findCrossedArmed(@Param("symbol") String symbol, @Param("price") BigDecimal price);

    @Update("""
            UPDATE price_alerts
            SET state = 'FIRED', fired_at = #{firedAt}, fired_price = #{price},
                delivery_state = NULL, updated_at = #{firedAt}
            WHERE alert_id = CAST(#{id} AS UUID) AND state = 'ARMED'
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int fire(@Param("id") String id, @Param("firedAt") LocalDateTime firedAt, @Param("price") BigDecimal price);

    @Update("""
            UPDATE price_alerts
            SET delivery_state = #{deliveryState}, updated_at = #{now}
            WHERE alert_id = CAST(#{id} AS UUID) AND state = 'FIRED' AND delivery_state IS NULL
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int setDeliveryState(@Param("id") String id, @Param("deliveryState") String deliveryState,
                         @Param("now") LocalDateTime now);

    @Select("SELECT " + COLUMNS + """
            FROM price_alerts
            WHERE state = 'FIRED' AND delivery_state IS NULL AND fired_at < #{firedBefore}
            ORDER BY fired_at
            LIMIT #{limit}
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<AlertRow> findUndelivered(@Param("firedBefore") LocalDateTime firedBefore, @Param("limit") int limit);

    class AlertRow {
        private String id;
        private long accountId;
        private String symbol;
        private BigDecimal threshold;
        private String direction;
        private String state;
        private String deliveryState;
        private LocalDateTime firedAt;
        private BigDecimal firedPrice;
        private LocalDateTime createdAt;

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public long getAccountId() { return accountId; }
        public void setAccountId(long accountId) { this.accountId = accountId; }
        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }
        public BigDecimal getThreshold() { return threshold; }
        public void setThreshold(BigDecimal threshold) { this.threshold = threshold; }
        public String getDirection() { return direction; }
        public void setDirection(String direction) { this.direction = direction; }
        public String getState() { return state; }
        public void setState(String state) { this.state = state; }
        public String getDeliveryState() { return deliveryState; }
        public void setDeliveryState(String deliveryState) { this.deliveryState = deliveryState; }
        public LocalDateTime getFiredAt() { return firedAt; }
        public void setFiredAt(LocalDateTime firedAt) { this.firedAt = firedAt; }
        public BigDecimal getFiredPrice() { return firedPrice; }
        public void setFiredPrice(BigDecimal firedPrice) { this.firedPrice = firedPrice; }
        public LocalDateTime getCreatedAt() { return createdAt; }
        public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    }
}
