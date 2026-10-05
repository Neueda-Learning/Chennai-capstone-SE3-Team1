package com.team1.trading.api.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.Optional;

/**
 * The statements the Trade REST API needs against {@code users}, which the auth service owns.
 * This side reads a user's email, phone and username, links a trading account to them and
 * writes their contact details; it never touches credentials or roles. Username is read only to
 * name the {@code clients} row a claim creates (bank_account carries no name of its own since
 * migration 020); it is never written back. Since migration 021, email and phone live only here
 * - {@code clients} carries neither - so this is the one place either is read or written from
 * the Trade API side.
 */
@Mapper
public interface UserMapper {

    /**
     * Locks the user's row for the rest of the transaction, so two concurrent link requests
     * for the same user serialise here and the second one sees the first one's account.
     */
    @Select("""
            SELECT id::text AS id, username, email, account_id AS accountId
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

    /**
     * The only writer of a linked user's email/phone: {@code ClientService.updateClientProfile()}
     * (Trade API) calls this for both fields in one statement. Only email can violate a
     * constraint ({@code uq_users_email}) - phone has none.
     */
    @Update("""
            UPDATE users
            SET email = #{email},
                phone = #{phone},
                version = version + 1,
                updated = now()
            WHERE account_id = #{accountId}
            """)
    int updateContact(@Param("accountId") Long accountId, @Param("email") String email,
                       @Param("phone") String phone);

    /** Backs {@code ClientController}'s read responses: clients carries neither field itself. */
    @Select("""
            SELECT email, phone
            FROM users
            WHERE account_id = #{accountId}
            """)
    Optional<ContactRow> findContactByAccountId(@Param("accountId") Long accountId);

    class UserRow {
        private String id;
        private String username;
        private String email;
        private Long accountId;

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getUsername() { return username; }
        public void setUsername(String username) { this.username = username; }
        public String getEmail() { return email; }
        public void setEmail(String email) { this.email = email; }
        public Long getAccountId() { return accountId; }
        public void setAccountId(Long accountId) { this.accountId = accountId; }
    }

    class ContactRow {
        private String email;
        private String phone;

        public String getEmail() { return email; }
        public void setEmail(String email) { this.email = email; }
        public String getPhone() { return phone; }
        public void setPhone(String phone) { this.phone = phone; }
    }
}
