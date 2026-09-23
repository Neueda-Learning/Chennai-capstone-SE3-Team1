package com.team1.trading.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Body of {@code POST /api/v1/bank-accounts}: the number of an existing, unclaimed bank account.
 * The holder's name, phone and bank details are already on the bank account; who is claiming it
 * comes from the verified token, never from the body.
 */
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
