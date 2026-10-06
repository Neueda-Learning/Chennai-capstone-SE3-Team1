package com.team1.trading.api.notifications;

import com.team1.trading.api.security.AccessGuard;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/v1/accounts/{accountId}/notification-history")
public class NotificationHistoryController {

    private final NotificationHistoryService service;
    private final AccessGuard accessGuard;

    public NotificationHistoryController(NotificationHistoryService service, AccessGuard accessGuard) {
        this.service = service;
        this.accessGuard = accessGuard;
    }

    @GetMapping
    public List<NotificationHistoryEntry> history(
            @PathVariable("accountId") Long accountId,
            @RequestParam(name = "limit", required = false) Integer limit,
            @RequestParam(name = "before", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime before) {
        accessGuard.requireOwner(accountId);
        return service.history(accountId, limit, before);
    }
}
