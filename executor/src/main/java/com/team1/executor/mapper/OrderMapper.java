package com.team1.executor.mapper;

import com.team1.executor.model.OrderRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

@Mapper
public interface OrderMapper {

    Optional<OrderRow> findByOrderId(UUID orderId);

    int updateStatusAndExecutedPrice(
            @Param("orderId") UUID orderId,
            @Param("status") String status,
            @Param("executedPrice") BigDecimal executedPrice,
            @Param("executedOn") LocalDateTime executedOn
    );

    int updateStatusAndReason(
            @Param("orderId") UUID orderId,
            @Param("status") String status
    );
}