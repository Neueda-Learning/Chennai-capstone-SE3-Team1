package com.team1.executor.poller;

import com.team1.executor.mapper.SymbolMapper;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * The symbols worth spending quota on: the ones somebody holds or is watching.
 *
 * <p>The watching half does not exist yet — there is no watchlist table until the Sprint 10
 * extension adds one. This class is the seam where it joins, so that when it arrives the change
 * is one {@code EXISTS} clause in {@code SymbolMapper.xml} and nothing in the poller moves.
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
