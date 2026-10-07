BEGIN;

-- A crossover's short window may be 1: the price itself crossing its long average (ADR 0016). That is the
-- "with respect to the moving-average line" order the Market & Trade chart places.
ALTER TABLE orders DROP CONSTRAINT chk_orders_condition_params;
ALTER TABLE orders ADD CONSTRAINT chk_orders_condition_params CHECK (
    condition_type IS NULL
    OR (condition_type IN ('PRICE_AT_OR_ABOVE', 'PRICE_AT_OR_BELOW') AND trigger_price > 0)
    OR (condition_type IN ('MA_CROSS_ABOVE', 'MA_CROSS_BELOW') AND short_window >= 1 AND long_window > short_window
        AND long_window > 1)
    OR (condition_type IN ('BOLLINGER_BELOW_LOWER', 'BOLLINGER_ABOVE_UPPER') AND long_window > 1 AND band_width > 0));

COMMIT;
