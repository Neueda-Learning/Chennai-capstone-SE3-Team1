package com.team1.trading.api.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface OrderHistoryMapper {

    @Insert("""
            INSERT INTO order_history (
                order_id, client_id, event_type, previous_status, new_status,
                request_id, event_timestamp, created_at
            ) VALUES (
                #{orderId}::uuid, #{clientId}, #{eventType}, #{previousStatus}, #{newStatus},
                #{requestId}, now(), now()
            )
            """)
    int insertEvent(@Param("orderId") String orderId,
                    @Param("clientId") Long clientId,
                    @Param("eventType") String eventType,
                    @Param("previousStatus") String previousStatus,
                    @Param("newStatus") String newStatus,
                    @Param("requestId") String requestId);
}

