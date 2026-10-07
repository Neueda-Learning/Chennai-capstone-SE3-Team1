package com.team1.trading.api.conditional;

import com.team1.trading.api.conditional.ConditionalOrderMapper.PendingRow;
import com.team1.trading.domain.entity.types.ConditionType;
import com.team1.trading.domain.entity.types.OrderSide;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/** Read side of conditional orders, for the order screen and the assistant. Callers check ownership first. */
@Service
public class ConditionalOrderQueries {

    private final ConditionalOrderMapper mapper;

    public ConditionalOrderQueries(ConditionalOrderMapper mapper) {
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public List<PendingOrderResponse> pending(long accountId) {
        return mapper.findPendingForAccount(accountId).stream().map(ConditionalOrderQueries::toResponse).toList();
    }

    static PendingOrderResponse toResponse(PendingRow row) {
        ConditionType type = ConditionType.valueOf(row.getConditionType());
        return new PendingOrderResponse("ORD-" + row.getOrderUuid(), row.getSymbol(), OrderSide.valueOf(row.getSide()),
                row.getQuantity(), row.getPrice(), row.getConditionType(),
                ConditionText.describe(type, row.getTriggerPrice(), row.getShortWindow(), row.getLongWindow(),
                        row.getBandWidth()),
                row.getTriggerPrice(), row.getShortWindow(), row.getLongWindow(), row.getBandWidth(),
                row.getConditionState(), row.getLastCheckedAt(), row.getExpiresAt(), row.getCreatedAt());
    }
}
