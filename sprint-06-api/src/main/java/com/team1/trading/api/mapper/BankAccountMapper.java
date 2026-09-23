package com.team1.trading.api.mapper;

import com.team1.trading.domain.entity.BankAccount;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Optional;

@Mapper
public interface BankAccountMapper {

    @Select("""
            SELECT client_id, account_number, name, phone, email, account_balance, bank_name, ifsc_code
            FROM bank_account
            WHERE account_number = #{accountNumber}
            """)
    Optional<BankAccount> findByAccountNumber(@Param("accountNumber") String accountNumber);

    @Select("""
            SELECT client_id, account_number, name, phone, email, account_balance, bank_name, ifsc_code
            FROM bank_account
            WHERE client_id = #{clientId}
            """)
    Optional<BankAccount> findByClientId(@Param("clientId") Long clientId);

    @Select("""
            SELECT client_id, account_number, name, phone, email, account_balance, bank_name, ifsc_code
            FROM bank_account
            ORDER BY account_number
            """)
    List<BankAccount> findAll();

    @Insert("""
            INSERT INTO bank_account (client_id, account_number, name, phone, email, account_balance, bank_name, ifsc_code)
            VALUES (#{clientId}, #{accountNumber}, #{name}, #{phone}, #{email}, #{accountBalance}, #{bankName}, #{ifscCode})
            """)
    int save(BankAccount bankAccount);

    @Update("""
            UPDATE bank_account
            SET phone = #{phone}, email = #{email}
            WHERE account_number = #{accountNumber}
            """)
    int updateContact(BankAccount bankAccount);

    @Update("""
            UPDATE bank_account
            SET account_balance = account_balance + #{amount}
            WHERE account_number = #{accountNumber}
            """)
    int credit(@Param("accountNumber") String accountNumber, @Param("amount") java.math.BigDecimal amount);

    /**
     * Guarded in the statement itself, so the balance check and the write cannot be split by a
     * concurrent request: 0 rows means the account does not hold the amount.
     */
    @Update("""
            UPDATE bank_account
            SET account_balance = account_balance - #{amount}
            WHERE account_number = #{accountNumber}
              AND account_balance >= #{amount}
            """)
    int debitIfCovered(@Param("accountNumber") String accountNumber, @Param("amount") java.math.BigDecimal amount);
}
