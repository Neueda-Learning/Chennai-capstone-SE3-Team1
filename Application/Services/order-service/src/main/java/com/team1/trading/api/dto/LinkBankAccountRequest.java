package com.team1.trading.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public class LinkBankAccountRequest {

    @NotBlank
    @Pattern(regexp = "^[A-Z0-9]{6,34}$")
    private String accountNumber;

    public LinkBankAccountRequest() {
    }

    public LinkBankAccountRequest(String accountNumber) {
        this.accountNumber = accountNumber;
    }

    public String getAccountNumber() {
        return accountNumber;
    }

    public void setAccountNumber(String accountNumber) {
        this.accountNumber = accountNumber;
    }
}
