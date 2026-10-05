package com.team1.trading.api.service;

import com.team1.trading.api.dto.MarketPoint;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.mapper.InstrumentMapper.InstrumentRow;
import com.team1.trading.api.mapper.MarketQuoteMapper;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class MarketServiceTest {

    @Mock
    private MarketQuoteMapper marketQuoteMapper;
    @Mock
    private InstrumentMapper instrumentMapper;

    private MarketService service;

    @BeforeEach
    void setUp() {
        service = new MarketService(marketQuoteMapper, instrumentMapper);
    }

    private static InstrumentRow instrument(boolean active) {
        InstrumentRow row = new InstrumentRow();
        row.setInstrumentId("RELIANCE");
        row.setInstrumentName("Reliance Industries");
        row.setActive(active);
        return row;
    }

    @Test
    @DisplayName("The latest quotes are whatever the mapper returns, unpriced instruments included")
    void latestQuotes() {
        MarketQuoteResponse unpriced = new MarketQuoteResponse();
        unpriced.setSymbol("ITC");
        given(marketQuoteMapper.latestForActiveInstruments()).willReturn(List.of(unpriced));

        assertThat(service.latestQuotes()).containsExactly(unpriced);
    }

    @Test
    @DisplayName("History is read for the upper-cased symbol with the default size when no limit is given")
    void historyDefaults() {
        given(instrumentMapper.findRowBySymbol("RELIANCE")).willReturn(Optional.of(instrument(true)));
        MarketPoint point = new MarketPoint(OffsetDateTime.now(), new BigDecimal("1300.10"));
        given(marketQuoteMapper.history("RELIANCE", 120)).willReturn(List.of(point));

        assertThat(service.history(" reliance ", null)).containsExactly(point);
    }

    @Test
    @DisplayName("The limit is clamped to 1..500")
    void historyClamps() {
        given(instrumentMapper.findRowBySymbol("RELIANCE")).willReturn(Optional.of(instrument(true)));
        given(marketQuoteMapper.history(anyString(), anyInt())).willReturn(List.of());

        service.history("RELIANCE", 99999);
        service.history("RELIANCE", -4);

        verify(marketQuoteMapper).history("RELIANCE", 500);
        verify(marketQuoteMapper).history("RELIANCE", 1);
    }

    @Test
    @DisplayName("An unknown symbol is INS-404")
    void unknownSymbol() {
        given(instrumentMapper.findRowBySymbol("NOPE")).willReturn(Optional.empty());

        assertThatThrownBy(() -> service.history("NOPE", null)).isInstanceOf(InstrumentNotFoundException.class);
        verify(marketQuoteMapper, never()).history(any(), anyInt());
    }

    @Test
    @DisplayName("A delisted instrument is INS-404 too")
    void delistedSymbol() {
        given(instrumentMapper.findRowBySymbol("RELIANCE")).willReturn(Optional.of(instrument(false)));

        assertThatThrownBy(() -> service.history("RELIANCE", null)).isInstanceOf(InstrumentNotFoundException.class);
    }
}
