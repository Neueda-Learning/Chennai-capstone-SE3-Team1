package com.team1.trading.api.market;

import com.team1.trading.api.dto.CandleResponse;
import com.team1.trading.api.mapper.CandleMapper;
import com.team1.trading.api.mapper.CandleMapper.DailyCandleWrite;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.mapper.InstrumentMapper.InstrumentRow;
import com.team1.trading.api.market.FauxnanceCandleClient.CandleFetchException;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import com.team1.trading.domain.exception.InvalidOrderException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class CandleServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-03T06:30:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 3);

    @Mock
    private CandleMapper candleMapper;
    @Mock
    private InstrumentMapper instrumentMapper;
    @Mock
    private FauxnanceCandleClient client;

    private MutableClock clock;
    private CandleService service;

    static class MutableClock extends Clock {
        Instant now = NOW;

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(now, zone); }
        @Override public Instant instant() { return now; }
    }

    @BeforeEach
    void setUp() {
        clock = new MutableClock();
        service = new CandleService(candleMapper, instrumentMapper, client, clock);
        InstrumentRow row = new InstrumentRow();
        row.setInstrumentId("RELIANCE");
        row.setActive(true);
        org.mockito.Mockito.lenient().when(instrumentMapper.findRowBySymbol("RELIANCE")).thenReturn(Optional.of(row));
    }

    private static CandleResponse candle(String time, double close) {
        CandleResponse c = new CandleResponse();
        c.setTime(OffsetDateTime.parse(time));
        c.setOpen(BigDecimal.valueOf(close));
        c.setHigh(BigDecimal.valueOf(close));
        c.setLow(BigDecimal.valueOf(close));
        c.setClose(BigDecimal.valueOf(close));
        return c;
    }

    private static DailyCandleWrite daily(String date) {
        DailyCandleWrite c = new DailyCandleWrite();
        c.setSymbol("RELIANCE");
        c.setTradeDate(LocalDate.parse(date));
        c.setOpen(BigDecimal.TEN);
        c.setHigh(BigDecimal.TEN);
        c.setLow(BigDecimal.TEN);
        c.setClose(BigDecimal.TEN);
        return c;
    }

    @Test
    @DisplayName("Intraday candles come from the stored quotes, bucketed as asked, over the window asked")
    void intraday() {
        List<CandleResponse> rows = List.of(candle("2026-10-03T10:00:00+05:30", 1300));
        given(candleMapper.intraday(eq("RELIANCE"), any(), eq(300))).willReturn(rows);

        List<CandleResponse> out = service.candles(" reliance ", "5m", "1d");

        assertThat(out).isEqualTo(rows);
        ArgumentCaptor<OffsetDateTime> since = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(candleMapper).intraday(eq("RELIANCE"), since.capture(), eq(300));
        assertThat(since.getValue().toInstant()).isEqualTo(NOW.minusSeconds(86_400));
        verify(client, never()).fetchDaily(anyString(), any(), any());
    }

    @Test
    @DisplayName("Every intraday interval maps to its bucket size")
    void bucketSizes() {
        given(candleMapper.intraday(anyString(), any(), anyInt())).willReturn(List.of());
        service.candles("RELIANCE", "1m", "1h");
        service.candles("RELIANCE", "15m", "1d");
        service.candles("RELIANCE", "30m", "3d");
        service.candles("RELIANCE", "1h", "1w");

        verify(candleMapper).intraday(anyString(), any(), eq(60));
        verify(candleMapper).intraday(anyString(), any(), eq(900));
        verify(candleMapper).intraday(anyString(), any(), eq(1_800));
        verify(candleMapper).intraday(anyString(), any(), eq(3_600));
    }

    @Test
    @DisplayName("A request that would return more than 2,000 candles is refused")
    void tooManyCandles() {
        assertThatThrownBy(() -> service.candles("RELIANCE", "1m", "3d")).isInstanceOf(InvalidOrderException.class);
        verify(candleMapper, never()).intraday(anyString(), any(), anyInt());
    }

    @Test
    @DisplayName("Unknown intervals and ranges, and mixed-up combinations, are VAL-422")
    void invalidCombinations() {
        for (String[] bad : new String[][]{{"2m", "1d"}, {"5m", "ytd"}, {"1d", "1h"}, {"1w", "3h"}, {"", ""}, {"5m", "forever"}}) {
            assertThatThrownBy(() -> service.candles("RELIANCE", bad[0], bad[1]))
                    .as(bad[0] + "/" + bad[1]).isInstanceOf(InvalidOrderException.class);
        }
    }

    @Test
    @DisplayName("An unknown or delisted symbol is INS-404")
    void unknownSymbol() {
        given(instrumentMapper.findRowBySymbol("NOPE")).willReturn(Optional.empty());
        assertThatThrownBy(() -> service.candles("NOPE", "5m", "1d")).isInstanceOf(InstrumentNotFoundException.class);
    }

    @Test
    @DisplayName("Daily candles fetch the year once, store it, then read from the table")
    void dailyFetchesOnce() {
        given(candleMapper.lastSyncedOn("RELIANCE")).willReturn(Optional.empty());
        given(client.fetchDaily(eq("RELIANCE"), any(), any())).willReturn(List.of(daily("2026-10-01"), daily("2026-10-02")));
        List<CandleResponse> stored = List.of(candle("2026-10-01T00:00:00+05:30", 10), candle("2026-10-02T00:00:00+05:30", 10), candle("2026-10-03T00:00:00+05:30", 10));
        given(candleMapper.daily(eq("RELIANCE"), any())).willReturn(stored);

        List<CandleResponse> out = service.candles("RELIANCE", "1d", "3mo");

        assertThat(out).isEqualTo(stored);
        verify(client).fetchDaily("RELIANCE", TODAY.minusDays(366), TODAY);
        verify(candleMapper, times(2)).upsertDaily(any());
        verify(candleMapper).markSynced("RELIANCE", TODAY, TODAY.minusDays(366), 2);
    }

    @Test
    @DisplayName("Once synced today, a chart makes no Fauxnance request at all")
    void alreadySyncedToday() {
        given(candleMapper.lastSyncedOn("RELIANCE")).willReturn(Optional.of(TODAY));
        given(candleMapper.daily(eq("RELIANCE"), any())).willReturn(List.of(candle("2026-10-03T00:00:00+05:30", 10)));

        service.candles("RELIANCE", "1d", "1mo");
        service.candles("RELIANCE", "1d", "6mo");

        verify(client, never()).fetchDaily(anyString(), any(), any());
    }

    @Test
    @DisplayName("Yesterday's sync is stale: it is refreshed")
    void staleSync() {
        given(candleMapper.lastSyncedOn("RELIANCE")).willReturn(Optional.of(TODAY.minusDays(1)));
        given(client.fetchDaily(eq("RELIANCE"), any(), any())).willReturn(List.of(daily("2026-10-02")));
        given(candleMapper.daily(eq("RELIANCE"), any())).willReturn(List.of());

        service.candles("RELIANCE", "1d", "1mo");

        verify(client).fetchDaily(eq("RELIANCE"), any(), any());
    }

    @Test
    @DisplayName("A failed fetch serves what is stored, is not marked synced, and is not retried straight away")
    void failureBacksOff() {
        given(candleMapper.lastSyncedOn("RELIANCE")).willReturn(Optional.empty());
        given(client.fetchDaily(eq("RELIANCE"), any(), any())).willThrow(new CandleFetchException("quota"));
        List<CandleResponse> stored = List.of(candle("2026-09-30T00:00:00+05:30", 10));
        given(candleMapper.daily(eq("RELIANCE"), any())).willReturn(stored);

        assertThat(service.candles("RELIANCE", "1d", "1mo")).isEqualTo(stored);
        service.candles("RELIANCE", "1d", "1mo");

        verify(client, times(1)).fetchDaily(anyString(), any(), any());
        verify(candleMapper, never()).markSynced(anyString(), any(), any(), anyInt());

        clock.now = NOW.plusSeconds(16 * 60);
        service.candles("RELIANCE", "1d", "1mo");
        verify(client, times(2)).fetchDaily(anyString(), any(), any());
    }

    @Test
    @DisplayName("An empty answer is not a sync")
    void emptyAnswer() {
        given(candleMapper.lastSyncedOn("RELIANCE")).willReturn(Optional.empty());
        given(client.fetchDaily(eq("RELIANCE"), any(), any())).willReturn(List.of());
        given(candleMapper.daily(eq("RELIANCE"), any())).willReturn(List.of());

        service.candles("RELIANCE", "1d", "1mo");

        verify(candleMapper, never()).markSynced(anyString(), any(), any(), anyInt());
    }

    @Test
    @DisplayName("Weeks and months are rolled up from the daily candles")
    void rollUps() {
        given(candleMapper.lastSyncedOn("RELIANCE")).willReturn(Optional.of(TODAY));
        given(candleMapper.rolledUp(anyString(), any(), anyString())).willReturn(List.of());

        service.candles("RELIANCE", "1w", "6mo");
        service.candles("RELIANCE", "1mo", "1y");

        verify(candleMapper).rolledUp("RELIANCE", TODAY.minusMonths(6), "week");
        verify(candleMapper).rolledUp("RELIANCE", TODAY.minusYears(1), "month");
    }

    @Test
    @DisplayName("YTD starts on 1 January")
    void ytd() {
        given(candleMapper.lastSyncedOn("RELIANCE")).willReturn(Optional.of(TODAY));
        given(candleMapper.daily(anyString(), any())).willReturn(List.of(candle("2026-10-03T00:00:00+05:30", 10)));

        service.candles("RELIANCE", "1d", "ytd");

        verify(candleMapper).daily("RELIANCE", LocalDate.of(2026, 1, 1));
    }

    @Test
    @DisplayName("Today's candle is built from today's quotes while end-of-day history lags")
    void todaysCandle() {
        given(candleMapper.lastSyncedOn("RELIANCE")).willReturn(Optional.of(TODAY));
        given(candleMapper.daily(anyString(), any())).willReturn(List.of(candle("2026-10-02T00:00:00+05:30", 10)));
        CandleResponse todays = candle("2026-10-03T00:00:00+05:30", 11);
        given(candleMapper.intraday(eq("RELIANCE"), any(), eq(86_400))).willReturn(List.of(todays));

        List<CandleResponse> out = service.candles("RELIANCE", "1d", "1mo");

        assertThat(out).hasSize(2);
        assertThat(out.get(1).getClose()).isEqualByComparingTo("11");
        assertThat(out.get(1).getTime().toLocalDate()).isEqualTo(TODAY);
    }

    @Test
    @DisplayName("...but not twice, when the stored history already has today")
    void noDuplicateToday() {
        given(candleMapper.lastSyncedOn("RELIANCE")).willReturn(Optional.of(TODAY));
        given(candleMapper.daily(anyString(), any())).willReturn(List.of(candle("2026-10-03T00:00:00+05:30", 10)));

        List<CandleResponse> out = service.candles("RELIANCE", "1d", "1mo");

        assertThat(out).hasSize(1);
        verify(candleMapper, never()).intraday(anyString(), any(), anyInt());
    }
}
