package com.team1.trading.api.controller;

import com.team1.trading.api.dto.TransferRequest;
import com.team1.trading.api.dto.TransferResponse;
import com.team1.trading.api.security.TokenAccountIdResolver;
import com.team1.trading.api.service.WalletTransferService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /api/v1/accounts/{id}/transfers}: moves money between the account's wallet and its
 * linked bank account, in the direction the body names. Under {@code /api/v1/}, so the token has
 * been verified before this runs; the service checks it owns the account.
 */
@RestController
@RequestMapping("/api/v1/accounts/{id}/transfers")
public class WalletTransferController {

    private final WalletTransferService walletTransferService;
    private final TokenAccountIdResolver tokenAccountIdResolver;

    public WalletTransferController(WalletTransferService walletTransferService,
                                    TokenAccountIdResolver tokenAccountIdResolver) {
        this.walletTransferService = walletTransferService;
        this.tokenAccountIdResolver = tokenAccountIdResolver;
    }

    @PostMapping
    public ResponseEntity<TransferResponse> transfer(@PathVariable("id") Long id,
                                                     @Valid @RequestBody TransferRequest request,
                                                     @RequestHeader(value = "Authorization", required = false)
                                                     String authorization) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(walletTransferService.transfer(id, tokenAccountIdResolver.resolve(authorization), request));
    }
}
