package com.team1.trading.api.dto;

/**
 * The trading account a successful link created. {@code accountId} is the value the caller's
 * next token carries in its {@code accountId} claim, once they call {@code /auth/refresh}.
 */
public class LinkedBankAccountResponse {

    private Long accountId;
    private String accountNumber;
    private String bankName;
    private String ifscCode;
    private String accountState;

    public LinkedBankAccountResponse() {
    }

    public LinkedBankAccountResponse(Long accountId, String accountNumber, String bankName,
                                     String ifscCode, String accountState) {
        this.accountId = accountId;
        this.accountNumber = accountNumber;
        this.bankName = bankName;
        this.ifscCode = ifscCode;
        this.accountState = accountState;
    }

    public Long getAccountId() {
        return accountId;
    }

    public void setAccountId(Long accountId) {
        this.accountId = accountId;
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

    public String getAccountState() {
        return accountState;
    }

    public void setAccountState(String accountState) {
        this.accountState = accountState;
    }
}
