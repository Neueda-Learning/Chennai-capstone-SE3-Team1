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

    /**
     * Removes an order from the live book, but only while it is still NEW.
     *
     * @return 1 if this caller settled it, 0 if someone else already did
     */
    int deleteIfNew(@Param("orderId") UUID orderId);
}