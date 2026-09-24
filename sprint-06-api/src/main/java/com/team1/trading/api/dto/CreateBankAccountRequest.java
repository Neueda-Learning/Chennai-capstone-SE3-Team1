package com.team1.trading.api.dto;

import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;

public class CreateBankAccountRequest {

    /** Optional: leave it out to add an unclaimed bank account for onboarding to claim later. */
    private Long clientId;

    @NotBlank(message = "Account number is required")
    private String accountNumber;

    @NotBlank(message = "Bank name is required")
    private String bankName;

    @NotBlank(message = "IFSC code is required")
    private String ifscCode;

    private BigDecimal initialBalance;

    public CreateBankAccountRequest() {
    }

    public Long getClientId() {
        return clientId;
    }

    public void setClientId(Long clientId) {
        this.clientId = clientId;
    }

    public String getAccountNumber() {
        return accountNumber;
    }

    public void setAccountNumber(String accountNumber) {
        this.accountNumber = accountNumber;
    }

    public String getBankName() {
        return bankName;
    }

    public void setBankName(String bankName) {
        this.bankName = bankName;
    }

    public String getIfscCode() {
        return ifscCode;
    }

    public void setIfscCode(String ifscCode) {
        this.ifscCode = ifscCode;
    }

    public BigDecimal getInitialBalance() {
        return initialBalance != null ? initialBalance : BigDecimal.ZERO;
    }

    public void setInitialBalance(BigDecimal initialBalance) {
        this.initialBalance = initialBalance;
    }
}
