BEGIN;

-- Conditional orders (ADR 0012). A conditional order is an ordinary row in orders with status PENDING and
-- a condition. It is never published to the orders topic while PENDING, so the executor never sees it.
-- Every minute the Trade REST API checks each PENDING order's condition against the latest market-data
-- quotes; when it is met, a guarded UPDATE moves the row to NEW and the order is published exactly as a
-- customer's order would be. From there the executor fills or rejects it and moves it to order_history.

ALTER TABLE orders
    ADD COLUMN condition_type   VARCHAR(24),
    ADD COLUMN trigger_price    NUMERIC(18,4),
    ADD COLUMN short_window     INT,
    ADD COLUMN long_window      INT,
    ADD COLUMN band_width       NUMERIC(4,2),
    -- The last relation seen for a crossover or band condition (ABOVE, BELOW or INSIDE), so a crossing is
    -- detected however many quotes arrived between two checks.
    ADD COLUMN condition_state  VARCHAR(8),
    ADD COLUMN expires_at       TIMESTAMP,
    ADD COLUMN last_checked_at  TIMESTAMP,
    ADD COLUMN triggered_at     TIMESTAMP,
    ADD COLUMN trigger_reason   VARCHAR(300);

ALTER TABLE orders DROP CONSTRAINT chk_orders_status;
ALTER TABLE orders ADD CONSTRAINT chk_orders_status CHECK (status IN ('NEW', 'PENDING'));

ALTER TABLE orders ADD CONSTRAINT chk_orders_condition_type CHECK (
    condition_type IS NULL OR condition_type IN (
        'PRICE_AT_OR_ABOVE', 'PRICE_AT_OR_BELOW',
        'MA_CROSS_ABOVE', 'MA_CROSS_BELOW',
        'BOLLINGER_BELOW_LOWER', 'BOLLINGER_ABOVE_UPPER'));
ALTER TABLE orders ADD CONSTRAINT chk_orders_pending_has_condition
    CHECK (status <> 'PENDING' OR (condition_type IS NOT NULL AND expires_at IS NOT NULL));
ALTER TABLE orders ADD CONSTRAINT chk_orders_condition_params CHECK (
    condition_type IS NULL
    OR (condition_type IN ('PRICE_AT_OR_ABOVE', 'PRICE_AT_OR_BELOW') AND trigger_price > 0)
    OR (condition_type IN ('MA_CROSS_ABOVE', 'MA_CROSS_BELOW') AND short_window > 1 AND long_window > short_window)
    OR (condition_type IN ('BOLLINGER_BELOW_LOWER', 'BOLLINGER_ABOVE_UPPER') AND long_window > 1 AND band_width > 0));
ALTER TABLE orders ADD CONSTRAINT chk_orders_condition_state
    CHECK (condition_state IS NULL OR condition_state IN ('ABOVE', 'BELOW', 'INSIDE'));

-- The poller reads only the pending rows.
CREATE INDEX idx_orders_pending_instrument ON orders (instrument_id) WHERE status = 'PENDING';

-- A cancelled or expired conditional order is archived with previous_status PENDING. Both history
-- vocabularies stay equal to the domain OrderStatus enum (scripts/verify_db.py checks it).
ALTER TABLE order_history DROP CONSTRAINT chk_order_history_previous_status;
ALTER TABLE order_history ADD CONSTRAINT chk_order_history_previous_status CHECK (
    previous_status IS NULL OR previous_status IN ('NEW', 'FILLED', 'REJECTED', 'CANCELLED', 'PENDING'));
ALTER TABLE order_history DROP CONSTRAINT chk_order_history_new_status;
ALTER TABLE order_history ADD CONSTRAINT chk_order_history_new_status CHECK (
    new_status IS NULL OR new_status IN ('NEW', 'FILLED', 'REJECTED', 'CANCELLED', 'PENDING'));

COMMIT;
