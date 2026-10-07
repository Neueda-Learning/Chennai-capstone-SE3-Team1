package com.team1.trading.api.advice;

import com.team1.trading.api.advice.AdviceViews.Advice;
import com.team1.trading.api.advice.AdviceViews.Signal;
import com.team1.trading.api.security.AccessGuard;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/accounts/{accountId}/advice")
public class AdviceController {

    private final AdviceService service;
    private final AccessGuard accessGuard;

    public AdviceController(AdviceService service, AccessGuard accessGuard) {
        this.service = service;
        this.accessGuard = accessGuard;
    }

    @GetMapping
    public ResponseEntity<Advice> forAccount(@PathVariable("accountId") Long accountId) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.ok(service.forAccount(accountId));
    }

    @GetMapping("/{symbol}")
    public ResponseEntity<Signal> forSymbol(@PathVariable("accountId") Long accountId,
                                                    @PathVariable("symbol") String symbol) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.ok(service.forSymbol(accountId, symbol));
    }
}
