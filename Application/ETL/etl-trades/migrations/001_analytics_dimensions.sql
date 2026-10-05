CREATE SCHEMA IF NOT EXISTS analytics;

CREATE SEQUENCE IF NOT EXISTS analytics.seq_instrument_key START 1;
CREATE SEQUENCE IF NOT EXISTS analytics.seq_account_key START 1;

CREATE TABLE IF NOT EXISTS analytics.dim_date (
    date_key            INTEGER      PRIMARY KEY,
    calendar_date       DATE         NOT NULL UNIQUE,
    day_of_week         VARCHAR      NOT NULL,
    day_of_week_number  SMALLINT     NOT NULL,
    day_of_month        SMALLINT     NOT NULL,
    week_of_year        SMALLINT     NOT NULL,
    month               SMALLINT     NOT NULL,
    month_name          VARCHAR      NOT NULL,
    quarter             SMALLINT     NOT NULL,
    year                SMALLINT     NOT NULL,
    is_weekend          BOOLEAN      NOT NULL,
    is_trading_day      BOOLEAN      NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics.dim_instrument (
    instrument_key      BIGINT       PRIMARY KEY DEFAULT nextval('analytics.seq_instrument_key'),
    instrument_id       VARCHAR      NOT NULL UNIQUE,
    instrument_name     VARCHAR      NOT NULL,
    is_active           BOOLEAN      NOT NULL,
    source_updated_on   TIMESTAMP,
    load_id             VARCHAR      NOT NULL,
    loaded_at           TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics.dim_account (
    account_key         BIGINT       PRIMARY KEY DEFAULT nextval('analytics.seq_account_key'),
    client_id           BIGINT       NOT NULL UNIQUE,
    account_number      VARCHAR,
    client_name         VARCHAR      NOT NULL,
    email               VARCHAR      NOT NULL,
    account_state       VARCHAR      NOT NULL,
    client_since        TIMESTAMP    NOT NULL,
    load_id             VARCHAR      NOT NULL,
    loaded_at           TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT chk_dim_account_state
        CHECK (account_state IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);
