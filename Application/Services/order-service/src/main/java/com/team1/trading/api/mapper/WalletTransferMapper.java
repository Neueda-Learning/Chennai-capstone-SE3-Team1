package com.team1.trading.api.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * The statements behind a transfer between a client's bank account and wallet.
 *
 * <p>Each debit is a single guarded UPDATE ({@code ... AND balance >= amount}), so the check
 * and the write cannot be separated by a concurrent request: 0 rows means the balance could
 * not cover it. The wallet updates also bump {@code clients.version}, which is what makes an
 * optimistic writer elsewhere (order settlement) notice the balance moved under it.
 */
@Mapper
public interface WalletTransferMapper {

    @Insert("""
            INSERT INTO wallet_transfers (transfer_id, client_id, account_number, direction, amount, idempotency_key, created_at)
            VALUES (CAST(#{t.transferId} AS uuid), #{t.clientId}, #{t.accountNumber}, #{t.direction},
                    #{t.amount}, #{t.idempotencyKey}, #{t.createdAt})
            """)
    int insert(@Param("t") TransferRow transfer);

    @Update("""
            UPDATE bank_account
            SET account_balance = account_balance - #{amount}
            WHERE account_number = #{accountNumber}
              AND account_balance >= #{amount}
            """)
    int debitBank(@Param("accountNumber") String accountNumber, @Param("amount") BigDecimal amount);

    @Update("""
            UPDATE bank_account
            SET account_balance = account_balance + #{amount}
            WHERE account_number = #{accountNumber}
            """)
    int creditBank(@Param("accountNumber") String accountNumber, @Param("amount") BigDecimal amount);

    @Update("""
            UPDATE clients
            SET wallet_balance = wallet_balance - #{amount},
                version = version + 1,
                updated_on = now()
            WHERE client_id = #{clientId}
              AND wallet_balance >= #{amount}
            """)
    int debitWallet(@Param("clientId") Long clientId, @Param("amount") BigDecimal amount);

    @Update("""
            UPDATE clients
            SET wallet_balance = wallet_balance + #{amount},
                version = version + 1,
                updated_on = now()
            WHERE client_id = #{clientId}
            """)
    int creditWallet(@Param("clientId") Long clientId, @Param("amount") BigDecimal amount);

    @Select("SELECT wallet_balance FROM clients WHERE client_id = #{clientId}")
    BigDecimal walletBalance(@Param("clientId") Long clientId);

    @Select("SELECT account_balance FROM bank_account WHERE account_number = #{accountNumber}")
    BigDecimal bankBalance(@Param("accountNumber") String accountNumber);

    class TransferRow {
        private String transferId;
        private Long clientId;
        private String accountNumber;
        private String direction;
        private BigDecimal amount;
        private String idempotencyKey;
        private LocalDateTime createdAt;

        public TransferRow() {
        }

        public TransferRow(String transferId, Long clientId, String accountNumber, String direction,
                           BigDecimal amount, String idempotencyKey, LocalDateTime createdAt) {
            this.transferId = transferId;
            this.clientId = clientId;
            this.accountNumber = accountNumber;
            this.direction = direction;
            this.amount = amount;
            this.idempotencyKey = idempotencyKey;
            this.createdAt = createdAt;
        }

        public String getTransferId() { return transferId; }
        public void setTransferId(String transferId) { this.transferId = transferId; }
        public Long getClientId() { return clientId; }
        public void setClientId(Long clientId) { this.clientId = clientId; }
        public String getAccountNumber() { return accountNumber; }
        public void setAccountNumber(String accountNumber) { this.accountNumber = accountNumber; }
        public String getDirection() { return direction; }
        public void setDirection(String direction) { this.direction = direction; }
        public BigDecimal getAmount() { return amount; }
        public void setAmount(BigDecimal amount) { this.amount = amount; }
        public String getIdempotencyKey() { return idempotencyKey; }
        public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }
        public LocalDateTime getCreatedAt() { return createdAt; }
        public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    }
}
