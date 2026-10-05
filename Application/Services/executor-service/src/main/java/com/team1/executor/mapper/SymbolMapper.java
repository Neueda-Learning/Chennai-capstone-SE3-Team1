package com.team1.executor.mapper;

import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface SymbolMapper {

    List<String> findPolledSymbols();
}
