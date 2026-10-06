package com.team1.trading.api.watchlists;

import com.team1.trading.api.security.AccessGuard;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/accounts/{accountId}/alerts")
public class AlertController {

    private final AlertService service;
    private final AccessGuard accessGuard;

    public AlertController(AlertService service, AccessGuard accessGuard) {
        this.service = service;
        this.accessGuard = accessGuard;
    }

    @GetMapping
    public ResponseEntity<List<AlertResponse>> list(@PathVariable("accountId") Long accountId) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.ok(service.list(accountId));
    }

    @PostMapping
    public ResponseEntity<AlertResponse> create(@PathVariable("accountId") Long accountId,
                                                @Valid @RequestBody CreateAlertRequest request) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(accountId, request));
    }

    @PatchMapping("/{alertId}")
    public ResponseEntity<AlertResponse> update(@PathVariable("accountId") Long accountId,
                                                @PathVariable("alertId") String alertId,
                                                @Valid @RequestBody UpdateAlertRequest request) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.ok(service.update(accountId, alertId, request));
    }

    @DeleteMapping("/{alertId}")
    public ResponseEntity<Void> delete(@PathVariable("accountId") Long accountId,
                                       @PathVariable("alertId") String alertId) {
        accessGuard.requireOwner(accountId);
        service.delete(accountId, alertId);
        return ResponseEntity.noContent().build();
    }
}
