-- DuckDB dialect. See 001_analytics_dimensions.sql.

CREATE SEQUENCE IF NOT EXISTS analytics.seq_trade_key START 1;
CREATE SEQUENCE IF NOT EXISTS analytics.seq_dead_letter_key START 1;

-- One row per order that reached a terminal state, in whatever state it reached.
-- Rejected and cancelled orders are facts too: fill rate is FILLED / everything, and
-- the denominator has to be in this table.
--
-- Source is PostgreSQL public.order_history (the row whose new_status is terminal)
-- joined back to public.orders for the order's own fields. order_id is the natural
-- key; the UNIQUE on it is what the merge relies on.
CREATE TABLE IF NOT EXISTS analytics.fact_trades (
    trade_key           BIGINT         PRIMARY KEY DEFAULT nextval('analytics.seq_trade_key'),

    -- dimension keys
    date_key            INTEGER        NOT NULL REFERENCES analytics.dim_date(date_key),
    instrument_key      BIGINT         NOT NULL REFERENCES analytics.dim_instrument(instrument_key),
    account_key         BIGINT         NOT NULL REFERENCES analytics.dim_account(account_key),

    -- natural key
    order_id            UUID           NOT NULL UNIQUE,
    idempotency_key     VARCHAR        NOT NULL,

    -- measures and degenerate dimensions
    order_type          VARCHAR        NOT NULL,
    side                VARCHAR        NOT NULL,
    status              VARCHAR        NOT NULL,
    quantity            DECIMAL(18,4)  NOT NULL,
    price               DECIMAL(18,4)  NOT NULL,
    executed_price      DECIMAL(18,4),
    trade_value         DECIMAL(24,4)  NOT NULL,   -- quantity * coalesce(executed_price, price)
    failure_code        VARCHAR,
    failure_reason      VARCHAR,

    order_created_at    TIMESTAMP      NOT NULL,   -- the watermark column
    terminal_at         TIMESTAMP      NOT NULL,   -- order_history.event_timestamp of the terminal event

    load_id             VARCHAR        NOT NULL,
    loaded_at           TIMESTAMP      NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP      NOT NULL DEFAULT now(),

    CONSTRAINT chk_fact_trades_order_type CHECK (order_type IN ('POSITION', 'HOLDING')),
    CONSTRAINT chk_fact_trades_side       CHECK (side IN ('BUY', 'SELL')),
    CONSTRAINT chk_fact_trades_status     CHECK (status IN ('FILLED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT chk_fact_trades_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_fact_trades_price_positive    CHECK (price > 0),
    CONSTRAINT chk_fact_trades_executed_price_positive
        CHECK (executed_price IS NULL OR executed_price > 0),
    CONSTRAINT chk_fact_trades_filled_has_executed_price
        CHECK (status <> 'FILLED' OR executed_price IS NOT NULL),
    CONSTRAINT chk_fact_trades_value_recomputes
        CHECK (trade_value = quantity * COALESCE(executed_price, price))
);

-- A row that fails a quality check lands here with the check it failed and the load it
-- came from, so it can be investigated instead of being lost. The raw source row is
-- kept whole because the failing field is often not the interesting one.
CREATE TABLE IF NOT EXISTS analytics.dead_letter_trades (
    dead_letter_key     BIGINT       PRIMARY KEY DEFAULT nextval('analytics.seq_dead_letter_key'),
    load_id             VARCHAR      NOT NULL,
    order_id            UUID,                     -- NULL if the source row had no usable order_id
    check_name          VARCHAR      NOT NULL,    -- e.g. fk_instrument, positive_quantity, valid_side
    reason              VARCHAR      NOT NULL,
    source_row          JSON         NOT NULL,
    quarantined_at      TIMESTAMP    NOT NULL DEFAULT now()
);

-- One row per target table. last_watermark is the greatest orders.created_at the load
-- has processed; the next load starts after it.
CREATE TABLE IF NOT EXISTS analytics.load_watermark (
    table_name          VARCHAR      PRIMARY KEY,
    last_watermark      TIMESTAMP,
    last_load_id        VARCHAR,
    last_run_at         TIMESTAMP,
    rows_merged         INTEGER      NOT NULL DEFAULT 0,
    rows_dead_lettered  INTEGER      NOT NULL DEFAULT 0
);

INSERT INTO analytics.load_watermark (table_name)
SELECT 'fact_trades'
WHERE NOT EXISTS (SELECT 1 FROM analytics.load_watermark WHERE table_name = 'fact_trades');
