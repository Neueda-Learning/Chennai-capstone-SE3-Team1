package com.team1.trading.api.dto;

import com.team1.trading.domain.entity.types.ConditionType;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

/**
 * What a conditional order waits for. triggerPrice is for the two price conditions; shortWindow and
 * longWindow (counted in market-data quotes) for a crossover, where a shortWindow of 1 is the price itself; longWindow and bandWidth for a band.
 */
public record ConditionSpec(
        @NotNull ConditionType type,
        @DecimalMin("0.01") @Digits(integer = 12, fraction = 2) BigDecimal triggerPrice,
        @Min(1) @Max(199) Integer shortWindow,
        @Min(2) @Max(200) Integer longWindow,
        @DecimalMin("0.5") @DecimalMax("4.0") @Digits(integer = 1, fraction = 2) BigDecimal bandWidth) {
}
