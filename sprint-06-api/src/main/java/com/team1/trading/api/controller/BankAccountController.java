package com.team1.trading.api.controller;

import com.team1.trading.domain.entity.BankAccount;
import com.team1.trading.api.dto.CreateBankAccountRequest;
import com.team1.trading.api.security.AccessGuard;
import com.team1.trading.api.service.BankAccountService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/**
 * Pre-v1 bank-account routes. Every one needs a verified token ({@code JwtVerificationFilter});
 * a customer reaches only the bank account linked to their own client, and creating bank
 * accounts or listing them all is for admins.
 */
@RestController
@RequestMapping("/api/bank-accounts")
public class BankAccountController {

    private final BankAccountService bankAccountService;
    private final AccessGuard accessGuard;

    public BankAccountController(BankAccountService bankAccountService, AccessGuard accessGuard) {
        this.bankAccountService = bankAccountService;
        this.accessGuard = accessGuard;
    }

    /** Admin only: a customer links their bank account with POST /api/v1/bank-accounts. */
    @PostMapping
    public ResponseEntity<BankAccount> createBankAccount(@Valid @RequestBody CreateBankAccountRequest request) {
        accessGuard.requireAdmin();
        BankAccount bankAccount = bankAccountService.createBankAccount(
                request.getClientId(),
                request.getAccountNumber(),
                request.getName(),
                request.getPhone(),
                request.getEmail(),
                request.getBankName(),
                request.getIfscCode(),
                request.getInitialBalance()
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(bankAccount);
    }

    @GetMapping("/account/{accountNumber}")
    public ResponseEntity<BankAccount> getBankAccountByAccountNumber(@PathVariable String accountNumber) {
        Optional<BankAccount> bankAccount = requireOwnerOrAdmin(accountNumber);
        return bankAccount.map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/client/{clientId}")
    public ResponseEntity<BankAccount> getBankAccountByClientId(@PathVariable Long clientId) {
        accessGuard.requireOwnerOrAdmin(clientId);
        return bankAccountService.getBankAccountByClientId(clientId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping
    public List<BankAccount> getAllBankAccounts() {
        accessGuard.requireAdmin();
        return bankAccountService.getAllBankAccounts();
    }

    @PutMapping("/{accountNumber}/contact")
    public ResponseEntity<Void> updateContact(@PathVariable String accountNumber,
                                              @RequestParam String phone,
                                              @RequestParam String email) {
        requireOwnerOrAdmin(accountNumber);
        boolean updated = bankAccountService.updateContact(accountNumber, phone, email);
        return updated ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }

    @PutMapping("/{accountNumber}/deposit")
    public ResponseEntity<Void> deposit(@PathVariable String accountNumber,
                                        @RequestParam BigDecimal amount) {
        requireOwnerOrAdmin(accountNumber);
        boolean updated = bankAccountService.deposit(accountNumber, amount);
        return updated ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }

    @PutMapping("/{accountNumber}/withdraw")
    public ResponseEntity<Void> withdraw(@PathVariable String accountNumber,
                                         @RequestParam BigDecimal amount) {
        requireOwnerOrAdmin(accountNumber);
        boolean updated = bankAccountService.withdraw(accountNumber, amount);
        return updated ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }

    /**
     * Looks the bank account up and checks the caller owns it. A customer gets the same
     * {@code ACC-403} for an account number that does not exist as for someone else's.
     */
    private Optional<BankAccount> requireOwnerOrAdmin(String accountNumber) {
        Optional<BankAccount> bankAccount = bankAccountService.getBankAccountByAccountNumber(accountNumber);
        accessGuard.requireOwnerOrAdmin(bankAccount.map(BankAccount::getClientId));
        return bankAccount;
    }
}
