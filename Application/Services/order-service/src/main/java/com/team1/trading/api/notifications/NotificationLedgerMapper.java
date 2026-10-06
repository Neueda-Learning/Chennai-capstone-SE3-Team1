package com.team1.trading.api.notifications;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Mapper
public interface NotificationLedgerMapper {

    String COLUMNS = """
            id, event_id AS eventId, account_id AS accountId, kind, channel, address, status,
            failure_code AS failureCode, payload, created_at AS createdAt, delivered_at AS deliveredAt
            """;

    @Select("SELECT COUNT(*) FROM clients WHERE client_id = #{accountId}")
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int countAccount(@Param("accountId") Long accountId);

    @Select("SELECT " + COLUMNS + " FROM notifications WHERE event_id = #{eventId}")
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    Optional<LedgerRow> findByEventId(@Param("eventId") String eventId);

    @Insert("""
            INSERT INTO notifications (id, event_id, account_id, kind, channel, address, status, payload, created_at)
            VALUES (CAST(#{id} AS UUID), #{eventId}, #{accountId}, #{kind}, #{channel}, #{address}, #{status},
                    #{payload}, #{createdAt})
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int insert(LedgerRow row);

    @Select("SELECT COUNT(*) FROM notifications WHERE account_id = #{accountId}")
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    long countForAccount(@Param("accountId") Long accountId);

    @Delete("""
            DELETE FROM notifications
            WHERE account_id = #{accountId}
              AND id IN (SELECT id FROM notifications
                         WHERE account_id = #{accountId}
                         ORDER BY created_at DESC, id DESC
                         OFFSET #{cap} ROWS)
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int pruneBeyond(@Param("accountId") Long accountId, @Param("cap") int cap);

    @Select("SELECT " + COLUMNS + " FROM notifications WHERE status = #{status} "
            + "ORDER BY created_at, id LIMIT #{limit}")
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<LedgerRow> findByStatus(@Param("status") String status, @Param("limit") int limit);

    @Update("""
            UPDATE notifications
            SET status = 'SENT', delivered_at = #{deliveredAt}, failure_code = NULL
            WHERE id = CAST(#{id} AS UUID) AND status = 'QUEUED'
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int markSent(@Param("id") String id, @Param("deliveredAt") LocalDateTime deliveredAt);

    @Update("""
            UPDATE notifications
            SET status = 'FAILED', failure_code = #{failureCode}
            WHERE id = CAST(#{id} AS UUID) AND status = 'QUEUED'
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int markFailed(@Param("id") String id, @Param("failureCode") String failureCode);

    @Update("""
            UPDATE notifications
            SET status = 'QUEUED', channel = #{channel}, address = #{address}
            WHERE id = CAST(#{id} AS UUID) AND status = 'PENDING_CHANNEL'
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int markQueued(@Param("id") String id, @Param("channel") String channel, @Param("address") String address);

    @Select("""
            <script>
            SELECT id, kind, channel, status, payload, created_at AS createdAt, delivered_at AS deliveredAt
            FROM notifications
            WHERE account_id = #{accountId}
            <if test="before != null">AND created_at &lt; #{before}</if>
            ORDER BY created_at DESC, id DESC
            LIMIT #{limit}
            </script>
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<LedgerRow> history(@Param("accountId") Long accountId, @Param("before") LocalDateTime before,
                            @Param("limit") int limit);

    class LedgerRow {
        private String id;
        private String eventId;
        private Long accountId;
        private String kind;
        private String channel;
        private String address;
        private String status;
        private String failureCode;
        private String payload;
        private LocalDateTime createdAt;
        private LocalDateTime deliveredAt;

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getEventId() { return eventId; }
        public void setEventId(String eventId) { this.eventId = eventId; }
        public Long getAccountId() { return accountId; }
        public void setAccountId(Long accountId) { this.accountId = accountId; }
        public String getKind() { return kind; }
        public void setKind(String kind) { this.kind = kind; }
        public String getChannel() { return channel; }
        public void setChannel(String channel) { this.channel = channel; }
        public String getAddress() { return address; }
        public void setAddress(String address) { this.address = address; }
        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }
        public String getFailureCode() { return failureCode; }
        public void setFailureCode(String failureCode) { this.failureCode = failureCode; }
        public String getPayload() { return payload; }
        public void setPayload(String payload) { this.payload = payload; }
        public LocalDateTime getCreatedAt() { return createdAt; }
        public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
        public LocalDateTime getDeliveredAt() { return deliveredAt; }
        public void setDeliveredAt(LocalDateTime deliveredAt) { this.deliveredAt = deliveredAt; }

        @Override
        public String toString() {
            return "LedgerRow[id=" + id + ", kind=" + kind + ", channel=" + channel
                    + ", status=" + status + ", address=***]";
        }
    }
}
