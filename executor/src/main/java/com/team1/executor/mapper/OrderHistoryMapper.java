package com.team1.executor.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.UUID;

@Mapper
public interface OrderHistoryMapper {

    int insertEvent(
            @Param("orderId") UUID orderId,
            @Param("clientId") Long clientId,
            @Param("eventType") String eventType,
            @Param("previousStatus") String previousStatus,
            @Param("newStatus") String newStatus,
            @Param("failureCode") String failureCode,
            @Param("failureReason") String failureReason,
            @Param("requestId") String requestId,
            @Param("externalStatus") String externalStatus,
            @Param("externalOrderId") String externalOrderId
    );
}

