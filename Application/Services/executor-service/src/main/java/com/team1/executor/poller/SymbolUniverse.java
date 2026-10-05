package com.team1.executor.poller;

import com.team1.executor.mapper.SymbolMapper;
import org.springframework.stereotype.Component;

import java.util.List;

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
