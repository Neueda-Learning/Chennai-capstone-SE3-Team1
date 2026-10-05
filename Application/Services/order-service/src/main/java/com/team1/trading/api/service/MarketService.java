package com.team1.trading.api.service;

import com.team1.trading.api.dto.MarketPoint;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.mapper.MarketQuoteMapper;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class MarketService {

    static final int DEFAULT_HISTORY_POINTS = 120;
    static final int MAX_HISTORY_POINTS = 500;

    private final MarketQuoteMapper marketQuoteMapper;
    private final InstrumentMapper instrumentMapper;

    public MarketService(MarketQuoteMapper marketQuoteMapper, InstrumentMapper instrumentMapper) {
        this.marketQuoteMapper = marketQuoteMapper;
        this.instrumentMapper = instrumentMapper;
    }

    public List<MarketQuoteResponse> latestQuotes() {
        return marketQuoteMapper.latestForActiveInstruments();
    }

    public List<MarketPoint> history(String symbol, Integer limit) {
        String normalised = symbol == null ? "" : symbol.trim().toUpperCase();
        boolean tradable = instrumentMapper.findRowBySymbol(normalised)
                .map(InstrumentMapper.InstrumentRow::isActive)
                .orElse(false);
        if (!tradable) {
            throw new InstrumentNotFoundException(symbol);
        }
        int points = limit == null ? DEFAULT_HISTORY_POINTS : Math.max(1, Math.min(limit, MAX_HISTORY_POINTS));
        return marketQuoteMapper.history(normalised, points);
    }
}
