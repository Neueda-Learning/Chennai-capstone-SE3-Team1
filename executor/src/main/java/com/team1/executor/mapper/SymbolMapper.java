package com.team1.executor.mapper;

import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface SymbolMapper {

    /**
     * Active instruments somebody actually holds. This is the poller's universe, and it is
     * deliberately not the whole instrument table: quota spent on a price no consumer wants is
     * quota the fill path does not have.
     */
    List<String> findPolledSymbols();
}
