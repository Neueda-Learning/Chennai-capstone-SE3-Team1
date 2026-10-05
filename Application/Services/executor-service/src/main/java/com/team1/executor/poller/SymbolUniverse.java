package com.team1.executor.poller;

import com.team1.executor.mapper.SymbolMapper;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * The symbols worth spending quota on: every active (tradable) instrument.
 *
 * <p>It was "held or watched" until the market screen needed a price for every ticker a trader
 * can pick, held or not. The set is small enough for one Fauxnance batch request per cycle, so
 * widening it costs no extra quota. This class stays the seam for narrowing it again (a
 * watchlist, or only what is held) without the poller changing.
 */
@Component
public class SymbolUniverse {

    private final SymbolMapper symbolMapper;

    public SymbolUniverse(SymbolMapper symbolMapper) {
        this.symbolMapper = symbolMapper;
    }

    public List<String> symbolsToPoll() {
        List<String> symbols = symbolMapper.findPolledSymbols();
        return symbols == null ? List.of() : symbols;
    }
}
