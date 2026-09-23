package com.team1.trading.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /api/v1/bank-accounts}. There is no client id or email here: who the
 * account belongs to comes from the verified token, never from the body.
 */
public class LinkBankAccountRequest {

    @NotBlank
    @Size(max = 150)
    private String accountHolderName;

    @NotBlank
    @Pattern(regexp = "^\\+?[0-9]{7,15}$")
    private String phone;

    @NotBlank
    @Pattern(regexp = "^[A-Z0-9]{6,34}$")
    private String accountNumber;

    @NotBlank
    @Size(max = 150)
    private String bankName;

    /** Indian Financial System Code: four letters, a zero, then six letters or digits. */
    @NotBlank
    @Pattern(regexp = "^[A-Z]{4}0[A-Z0-9]{6}$")
    private String ifscCode;

    public LinkBankAccountRequest() {
    }

    public LinkBankAccountRequest(String accountHolderName, String phone, String accountNumber,
                                  String bankName, String ifscCode) {
        this.accountHolderName = accountHolderName;
        this.phone = phone;
        this.accountNumber = accountNumber;
        this.bankName = bankName;
        this.ifscCode = ifscCode;
    }

    public String getAccountHolderName() {
        return accountHolderName;
    }

    public void setAccountHolderName(String accountHolderName) {
        this.accountHolderName = accountHolderName;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
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
}
