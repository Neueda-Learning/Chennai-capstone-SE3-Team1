package com.team1.executor.rule;

import java.math.BigDecimal;

public record FillRuleResult(
        FillDecision decision,
        BigDecimal executedPrice,
        String reason
) {}