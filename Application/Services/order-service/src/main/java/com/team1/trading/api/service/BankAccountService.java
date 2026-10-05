package com.team1.trading.api.service;

import com.team1.trading.domain.entity.BankAccount;
import com.team1.trading.api.exception.InvalidAmountException;
import com.team1.trading.api.exception.TransferException;
import com.team1.trading.api.exception.TransferException.Reason;
import com.team1.trading.api.mapper.BankAccountMapper;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

@Service
public class BankAccountService {

    private final BankAccountMapper bankAccountMapper;

    public BankAccountService(BankAccountMapper bankAccountMapper) {
        this.bankAccountMapper = bankAccountMapper;
    }

    public Optional<BankAccount> getBankAccountByAccountNumber(String accountNumber) {
        return bankAccountMapper.findByAccountNumber(accountNumber);
    }

    public Optional<BankAccount> getBankAccountByClientId(Long clientId) {
        return bankAccountMapper.findByClientId(clientId);
    }

    public List<BankAccount> getAllBankAccounts() {
        return bankAccountMapper.findAll();
    }

    public BankAccount createBankAccount(Long clientId, String accountNumber,
                                        String bankName, String ifscCode, BigDecimal initialBalance) {
        BankAccount bankAccount = new BankAccount(clientId, accountNumber, bankName, ifscCode);
        if (initialBalance != null && initialBalance.compareTo(BigDecimal.ZERO) > 0) {
            bankAccount.deposit(initialBalance);
        }
        bankAccountMapper.save(bankAccount);
        return bankAccount;
    }

    public boolean deposit(String accountNumber, BigDecimal amount) {
        return bankAccountMapper.credit(accountNumber, validAmount(amount)) > 0;
    }

    public boolean withdraw(String accountNumber, BigDecimal amount) {
        BigDecimal value = validAmount(amount);
        Optional<BankAccount> account = bankAccountMapper.findByAccountNumber(accountNumber);
        if (account.isEmpty()) {
            return false;
        }
        if (bankAccountMapper.debitIfCovered(accountNumber, value) == 0) {
            throw new TransferException(Reason.INSUFFICIENT_FUNDS, account.get().getClientId(),
                    "bank balance cannot cover a withdrawal of " + value);
        }
        return true;
    }

    private static BigDecimal validAmount(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0 || amount.stripTrailingZeros().scale() > 2) {
            throw new InvalidAmountException(amount);
        }
        return amount.setScale(2);
    }
}
