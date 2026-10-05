package com.team1.trading.api.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.Optional;

@Mapper
public interface UserMapper {

    @Select("""
            SELECT id::text AS id, username, email, account_id AS accountId
            FROM users
            WHERE id = CAST(#{userId} AS uuid)
            FOR UPDATE
            """)
    Optional<UserRow> findForUpdate(@Param("userId") String userId);

    @Update("""
            UPDATE users
            SET account_id = #{accountId},
                version = version + 1,
                updated = now()
            WHERE id = CAST(#{userId} AS uuid)
              AND account_id IS NULL
            """)
    int linkAccount(@Param("userId") String userId, @Param("accountId") Long accountId);

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
