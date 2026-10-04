package com.team1.executor.mapper;

import com.team1.executor.model.InstrumentRow;
import org.apache.ibatis.annotations.Mapper;

import java.util.Optional;

@Mapper
public interface InstrumentMapper {

    Optional<InstrumentRow> findBySymbol(String symbol);
}