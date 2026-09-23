package com.team1.trading.api.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.Optional;

/**
 * The two statements the Trade REST API needs against {@code users}, which the auth service
 * owns. This side only reads a user's email and links a trading account to them; it never
 * touches credentials, usernames or roles.
 */
@Mapper
public interface UserMapper {

    /**
     * Locks the user's row for the rest of the transaction, so two concurrent link requests
     * for the same user serialise here and the second one sees the first one's account.
     */
    @Select("""
            SELECT id::text AS id, email, account_id AS accountId
            FROM users
            WHERE id = CAST(#{userId} AS uuid)
            FOR UPDATE
            """)
    Optional<UserRow> findForUpdate(@Param("userId") String userId);

    /**
     * Guarded on {@code account_id IS NULL}: a user is linked once, and 0 rows means they
     * already were.
     */
    @Update("""
            UPDATE users
            SET account_id = #{accountId},
                version = version + 1,
                updated = now()
            WHERE id = CAST(#{userId} AS uuid)
              AND account_id IS NULL
            """)
    int linkAccount(@Param("userId") String userId, @Param("accountId") Long accountId);

    class UserRow {
        private String id;
        private String email;
        private Long accountId;

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getEmail() { return email; }
        public void setEmail(String email) { this.email = email; }
        public Long getAccountId() { return accountId; }
        public void setAccountId(Long accountId) { this.accountId = accountId; }
    }
}
