package com.team1.trading.api.watchlists;

import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.notifications.Direction;
import com.team1.trading.api.watchlists.PriceAlertMapper.AlertRow;
import com.team1.trading.domain.exception.AccountNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class AlertService {

    public static final int MAX_ALERTS = 25;

    private final PriceAlertMapper alerts;
    private final WatchlistMapper watchlists;
    private final InstrumentMapper instruments;

    public AlertService(PriceAlertMapper alerts, WatchlistMapper watchlists, InstrumentMapper instruments) {
        this.alerts = alerts;
        this.watchlists = watchlists;
        this.instruments = instruments;
    }

    @Transactional(readOnly = true)
    public List<AlertResponse> list(long accountId) {
        return alerts.findForAccount(accountId).stream().map(AlertService::toResponse).toList();
    }

    @Transactional
    public AlertResponse create(long accountId, CreateAlertRequest request) {
        String symbol = WatchlistSupport.activeSymbol(instruments, request.getSymbol());
        if (watchlists.lockAccount(accountId).isEmpty()) {
            throw new AccountNotFoundException(accountId);
        }
        if (alerts.countForAccount(accountId) >= MAX_ALERTS) {
            throw new WatchlistLimitException("An account can hold at most " + MAX_ALERTS
                    + " price alerts; delete one to create another");
        }
        String id = UUID.randomUUID().toString();
        alerts.insert(id, accountId, symbol, request.getThreshold(), request.getDirection().name(),
                WatchlistSupport.now());
        return toResponse(alerts.find(accountId, id).orElseThrow());
    }

    @Transactional
    public AlertResponse update(long accountId, String alertId, UpdateAlertRequest request) {
        String id = WatchlistSupport.id(alertId, "Alert");
        alerts.find(accountId, id).orElseThrow(() -> new WatchlistNotFoundException("Alert"));
        switch (request.getState()) {
            case ARMED -> alerts.rearm(accountId, id, WatchlistSupport.now());
            case DISABLED -> alerts.disable(accountId, id, WatchlistSupport.now());
        }
        return toResponse(alerts.find(accountId, id).orElseThrow(() -> new WatchlistNotFoundException("Alert")));
    }

    @Transactional
    public void delete(long accountId, String alertId) {
        String id = WatchlistSupport.id(alertId, "Alert");
        if (alerts.delete(accountId, id) == 0) {
            throw new WatchlistNotFoundException("Alert");
        }
    }

    static AlertResponse toResponse(AlertRow row) {
        return new AlertResponse(row.getId(), row.getSymbol(), row.getThreshold(),
                Direction.valueOf(row.getDirection()), AlertState.valueOf(row.getState()),
                row.getDeliveryState() == null ? null : AlertDeliveryState.valueOf(row.getDeliveryState()),
                WatchlistSupport.utc(row.getFiredAt()), row.getFiredPrice(),
                WatchlistSupport.utc(row.getCreatedAt()));
    }
}
