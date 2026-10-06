package com.team1.trading.api.preferences;

import com.team1.trading.api.security.AccessGuard;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/accounts/{accountId}/preferences")
public class PreferenceController {

    private final PreferenceService service;
    private final AccessGuard accessGuard;

    public PreferenceController(PreferenceService service, AccessGuard accessGuard) {
        this.service = service;
        this.accessGuard = accessGuard;
    }

    @GetMapping
    public ResponseEntity<PreferencesResponse> get(@PathVariable("accountId") Long accountId) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.ok(service.get(accountId));
    }

    @PutMapping
    public ResponseEntity<PreferencesResponse> put(@PathVariable("accountId") Long accountId,
                                                   @Valid @RequestBody PreferencesRequest request) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.ok(service.put(accountId, request));
    }
}
