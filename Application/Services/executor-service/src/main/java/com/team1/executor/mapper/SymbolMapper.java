package com.team1.executor.mapper;

import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface SymbolMapper {

    /**
     * Every active instrument. This is the poller's universe: small enough for one Fauxnance
     * batch, so it costs the same single request per cycle as any subset would, and the market
     * screen needs a price for every ticker a trader can pick, not just the ones already held.
     */
    List<String> findPolledSymbols();
}
