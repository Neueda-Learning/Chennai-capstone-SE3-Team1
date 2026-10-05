CREATE SEQUENCE IF NOT EXISTS analytics.seq_trade_key START 1;
CREATE SEQUENCE IF NOT EXISTS analytics.seq_dead_letter_key START 1;

CREATE TABLE IF NOT EXISTS analytics.fact_trades (
    trade_key           BIGINT         PRIMARY KEY DEFAULT nextval('analytics.seq_trade_key'),

    date_key            INTEGER        NOT NULL REFERENCES analytics.dim_date(date_key),
    instrument_key      BIGINT         NOT NULL REFERENCES analytics.dim_instrument(instrument_key),
    account_key         BIGINT         NOT NULL REFERENCES analytics.dim_account(account_key),

    order_id            UUID           NOT NULL UNIQUE,
    idempotency_key     VARCHAR        NOT NULL,

    order_type          VARCHAR        NOT NULL,
    side                VARCHAR        NOT NULL,
    status              VARCHAR        NOT NULL,
    quantity            DECIMAL(18,4)  NOT NULL,
    price               DECIMAL(18,4)  NOT NULL,
    executed_price      DECIMAL(18,4),
    trade_value         DECIMAL(24,4)  NOT NULL,
    failure_code        VARCHAR,
    failure_reason      VARCHAR,

    order_created_at    TIMESTAMP      NOT NULL,
    terminal_at         TIMESTAMP      NOT NULL,

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

CREATE TABLE IF NOT EXISTS analytics.dead_letter_trades (
    dead_letter_key     BIGINT       PRIMARY KEY DEFAULT nextval('analytics.seq_dead_letter_key'),
    load_id             VARCHAR      NOT NULL,
    order_id            UUID,
    check_name          VARCHAR      NOT NULL,
    reason              VARCHAR      NOT NULL,
    source_row          JSON         NOT NULL,
    quarantined_at      TIMESTAMP    NOT NULL DEFAULT now()
);

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
