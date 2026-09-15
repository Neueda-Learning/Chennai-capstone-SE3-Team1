BEGIN;

-- One row per order that reached a terminal state, in whatever state it
-- reached. Rejected and cancelled orders are facts too: fill rate is
-- FILLED / everything, and the denominator has to be in this table.
--
-- Source is public.order_history (the row whose new_status is terminal)
-- joined back to public.orders for the order's own fields. order_id is the
-- natural key; the UNIQUE on it is what the merge relies on.
CREATE TABLE IF NOT EXISTS analytics.fact_trades (
    trade_key           BIGSERIAL       PRIMARY KEY,

    -- dimension keys
    date_key            INTEGER         NOT NULL REFERENCES analytics.dim_date(date_key),
    instrument_key      BIGINT          NOT NULL REFERENCES analytics.dim_instrument(instrument_key),
    account_key         BIGINT          NOT NULL REFERENCES analytics.dim_account(account_key),

    -- natural key
    order_id            UUID            NOT NULL,
    idempotency_key     VARCHAR(100)    NOT NULL,

    -- measures and degenerate dimensions
    order_type          VARCHAR(8)      NOT NULL,
    side                VARCHAR(4)      NOT NULL,
    status              VARCHAR(10)     NOT NULL,
    quantity            DECIMAL(18,4)   NOT NULL,
    price               DECIMAL(18,4)   NOT NULL,
    executed_price      DECIMAL(18,4),
    trade_value         DECIMAL(24,4)   NOT NULL,   -- quantity * coalesce(executed_price, price)
    failure_code        VARCHAR(50),
    failure_reason      VARCHAR(255),

    order_created_at    TIMESTAMP       NOT NULL,   -- the watermark column
    terminal_at         TIMESTAMP       NOT NULL,   -- order_history.event_timestamp of the terminal event

    load_id             VARCHAR(40)     NOT NULL,
    loaded_at           TIMESTAMP       NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP       NOT NULL DEFAULT now(),

    CONSTRAINT uq_fact_trades_order_id UNIQUE (order_id),
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

CREATE INDEX IF NOT EXISTS idx_fact_trades_date_key       ON analytics.fact_trades(date_key);
CREATE INDEX IF NOT EXISTS idx_fact_trades_instrument_key ON analytics.fact_trades(instrument_key);
CREATE INDEX IF NOT EXISTS idx_fact_trades_account_key    ON analytics.fact_trades(account_key);
CREATE INDEX IF NOT EXISTS idx_fact_trades_status         ON analytics.fact_trades(status);
CREATE INDEX IF NOT EXISTS idx_fact_trades_created_at     ON analytics.fact_trades(order_created_at);

-- A row that fails a quality check lands here with the check it failed and
-- the load it came from, so it can be investigated instead of being lost.
-- The raw source row is kept whole because the failing field is often not
-- the interesting one.
CREATE TABLE IF NOT EXISTS analytics.dead_letter_trades (
    dead_letter_key     BIGSERIAL       PRIMARY KEY,
    load_id             VARCHAR(40)     NOT NULL,
    order_id            UUID,                       -- NULL if the source row had no usable order_id
    check_name          VARCHAR(60)     NOT NULL,   -- e.g. fk_instrument, positive_quantity, valid_side
    reason              VARCHAR(500)    NOT NULL,
    source_row          JSONB           NOT NULL,
    quarantined_at      TIMESTAMP       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_trades_load_id ON analytics.dead_letter_trades(load_id);
CREATE INDEX IF NOT EXISTS idx_dead_letter_trades_check   ON analytics.dead_letter_trades(check_name);

-- One row per target table. last_watermark is the greatest
-- orders.created_at the load has processed; the next load starts after it.
CREATE TABLE IF NOT EXISTS analytics.load_watermark (
    table_name          VARCHAR(63)     PRIMARY KEY,
    last_watermark      TIMESTAMP,
    last_load_id        VARCHAR(40),
    last_run_at         TIMESTAMP,
    rows_merged         INTEGER         NOT NULL DEFAULT 0,
    rows_dead_lettered  INTEGER         NOT NULL DEFAULT 0
);

INSERT INTO analytics.load_watermark (table_name)
VALUES ('fact_trades')
ON CONFLICT (table_name) DO NOTHING;

COMMIT;
