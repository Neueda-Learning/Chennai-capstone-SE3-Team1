BEGIN;

-- Published by the ETL analysis job (Application/ETL/etl-live/analysis.py, ADR 0011) and read-only to the
-- Trade REST API. The job computes from the warehouse's daily prices; Postgres is only where the result is
-- handed over, so the API, the dashboard and the assistant read one answer.

-- One row per instrument, replaced on every run.
CREATE TABLE market_analysis (
    instrument_id    VARCHAR(20)    PRIMARY KEY REFERENCES instruments(instrument_id),
    as_of            DATE,
    status           VARCHAR(20)    NOT NULL,
    observations     INT            NOT NULL,
    close_price      NUMERIC(18,4),
    sma_20           NUMERIC(18,4),
    sma_50           NUMERIC(18,4),
    rsi_14           NUMERIC(6,2),
    return_20d_pct   NUMERIC(10,4),
    volatility_pct   NUMERIC(10,4),
    max_drawdown_pct NUMERIC(10,4),
    trend            VARCHAR(8),
    score            NUMERIC(6,2),
    suggestion       VARCHAR(4),
    confidence       VARCHAR(8),
    reasons          TEXT           NOT NULL,
    summary          VARCHAR(400)   NOT NULL,
    model            VARCHAR(60)    NOT NULL,
    run_id           VARCHAR(40)    NOT NULL,
    generated_at     TIMESTAMP      NOT NULL,
    CONSTRAINT chk_market_analysis_status CHECK (status IN ('OK', 'INSUFFICIENT_DATA')),
    CONSTRAINT chk_market_analysis_suggestion CHECK (suggestion IS NULL OR suggestion IN ('BUY', 'SELL', 'HOLD')),
    CONSTRAINT chk_market_analysis_confidence CHECK (confidence IS NULL OR confidence IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT chk_market_analysis_trend CHECK (trend IS NULL OR trend IN ('UP', 'DOWN', 'FLAT')),
    CONSTRAINT chk_market_analysis_ok_has_suggestion CHECK (status <> 'OK' OR suggestion IS NOT NULL)
);

-- One row per instrument per predicted session, kept, so a prediction can be checked against the close.
CREATE TABLE daily_predictions (
    instrument_id       VARCHAR(20)    NOT NULL REFERENCES instruments(instrument_id),
    for_date            DATE           NOT NULL,
    as_of               DATE           NOT NULL,
    last_close          NUMERIC(18,4)  NOT NULL,
    predicted_close     NUMERIC(18,4)  NOT NULL,
    low_68              NUMERIC(18,4)  NOT NULL,
    high_68             NUMERIC(18,4)  NOT NULL,
    low_90              NUMERIC(18,4)  NOT NULL,
    high_90             NUMERIC(18,4)  NOT NULL,
    prob_up             NUMERIC(6,4)   NOT NULL,
    expected_return_pct NUMERIC(10,4)  NOT NULL,
    model               VARCHAR(60)    NOT NULL,
    run_id              VARCHAR(40)    NOT NULL,
    generated_at        TIMESTAMP      NOT NULL,
    PRIMARY KEY (instrument_id, for_date),
    CONSTRAINT chk_daily_predictions_ranges CHECK (low_90 <= low_68 AND low_68 <= high_68 AND high_68 <= high_90),
    CONSTRAINT chk_daily_predictions_prob CHECK (prob_up BETWEEN 0 AND 1),
    CONSTRAINT chk_daily_predictions_after CHECK (for_date > as_of)
);

CREATE INDEX idx_daily_predictions_for_date ON daily_predictions (for_date DESC);

COMMIT;
