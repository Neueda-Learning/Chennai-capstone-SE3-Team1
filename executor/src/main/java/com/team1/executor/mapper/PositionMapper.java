package com.team1.executor.mapper;

import com.team1.executor.model.PositionRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.math.BigDecimal;
import java.util.Optional;

@Mapper
public interface PositionMapper {

    Optional<PositionRow> findHolding(Long clientId, String instrumentId);

    Optional<PositionRow> findHoldingForUpdate(Long clientId, String instrumentId);

    int insertHolding(PositionRow position);

    int updateHoldingBuy(
            @Param("clientId") Long clientId,
            @Param("instrumentId") String instrumentId,
            @Param("quantity") Integer quantity,
            @Param("pricePerUnit") BigDecimal pricePerUnit
    );

    int updateHoldingSell(
            @Param("clientId") Long clientId,
            @Param("instrumentId") String instrumentId,
            @Param("quantity") Integer quantity
    );
}