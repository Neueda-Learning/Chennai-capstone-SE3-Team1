package com.team1.executor.mapper;

import com.team1.executor.model.OrderRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.math.BigDecimal;
import java.util.UUID;

@Mapper
public interface OrderHistoryMapper {

    int insertTransition(
            @Param("orderId") UUID orderId,
            @Param("eventType") String eventType,
            @Param("previousStatus") String previousStatus,
            @Param("newStatus") String newStatus
    );

    int insertTerminal(
            @Param("order") OrderRow order,
            @Param("eventType") String eventType,
            @Param("newStatus") String newStatus,
            @Param("executedPrice") BigDecimal executedPrice,
            @Param("failureCode") String failureCode,
            @Param("failureReason") String failureReason
    );
}
