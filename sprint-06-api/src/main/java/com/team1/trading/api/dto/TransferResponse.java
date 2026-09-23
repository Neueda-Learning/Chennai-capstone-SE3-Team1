package com.team1.trading.api.dto;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * A completed transfer and both balances straight after it.
 */
public class TransferResponse {

    private String transferId;
    private Long accountId;
    private TransferDirection direction;
    private BigDecimal amount;
    private BigDecimal walletBalance;
    private BigDecimal bankBalance;
    private LocalDateTime createdAt;

    public TransferResponse() {
    }

    public TransferResponse(String transferId, Long accountId, TransferDirection direction, BigDecimal amount,
                            BigDecimal walletBalance, BigDecimal bankBalance, LocalDateTime createdAt) {
        this.transferId = transferId;
        this.accountId = accountId;
        this.direction = direction;
        this.amount = amount;
        this.walletBalance = walletBalance;
        this.bankBalance = bankBalance;
        this.createdAt = createdAt;
    }

    public String getTransferId() {
        return transferId;
    }

    public void setTransferId(String transferId) {
        this.transferId = transferId;
    }

    public Long getAccountId() {
        return accountId;
    }

    public void setAccountId(Long accountId) {
        this.accountId = accountId;
    }

    public TransferDirection getDirection() {
        return direction;
    }

    public void setDirection(TransferDirection direction) {
        this.direction = direction;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public BigDecimal getWalletBalance() {
        return walletBalance;
    }

    public void setWalletBalance(BigDecimal walletBalance) {
        this.walletBalance = walletBalance;
    }

    public BigDecimal getBankBalance() {
        return bankBalance;
    }

    public void setBankBalance(BigDecimal bankBalance) {
        this.bankBalance = bankBalance;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}
