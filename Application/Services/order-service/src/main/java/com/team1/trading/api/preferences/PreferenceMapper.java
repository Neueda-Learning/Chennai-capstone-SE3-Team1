package com.team1.trading.api.preferences;

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
public interface PreferenceMapper {

    @Select("""
            SELECT account_id AS accountId, default_account_id AS defaultAccountId,
                   channel, updated_at AS updatedAt
            FROM customer_preferences
            WHERE account_id = #{accountId}
            """)
    Optional<PreferenceRow> find(@Param("accountId") Long accountId);

    @Update("""
            UPDATE customer_preferences
            SET default_account_id = #{defaultAccountId},
                channel = #{channel},
                updated_at = CURRENT_TIMESTAMP
            WHERE account_id = #{accountId}
            """)
    int update(@Param("accountId") Long accountId, @Param("defaultAccountId") Long defaultAccountId,
               @Param("channel") String channel);

    @Insert("""
            INSERT INTO customer_preferences (account_id, default_account_id, channel)
            VALUES (#{accountId}, #{defaultAccountId}, #{channel})
            """)
    int insert(@Param("accountId") Long accountId, @Param("defaultAccountId") Long defaultAccountId,
               @Param("channel") String channel);

    @Select("""
            SELECT account_id
            FROM users
            WHERE account_id = #{accountId}
            """)
    List<Long> findOwnedAccountIds(@Param("accountId") Long accountId);

    @Select("""
            SELECT p.channel AS channel, p.channel_contact_override AS contactOverride,
                   u.email AS email
            FROM customer_preferences p
            LEFT JOIN users u ON u.account_id = p.account_id
            WHERE p.account_id = #{accountId}
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    Optional<ResolutionRow> findForResolution(@Param("accountId") Long accountId);

    class PreferenceRow {
        private Long accountId;
        private Long defaultAccountId;
        private String channel;
        private LocalDateTime updatedAt;

        public Long getAccountId() { return accountId; }
        public void setAccountId(Long accountId) { this.accountId = accountId; }
        public Long getDefaultAccountId() { return defaultAccountId; }
        public void setDefaultAccountId(Long defaultAccountId) { this.defaultAccountId = defaultAccountId; }
        public String getChannel() { return channel; }
        public void setChannel(String channel) { this.channel = channel; }
        public LocalDateTime getUpdatedAt() { return updatedAt; }
        public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    }

    class ResolutionRow {
        private String channel;
        private String contactOverride;
        private String email;

        public String getChannel() { return channel; }
        public void setChannel(String channel) { this.channel = channel; }
        public String getContactOverride() { return contactOverride; }
        public void setContactOverride(String contactOverride) { this.contactOverride = contactOverride; }
        public String getEmail() { return email; }
        public void setEmail(String email) { this.email = email; }

        @Override
        public String toString() {
            return "ResolutionRow[channel=" + channel + ", contact=***]";
        }
    }
}
