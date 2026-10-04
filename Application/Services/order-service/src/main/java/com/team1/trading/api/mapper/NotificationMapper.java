package com.team1.trading.api.mapper;

import com.team1.trading.api.dto.NotificationResponse;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * Account notifications, read from the tables the events already land in. Nothing here is
 * written: an order or a transfer being recorded is what makes the notification exist.
 */
@Mapper
public interface NotificationMapper {

    /**
     * Newest first. Three sources, unioned:
     * <ul>
     *   <li>{@code orders}: the live book, so only still-working (NEW) orders;</li>
     *   <li>{@code order_history}: settled orders, one row per terminal state. Rows without an
     *       idempotency key are the executor's audit events, not the order's own archive row,
     *       and are left out;</li>
     *   <li>{@code wallet_transfers}: money moving between the bank account and the wallet.</li>
     * </ul>
     * The stored timestamps are zone-less (server local time), so each is read as that zone's
     * instant and returned with its offset: a browser in another timezone then shows the right time.
     * The {@code id} embeds the order or transfer id and the state, so it is the same every time
     * the same event is read.
     */
    @Select("""
            SELECT * FROM (
                SELECT 'order-' || order_id::text || '-NEW' AS id, 'ORDER_PLACED' AS kind,
                       instrument_id AS symbol, side, CAST(quantity AS INT) AS quantity, price,
                       CAST(NULL AS NUMERIC) AS executedPrice, CAST(NULL AS NUMERIC) AS amount,
                       CAST(NULL AS VARCHAR) AS reason, (created_at AT TIME ZONE current_setting('TimeZone')) AS occurredAt
                FROM orders
                WHERE client_id = #{accountId}
                UNION ALL
                SELECT 'order-' || order_id::text || '-' || new_status, 'ORDER_' || new_status,
                       instrument_id, side, CAST(quantity AS INT), price,
                       executed_price, CAST(NULL AS NUMERIC),
                       failure_code, (event_timestamp AT TIME ZONE current_setting('TimeZone'))
                FROM order_history
                WHERE client_id = #{accountId}
                  AND idempotency_key IS NOT NULL
                  AND new_status IN ('FILLED', 'REJECTED', 'CANCELLED')
                UNION ALL
                SELECT 'transfer-' || transfer_id::text,
                       CASE direction WHEN 'BANK_TO_WALLET' THEN 'TRANSFER_IN' ELSE 'TRANSFER_OUT' END,
                       CAST(NULL AS VARCHAR), CAST(NULL AS VARCHAR), CAST(NULL AS INT),
                       CAST(NULL AS NUMERIC), CAST(NULL AS NUMERIC), amount,
                       CAST(NULL AS VARCHAR), (created_at AT TIME ZONE current_setting('TimeZone'))
                FROM wallet_transfers
                WHERE client_id = #{accountId}
            ) n
            ORDER BY n.occurredAt DESC, n.id DESC
            LIMIT #{limit}
            """)
    List<NotificationResponse> listForAccount(@Param("accountId") Long accountId, @Param("limit") int limit);
}
