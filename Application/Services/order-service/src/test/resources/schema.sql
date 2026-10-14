DROP TABLE IF EXISTS etl_daily_runs;
DROP TABLE IF EXISTS daily_predictions;
DROP TABLE IF EXISTS market_analysis;
DROP TABLE IF EXISTS price_alerts;
DROP TABLE IF EXISTS watchlist_instruments;
DROP TABLE IF EXISTS watchlists;
DROP TABLE IF EXISTS market_quotes;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS customer_preferences;
DROP TABLE IF EXISTS wallet_transfers;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS bank_account;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS auth;
DROP TABLE IF EXISTS instruments;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS order_history;
DROP TABLE IF EXISTS portfolio_holding;
DROP TABLE IF EXISTS portfolio_positions;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS holdings;

CREATE TABLE clients (
    client_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(150)    NOT NULL,
    created_on      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    account_state   VARCHAR(10)     NOT NULL DEFAULT 'ACTIVE',
    wallet_balance  DECIMAL(18,2)   NOT NULL DEFAULT 0,
    version         INT             NOT NULL DEFAULT 0,
    updated_on      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bank_account (
    account_number  VARCHAR(34)     PRIMARY KEY,
    client_id       BIGINT          UNIQUE,
    account_balance DECIMAL(18,2)   NOT NULL DEFAULT 0,
    bank_name       VARCHAR(150)    NOT NULL,
    ifsc_code       VARCHAR(11)     NOT NULL
);

CREATE TABLE users (
    id             UUID          DEFAULT RANDOM_UUID() PRIMARY KEY,
    username       VARCHAR(64)   NOT NULL UNIQUE,
    email          VARCHAR(150)  NOT NULL UNIQUE,
    phone          VARCHAR(20),
    account_id     BIGINT        UNIQUE,
    roles          VARCHAR(20) ARRAY NOT NULL DEFAULT ARRAY['CUSTOMER'],
    password_hash  VARCHAR(255)  NOT NULL,
    params_version INT           NOT NULL DEFAULT 1,
    version        INT           NOT NULL DEFAULT 0,
    created_on     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instruments (
    instrument_id   VARCHAR(20)     PRIMARY KEY,
    instrument_name VARCHAR(150)    NOT NULL UNIQUE,
    active          BOOLEAN         NOT NULL DEFAULT TRUE,
    updated_on      TIMESTAMP
);

CREATE TABLE orders (
    order_id          UUID            PRIMARY KEY,
    client_id         BIGINT          NOT NULL,
    account_id        BIGINT          NOT NULL,
    instrument_id     VARCHAR(20)     NOT NULL,
    order_type        VARCHAR(8)      NOT NULL,
    side              VARCHAR(4)      NOT NULL,
    quantity          DECIMAL(18,4)   NOT NULL,
    price             DECIMAL(18,4)   NOT NULL,
    executed_price    DECIMAL(18,4),
    status            VARCHAR(10)     NOT NULL DEFAULT 'NEW',
    idempotency_key   VARCHAR(100)    NOT NULL,
    external_order_id VARCHAR(100),
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    condition_type    VARCHAR(24),
    trigger_price     DECIMAL(18,4),
    short_window      INT,
    long_window       INT,
    band_width        DECIMAL(4,2),
    condition_state   VARCHAR(8),
    expires_at        TIMESTAMP,
    last_checked_at   TIMESTAMP,
    triggered_at      TIMESTAMP,
    trigger_reason    VARCHAR(300),
    CONSTRAINT uq_orders_idempotency_key UNIQUE (idempotency_key)
);

CREATE TABLE order_history (
    history_id        BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id          UUID          NOT NULL,
    event_type        VARCHAR(50)   NOT NULL,
    previous_status   VARCHAR(10),
    new_status        VARCHAR(10),
    external_status   VARCHAR(50),
    external_order_id VARCHAR(100),
    request_id        VARCHAR(100),
    failure_code      VARCHAR(50),
    failure_reason    VARCHAR(255),
    api_response      TEXT,
    event_timestamp   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    client_id         BIGINT,
    account_id        BIGINT,
    instrument_id     VARCHAR(20),
    order_type        VARCHAR(8),
    side              VARCHAR(4),
    quantity          DECIMAL(18,4),
    price             DECIMAL(18,4),
    executed_price    DECIMAL(18,4),
    idempotency_key   VARCHAR(100),
    order_created_at  TIMESTAMP
);

CREATE UNIQUE INDEX uq_order_history_idempotency_key
    ON order_history (idempotency_key);

CREATE TABLE portfolio_holding (
    holding_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    client_id       BIGINT          NOT NULL,
    instrument_id   VARCHAR(20)     NOT NULL,
    quantity        INT             NOT NULL,
    price_per_unit  DECIMAL(18,4)   NOT NULL,
    overall_gains   DECIMAL(18,2)   NOT NULL DEFAULT 0,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_portfolio_holding_client_instrument UNIQUE (client_id, instrument_id)
);

CREATE TABLE portfolio_positions (
    position_id     BIGINT AUTO_INCREMENT PRIMARY KEY,
    client_id       BIGINT          NOT NULL,
    instrument_id   VARCHAR(20)     NOT NULL,
    quantity        INT             NOT NULL,
    price_per_unit  DECIMAL(18,4)   NOT NULL,
    overall_gains   DECIMAL(18,2)   NOT NULL DEFAULT 0,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_portfolio_positions_client_instrument UNIQUE (client_id, instrument_id)
);

CREATE TABLE positions (
    account_id      BIGINT          NOT NULL,
    instrument_id   VARCHAR(20)     NOT NULL,
    quantity        INT             NOT NULL,
    avg_price       DECIMAL(18,4)   NOT NULL,
    CONSTRAINT uq_positions_account_instrument UNIQUE (account_id, instrument_id)
);

CREATE TABLE holdings (
    account_id      BIGINT          NOT NULL,
    instrument_id   VARCHAR(20)     NOT NULL,
    quantity        INT             NOT NULL,
    CONSTRAINT uq_holdings_account_instrument UNIQUE (account_id, instrument_id)
);

CREATE TABLE wallet_transfers (
    transfer_id      UUID            PRIMARY KEY,
    client_id        BIGINT          NOT NULL,
    account_number   VARCHAR(34)     NOT NULL,
    direction        VARCHAR(16)     NOT NULL,
    amount           DECIMAL(18,2)   NOT NULL,
    idempotency_key  VARCHAR(100)    NOT NULL UNIQUE,
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_preferences (
    account_id               BIGINT        PRIMARY KEY,
    default_account_id       BIGINT        NOT NULL,
    channel                  VARCHAR(10),
    channel_contact_override VARCHAR(150),
    created_at               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_customer_preferences_channel
        CHECK (channel IS NULL OR channel IN ('EMAIL', 'PUSH'))
);

CREATE TABLE notifications (
    id           UUID          PRIMARY KEY,
    event_id     VARCHAR(64)   NOT NULL,
    account_id   BIGINT        NOT NULL,
    kind         VARCHAR(20)   NOT NULL,
    channel      VARCHAR(10),
    address      VARCHAR(150),
    status       VARCHAR(20)   NOT NULL,
    failure_code VARCHAR(40),
    payload      TEXT          NOT NULL,
    created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP,
    CONSTRAINT uq_notifications_event_id UNIQUE (event_id),
    CONSTRAINT chk_notifications_kind
        CHECK (kind IN ('ORDER_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'PRICE_ALERT', 'TRANSFER_IN', 'TRANSFER_OUT')),
    CONSTRAINT chk_notifications_channel
        CHECK (channel IS NULL OR channel IN ('EMAIL', 'PUSH')),
    CONSTRAINT chk_notifications_status
        CHECK (status IN ('PENDING_CHANNEL', 'QUEUED', 'SENT', 'FAILED'))
);
CREATE INDEX idx_notifications_account_created ON notifications (account_id, created_at DESC);

CREATE TABLE market_quotes (
    quote_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
    instrument_id  VARCHAR(20)     NOT NULL,
    price          DECIMAL(18,4)   NOT NULL,
    bid            DECIMAL(18,4),
    ask            DECIMAL(18,4),
    currency       VARCHAR(3),
    day_change     DECIMAL(18,4),
    change_percent DECIMAL(10,4),
    previous_close DECIMAL(18,4),
    market_state   VARCHAR(20),
    stale          BOOLEAN         NOT NULL DEFAULT FALSE,
    quote_as_of    TIMESTAMP,
    received_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_market_quotes_instrument_received ON market_quotes (instrument_id, received_at DESC);

CREATE TABLE watchlists (
    watchlist_id UUID         PRIMARY KEY,
    account_id   BIGINT       NOT NULL,
    name         VARCHAR_IGNORECASE(60) NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_watchlists_account_name ON watchlists (account_id, name);

CREATE TABLE watchlist_instruments (
    watchlist_id  UUID         NOT NULL,
    instrument_id VARCHAR(20)  NOT NULL,
    added_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (watchlist_id, instrument_id),
    CONSTRAINT fk_watchlist_instruments_watchlist
        FOREIGN KEY (watchlist_id) REFERENCES watchlists(watchlist_id) ON DELETE CASCADE
);

CREATE TABLE price_alerts (
    alert_id       UUID           PRIMARY KEY,
    account_id     BIGINT         NOT NULL,
    instrument_id  VARCHAR(20)    NOT NULL,
    threshold      DECIMAL(18,4)  NOT NULL,
    direction      VARCHAR(5)     NOT NULL,
    state          VARCHAR(10)    NOT NULL DEFAULT 'ARMED',
    delivery_state VARCHAR(20),
    fired_at       TIMESTAMP,
    fired_price    DECIMAL(18,4),
    created_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_price_alerts_threshold CHECK (threshold > 0),
    CONSTRAINT chk_price_alerts_direction CHECK (direction IN ('ABOVE', 'BELOW')),
    CONSTRAINT chk_price_alerts_state CHECK (state IN ('ARMED', 'FIRED', 'DISABLED')),
    CONSTRAINT chk_price_alerts_delivery_state
        CHECK (delivery_state IS NULL
               OR delivery_state IN ('QUEUED', 'PENDING_CHANNEL', 'REJECTED', 'DELIVERY_FAILED'))
);
CREATE INDEX idx_price_alerts_symbol_state ON price_alerts (instrument_id, state);

CREATE TABLE market_analysis (
    instrument_id    VARCHAR(20)    PRIMARY KEY,
    as_of            DATE,
    status           VARCHAR(20)    NOT NULL,
    observations     INT            NOT NULL,
    close_price      DECIMAL(18,4),
    sma_20           DECIMAL(18,4),
    sma_50           DECIMAL(18,4),
    rsi_14           DECIMAL(6,2),
    return_20d_pct   DECIMAL(10,4),
    volatility_pct   DECIMAL(10,4),
    max_drawdown_pct DECIMAL(10,4),
    trend            VARCHAR(8),
    score            DECIMAL(6,2),
    suggestion       VARCHAR(4),
    confidence       VARCHAR(8),
    reasons          TEXT           NOT NULL,
    summary          VARCHAR(400)   NOT NULL,
    model            VARCHAR(60)    NOT NULL,
    run_id           VARCHAR(40)    NOT NULL,
    generated_at     TIMESTAMP      NOT NULL
);

CREATE TABLE daily_predictions (
    instrument_id       VARCHAR(20)    NOT NULL,
    for_date            DATE           NOT NULL,
    as_of               DATE           NOT NULL,
    last_close          DECIMAL(18,4)  NOT NULL,
    predicted_close     DECIMAL(18,4)  NOT NULL,
    low_68              DECIMAL(18,4)  NOT NULL,
    high_68             DECIMAL(18,4)  NOT NULL,
    low_90              DECIMAL(18,4)  NOT NULL,
    high_90             DECIMAL(18,4)  NOT NULL,
    prob_up             DECIMAL(6,4)   NOT NULL,
    expected_return_pct DECIMAL(10,4)  NOT NULL,
    model               VARCHAR(60)    NOT NULL,
    run_id              VARCHAR(40)    NOT NULL,
    generated_at        TIMESTAMP      NOT NULL,
    PRIMARY KEY (instrument_id, for_date)
);

CREATE TABLE etl_daily_runs (
    run_day        DATE          PRIMARY KEY,
    status         VARCHAR(10)   NOT NULL,
    trigger_source VARCHAR(20)   NOT NULL,
    attempts       INT           NOT NULL DEFAULT 1,
    started_at     TIMESTAMP     NOT NULL,
    finished_at    TIMESTAMP,
    exit_code      INT,
    message        VARCHAR(500)
);
