package com.team1.trading.api.controller;

import com.team1.trading.api.dto.LinkBankAccountRequest;
import com.team1.trading.api.dto.LinkedBankAccountResponse;
import com.team1.trading.api.security.JwtAuthenticationException;
import com.team1.trading.api.security.JwtClaims;
import com.team1.trading.api.security.JwtRequestContext;
import com.team1.trading.api.service.BankAccountLinkService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Links a bank account to the authenticated user, creating their trading account.
 *
 * <p>Under {@code /api/v1/}, so {@code JwtVerificationFilter} has already verified the token
 * before this runs. It is the one account route a token without an {@code accountId} claim is
 * meant for.
 */
@RestController
@RequestMapping("/api/v1/bank-accounts")
public class BankAccountLinkController {

    private final BankAccountLinkService bankAccountLinkService;

    public BankAccountLinkController(BankAccountLinkService bankAccountLinkService) {
        this.bankAccountLinkService = bankAccountLinkService;
    }

    @PostMapping
    public ResponseEntity<LinkedBankAccountResponse> link(@Valid @RequestBody LinkBankAccountRequest request) {
        JwtClaims claims = JwtRequestContext.getClaims();
        if (claims == null) {
            throw new JwtAuthenticationException("no verified token on the request");
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(bankAccountLinkService.link(claims.getSub(), request));
    }
}
