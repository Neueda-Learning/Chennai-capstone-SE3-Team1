package com.team1.executor.mapper;

import com.team1.executor.model.OrderRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Writes the audit trail in order_history: one row per status change.
 *
 * <p>Since migration 010 the terminal row is more than an audit entry - it is the only
 * remaining record of the order itself, because orders holds live orders only and the
 * row is deleted once it settles. {@link #insertTerminal} therefore carries the order's
 * own fields; {@link #insertTransition} is for non-terminal events, which stay pure
 * transitions.
 */
@Mapper
public interface OrderHistoryMapper {

    /** A status change that does not end the order's life. Carries no order detail. */
    int insertTransition(
            @Param("orderId") UUID orderId,
            @Param("eventType") String eventType,
            @Param("previousStatus") String previousStatus,
            @Param("newStatus") String newStatus
    );

    /**
     * The row an order becomes once it leaves the live book.
     *
     * @param order the orders row as it was read at the start of settlement
     */
    int insertTerminal(
            @Param("order") OrderRow order,
            @Param("eventType") String eventType,
            @Param("newStatus") String newStatus,
            @Param("executedPrice") BigDecimal executedPrice,
            @Param("failureCode") String failureCode,
            @Param("failureReason") String failureReason
    );
}
