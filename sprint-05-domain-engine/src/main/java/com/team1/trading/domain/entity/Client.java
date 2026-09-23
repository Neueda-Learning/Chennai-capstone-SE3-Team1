package com.team1.trading.domain.entity;

import com.team1.trading.domain.entity.types.AccountStatus;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.Objects;

public class Client {

    private Long clientId;
    private String name;
    private String email;
    private String phone;
    private LocalDateTime createdOn;
    private String accountState;
    private BigDecimal walletBalance;
    private Integer version;
    private LocalDateTime updatedOn;

    public Client(Long clientId, String name, String email, String phone) {
        this.clientId = clientId;
        this.name = name;
        this.email = email;
        this.phone = phone;
        this.createdOn = LocalDateTime.now();
        this.accountState = "ACTIVE";
        this.walletBalance = BigDecimal.ZERO.setScale(2, RoundingMode.UNNECESSARY);
        this.version = 0;
        this.updatedOn = this.createdOn;
    }

    public Client(Long clientId, String name, String email, String phone,
                  LocalDateTime createdOn, String accountState, BigDecimal walletBalance) {
        this.clientId = clientId;
        this.name = name;
        this.email = email;
        this.phone = phone;
        this.createdOn = createdOn;
        this.accountState = accountState;
        this.walletBalance = walletBalance;
        this.version = 0;
        this.updatedOn = createdOn;
    }

    public Client(Long clientId, String name, String email, String phone,
                  LocalDateTime createdOn, String accountState, BigDecimal walletBalance,
                  Integer version, LocalDateTime updatedOn) {
        this(clientId, name, email, phone, createdOn, accountState, walletBalance);
        this.version = Objects.requireNonNull(version, "version must not be null");
        this.updatedOn = Objects.requireNonNull(updatedOn, "updatedOn must not be null");
    }

    public Long getClientId() {
        return clientId;
    }

    public String getName() {
        return name;
    }

    public String getEmail() {
        return email;
    }

    public String getPhone() {
        return phone;
    }

    public LocalDateTime getCreatedOn() {
        return createdOn;
    }

    public String getAccountState() {
        return accountState;
    }

    public BigDecimal getWalletBalance() {
        return walletBalance;
    }

    public Integer getVersion() {
        return version;
    }

    public LocalDateTime getUpdatedOn() {
        return updatedOn;
    }

    public void updateProfile(String name, String email, String phone) {
        this.name = name;
        this.email = email;
        this.phone = phone;
        touch();
    }

    public boolean canTrade() {
        return AccountStatus.ACTIVE.name().equals(accountState);
    }

    public void activate() {
        this.accountState = AccountStatus.ACTIVE.name();
        touch();
    }

    public void suspend() {
        this.accountState = AccountStatus.SUSPENDED.name();
        touch();
    }

    public void close() {
        this.accountState = AccountStatus.CLOSED.name();
        touch();
    }

    public boolean canAfford(BigDecimal amount) {
        return walletBalance.compareTo(money(amount)) >= 0;
    }

    public void credit(BigDecimal amount) {
        this.walletBalance = money(walletBalance.add(money(amount)));
        touch();
    }

    public void debit(BigDecimal amount) {
        BigDecimal value = money(amount);
        if (walletBalance.compareTo(value) < 0) {
            throw new IllegalStateException(
                    "balance " + walletBalance + " cannot cover a debit of " + value);
        }
        this.walletBalance = money(walletBalance.subtract(value));
        touch();
    }

    private void touch() {
        this.version++;
        this.updatedOn = LocalDateTime.now();
    }

    private static BigDecimal money(BigDecimal amount) {
        if (amount == null) {
            throw new IllegalArgumentException("amount must not be null");
        }
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("amount must not be negative: " + amount);
        }
        return amount.setScale(2, RoundingMode.HALF_UP);
    }
}
