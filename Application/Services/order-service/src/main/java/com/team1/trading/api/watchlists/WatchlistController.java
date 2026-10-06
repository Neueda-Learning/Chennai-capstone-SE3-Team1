package com.team1.trading.api.watchlists;

import com.team1.trading.api.security.AccessGuard;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/accounts/{accountId}/watchlists")
public class WatchlistController {

    private final WatchlistService service;
    private final AccessGuard accessGuard;

    public WatchlistController(WatchlistService service, AccessGuard accessGuard) {
        this.service = service;
        this.accessGuard = accessGuard;
    }

    @GetMapping
    public ResponseEntity<List<WatchlistResponse>> list(@PathVariable("accountId") Long accountId) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.ok(service.list(accountId));
    }

    @PostMapping
    public ResponseEntity<WatchlistResponse> create(@PathVariable("accountId") Long accountId,
                                                    @Valid @RequestBody CreateWatchlistRequest request) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(accountId, request));
    }

    @DeleteMapping("/{watchlistId}")
    public ResponseEntity<Void> delete(@PathVariable("accountId") Long accountId,
                                       @PathVariable("watchlistId") String watchlistId) {
        accessGuard.requireOwner(accountId);
        service.delete(accountId, watchlistId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{watchlistId}/instruments")
    public ResponseEntity<WatchlistEntryResponse> addInstrument(@PathVariable("accountId") Long accountId,
                                                                @PathVariable("watchlistId") String watchlistId,
                                                                @Valid @RequestBody AddInstrumentRequest request) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.status(HttpStatus.CREATED).body(service.addInstrument(accountId, watchlistId, request));
    }

    @DeleteMapping("/{watchlistId}/instruments/{symbol}")
    public ResponseEntity<Void> removeInstrument(@PathVariable("accountId") Long accountId,
                                                 @PathVariable("watchlistId") String watchlistId,
                                                 @PathVariable("symbol") String symbol) {
        accessGuard.requireOwner(accountId);
        service.removeInstrument(accountId, watchlistId, symbol);
        return ResponseEntity.noContent().build();
    }
}
