package com.team1.trading.api.watchlists;

import com.team1.trading.api.notifications.Direction;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:watchlistflow;DB_CLOSE_DELAY=-1")
@Import({WatchlistService.class, AlertService.class})
class WatchlistFlowTest {

    @Autowired
    private WatchlistService watchlists;
    @Autowired
    private AlertService alerts;
    @Autowired
    private JdbcTemplate jdbc;

    private WatchlistResponse create(long account, String name) {
        return watchlists.create(account, new CreateWatchlistRequest(name));
    }

    private void quote(String symbol, String price, boolean stale, String receivedAt) {
        jdbc.update("INSERT INTO market_quotes (instrument_id, price, currency, change_percent, stale, received_at) "
                + "VALUES (?, ?, 'INR', 0.09, ?, " + receivedAt + ")", symbol, new BigDecimal(price), stale);
    }

    @Test
    @DisplayName("A watchlist is created for the authenticated account and is invisible to every other account")
    void watchlistIsScopedToItsAccount() {
        WatchlistResponse created = create(1L, "  Banks ");

        assertThat(created.name()).isEqualTo("Banks");
        assertThat(created.instruments()).isEmpty();
        assertThat(watchlists.list(1L)).extracting(WatchlistResponse::id).containsExactly(created.id());
        assertThat(watchlists.list(2L)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT account_id FROM watchlists", Long.class)).isEqualTo(1L);
    }

    @Test
    @DisplayName("Another account's watchlist reads as not found for add, remove and delete, and is left alone")
    void anotherAccountsWatchlistIsNotFound() {
        WatchlistResponse mine = create(1L, "Mine");

        assertThatThrownBy(() -> watchlists.addInstrument(2L, mine.id(), new AddInstrumentRequest("TCS")))
                .isInstanceOf(WatchlistNotFoundException.class);
        assertThatThrownBy(() -> watchlists.removeInstrument(2L, mine.id(), "TCS"))
                .isInstanceOf(WatchlistNotFoundException.class);
        assertThatThrownBy(() -> watchlists.delete(2L, mine.id()))
                .isInstanceOf(WatchlistNotFoundException.class);
        assertThatThrownBy(() -> watchlists.delete(1L, "not-a-uuid"))
                .isInstanceOf(WatchlistNotFoundException.class);
        assertThatThrownBy(() -> watchlists.delete(1L, UUID.randomUUID().toString()))
                .isInstanceOf(WatchlistNotFoundException.class);

        assertThat(watchlists.list(1L)).hasSize(1);
    }

    @Test
    @DisplayName("A name already used on the account, in any letter case, is a conflict; another account may reuse it")
    void duplicateNames() {
        create(1L, "Banks");

        assertThatThrownBy(() -> create(1L, "BANKS")).isInstanceOf(WatchlistConflictException.class);
        assertThat(create(2L, "Banks").name()).isEqualTo("Banks");
    }

    @Test
    @DisplayName("An instrument is added and the entry shows the latest received price, not an older one")
    void instrumentShowsLivePrice() {
        WatchlistResponse list = create(1L, "Banks");
        quote("HDFCBANK", "1640.0000", false, "TIMESTAMP '2026-10-06 09:00:00'");
        quote("HDFCBANK", "1650.5000", false, "TIMESTAMP '2026-10-06 09:01:00'");

        WatchlistEntryResponse entry = watchlists.addInstrument(1L, list.id(), new AddInstrumentRequest(" hdfcbank "));

        assertThat(entry.symbol()).isEqualTo("HDFCBANK");
        assertThat(entry.name()).isEqualTo("HDFC Bank");
        assertThat(entry.price()).isEqualByComparingTo("1650.5");
        assertThat(entry.currency()).isEqualTo("INR");
        assertThat(entry.changePercent()).isEqualByComparingTo("0.09");
        assertThat(entry.stale()).isFalse();

        List<WatchlistEntryResponse> listed = watchlists.list(1L).get(0).instruments();
        assertThat(listed).extracting(WatchlistEntryResponse::symbol).containsExactly("HDFCBANK");
        assertThat(listed.get(0).price()).isEqualByComparingTo("1650.5");
    }

    @Test
    @DisplayName("An instrument nobody has quoted yet has no price, and a later quote shows up on the next read")
    void entryWithoutQuoteThenWithQuote() {
        WatchlistResponse list = create(1L, "Watch");

        WatchlistEntryResponse entry = watchlists.addInstrument(1L, list.id(), new AddInstrumentRequest("INFY"));
        assertThat(entry.price()).isNull();
        assertThat(entry.quoteAsOf()).isNull();

        quote("INFY", "1500.0000", true, "CURRENT_TIMESTAMP");
        WatchlistEntryResponse later = watchlists.list(1L).get(0).instruments().get(0);
        assertThat(later.price()).isEqualByComparingTo("1500");
        assertThat(later.stale()).isTrue();
    }

    @Test
    @DisplayName("A customer can watch something never traded, and adding the same symbol twice is a no-op")
    void watchingIsNotHolding() {
        WatchlistResponse list = create(5L, "Ideas");

        watchlists.addInstrument(5L, list.id(), new AddInstrumentRequest("ITC"));
        watchlists.addInstrument(5L, list.id(), new AddInstrumentRequest("itc"));

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM watchlist_instruments", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM portfolio_holding WHERE client_id = 5", Integer.class))
                .isZero();
    }

    @Test
    @DisplayName("An unknown or inactive symbol is WLT-422 and nothing is stored")
    void unknownInstrument() {
        WatchlistResponse list = create(1L, "Bad");

        assertThatThrownBy(() -> watchlists.addInstrument(1L, list.id(), new AddInstrumentRequest("NOSUCH")))
                .isInstanceOf(WatchlistInvalidException.class);
        assertThatThrownBy(() -> watchlists.addInstrument(1L, list.id(), new AddInstrumentRequest("LEGACYCORP")))
                .isInstanceOf(WatchlistInvalidException.class);

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM watchlist_instruments", Integer.class)).isZero();
    }

    @Test
    @DisplayName("An entry is removed, a missing one is not found, and deleting a watchlist drops its entries")
    void removeAndDelete() {
        WatchlistResponse list = create(1L, "Temp");
        watchlists.addInstrument(1L, list.id(), new AddInstrumentRequest("TCS"));

        watchlists.removeInstrument(1L, list.id(), "tcs");
        assertThatThrownBy(() -> watchlists.removeInstrument(1L, list.id(), "TCS"))
                .isInstanceOf(WatchlistNotFoundException.class);

        watchlists.addInstrument(1L, list.id(), new AddInstrumentRequest("TCS"));
        watchlists.delete(1L, list.id());
        assertThat(watchlists.list(1L)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM watchlist_instruments", Integer.class)).isZero();
    }

    @Test
    @DisplayName("The eleventh watchlist and the fifty-first instrument are refused")
    void watchlistCaps() {
        for (int i = 0; i < WatchlistService.MAX_WATCHLISTS; i++) {
            create(1L, "List " + i);
        }
        assertThatThrownBy(() -> create(1L, "One too many")).isInstanceOf(WatchlistLimitException.class);
        assertThat(create(2L, "Other account is unaffected").name()).isNotBlank();

        WatchlistResponse list = watchlists.list(1L).get(0);
        for (int i = 0; i < WatchlistService.MAX_INSTRUMENTS; i++) {
            String symbol = "SYM" + i;
            jdbc.update("INSERT INTO instruments (instrument_id, instrument_name, active) VALUES (?, ?, TRUE)",
                    symbol, "Synthetic " + i);
            watchlists.addInstrument(1L, list.id(), new AddInstrumentRequest(symbol));
        }
        jdbc.update("INSERT INTO instruments (instrument_id, instrument_name, active) VALUES ('EXTRA', 'Extra', TRUE)");

        assertThatThrownBy(() -> watchlists.addInstrument(1L, list.id(), new AddInstrumentRequest("EXTRA")))
                .isInstanceOf(WatchlistLimitException.class);
        assertThat(watchlists.addInstrument(1L, list.id(), new AddInstrumentRequest("SYM0")).symbol())
                .isEqualTo("SYM0");
    }

    @Test
    @DisplayName("Alert creation is capped per account at twenty-five, and another account is unaffected")
    void alertCap() {
        for (int i = 0; i < AlertService.MAX_ALERTS; i++) {
            alerts.create(1L, new CreateAlertRequest("TCS", new BigDecimal("3500").add(BigDecimal.valueOf(i)),
                    Direction.ABOVE));
        }

        assertThatThrownBy(() -> alerts.create(1L, new CreateAlertRequest("TCS", new BigDecimal("1"), Direction.BELOW)))
                .isInstanceOf(WatchlistLimitException.class);
        assertThat(alerts.list(1L)).hasSize(AlertService.MAX_ALERTS);
        assertThat(alerts.create(2L, new CreateAlertRequest("TCS", new BigDecimal("1"), Direction.BELOW)).state())
                .isEqualTo(AlertState.ARMED);

        AlertResponse first = alerts.list(1L).get(0);
        alerts.delete(1L, first.id());
        assertThat(alerts.create(1L, new CreateAlertRequest("INFY", new BigDecimal("1"), Direction.BELOW)).id())
                .isNotBlank();
    }

    @Test
    @DisplayName("An alert is created ARMED for the account, uppercases the symbol and rejects unknown instruments")
    void alertCreation() {
        AlertResponse created = alerts.create(1L, new CreateAlertRequest(" tcs ", new BigDecimal("3500.5"), Direction.ABOVE));

        assertThat(created.symbol()).isEqualTo("TCS");
        assertThat(created.state()).isEqualTo(AlertState.ARMED);
        assertThat(created.deliveryState()).isNull();
        assertThat(created.firedAt()).isNull();
        assertThat(created.threshold()).isEqualByComparingTo("3500.5");
        assertThat(alerts.list(2L)).isEmpty();
        assertThatThrownBy(() -> alerts.create(1L, new CreateAlertRequest("NOSUCH", BigDecimal.ONE, Direction.ABOVE)))
                .isInstanceOf(WatchlistInvalidException.class);
        assertThatThrownBy(() -> alerts.create(1L, new CreateAlertRequest("LEGACYCORP", BigDecimal.ONE, Direction.ABOVE)))
                .isInstanceOf(WatchlistInvalidException.class);
    }

    @Test
    @DisplayName("Another account's alert is not found to read, change or delete, and is left alone")
    void anotherAccountsAlert() {
        AlertResponse mine = alerts.create(1L, new CreateAlertRequest("TCS", BigDecimal.TEN, Direction.ABOVE));

        assertThatThrownBy(() -> alerts.update(2L, mine.id(), new UpdateAlertRequest(SettableAlertState.DISABLED)))
                .isInstanceOf(WatchlistNotFoundException.class);
        assertThatThrownBy(() -> alerts.delete(2L, mine.id())).isInstanceOf(WatchlistNotFoundException.class);
        assertThatThrownBy(() -> alerts.delete(1L, "not-a-uuid")).isInstanceOf(WatchlistNotFoundException.class);

        assertThat(alerts.list(1L)).extracting(AlertResponse::state).containsExactly(AlertState.ARMED);
    }

    @Test
    @DisplayName("A customer can disable an alert and re-arm it; re-arming clears the fired details")
    void disableAndRearm() {
        AlertResponse alert = alerts.create(1L, new CreateAlertRequest("TCS", BigDecimal.TEN, Direction.ABOVE));

        assertThat(alerts.update(1L, alert.id(), new UpdateAlertRequest(SettableAlertState.DISABLED)).state())
                .isEqualTo(AlertState.DISABLED);

        jdbc.update("UPDATE price_alerts SET state = 'FIRED', delivery_state = 'QUEUED', "
                + "fired_at = CURRENT_TIMESTAMP, fired_price = 11 WHERE alert_id = CAST(? AS UUID)", alert.id());
        AlertResponse rearmed = alerts.update(1L, alert.id(), new UpdateAlertRequest(SettableAlertState.ARMED));

        assertThat(rearmed.state()).isEqualTo(AlertState.ARMED);
        assertThat(rearmed.deliveryState()).isNull();
        assertThat(rearmed.firedAt()).isNull();
        assertThat(rearmed.firedPrice()).isNull();
    }
}
