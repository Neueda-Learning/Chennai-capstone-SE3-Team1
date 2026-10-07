from __future__ import annotations

from datetime import date, datetime, timedelta

import duckdb
import pytest

from ETL_Analysis import analysis as A

AS_OF = date(2026, 10, 2)  # a Friday


def rising(n=80, start=100.0, step=0.5):
    return [start + i * step for i in range(n)]


def falling(n=80, start=200.0, step=0.5):
    return [start - i * step for i in range(n)]


def wavy(n=80, base=100.0):
    return [base + (2 if i % 2 else -2) for i in range(n)]


# ---- the analysis and the suggestion


def test_a_steady_rise_is_an_uptrend_and_a_buy_with_its_reasons():
    a = A.analyse("TCS", rising(), AS_OF)

    assert a.status == "OK"
    assert a.trend == "UP"
    assert a.suggestion == "BUY"
    assert a.score >= 30
    assert a.reasons[0].startswith("Uptrend: the 20-day average")
    assert any(r.startswith("Momentum:") for r in a.reasons)
    assert any("RSI(14)" in r for r in a.reasons)
    assert a.summary.startswith("BUY (")


def test_a_steady_fall_is_a_downtrend_and_a_sell():
    a = A.analyse("TCS", falling(), AS_OF)

    assert a.trend == "DOWN"
    assert a.suggestion == "SELL"
    assert a.score <= -30


def test_a_market_going_nowhere_is_a_hold():
    a = A.analyse("TCS", wavy(), AS_OF)

    assert a.trend == "FLAT"
    assert a.suggestion == "HOLD"
    assert a.confidence == "LOW"


def test_too_little_history_is_no_suggestion_and_says_why():
    a = A.analyse("TCS", rising(30), AS_OF)

    assert a.status == "INSUFFICIENT_DATA"
    assert a.suggestion is None
    assert a.score is None
    assert "Only 30 daily closes" in a.summary


def test_an_overbought_rsi_cuts_the_score():
    closes = rising(80)
    overbought = A.analyse("TCS", closes, AS_OF)
    assert A.rsi(closes) == 100.0
    assert any("above 70" in r for r in overbought.reasons)
    # trend +40, momentum capped +30 at most, RSI -20
    assert overbought.score <= 50


def test_rsi_is_neutral_on_a_flat_series():
    assert A.rsi([100.0] * 20) == 50.0


# ---- the prediction


def test_the_prediction_is_for_the_next_weekday_with_ordered_ranges():
    p = A.predict("TCS", wavy(100), AS_OF)

    assert p.for_date == date(2026, 10, 5)  # Friday -> Monday
    assert p.low_90 <= p.low_68 <= p.predicted_close <= p.high_68 <= p.high_90
    assert A.PROB_FLOOR <= p.prob_up <= A.PROB_CEILING


def test_a_strong_drift_still_keeps_the_chance_of_an_up_day_near_a_coin_flip():
    p = A.predict("TCS", rising(100, step=3.0), AS_OF)

    assert p.prob_up == A.PROB_CEILING
    assert p.predicted_close > p.last_close


def test_no_prediction_without_enough_history():
    assert A.predict("TCS", rising(40), AS_OF) is None


# ---- reading and merging


def test_read_closes_strips_the_suffix_and_prefers_the_nse_listing():
    con = duckdb.connect()
    con.execute('CREATE TABLE daily_price (symbol VARCHAR, trade_date DATE, "interval" VARCHAR, "close" DECIMAL(18,4))')
    for i in range(3):
        day = AS_OF - timedelta(days=3 - i)
        con.execute("INSERT INTO daily_price VALUES ('TCS.BO', ?, '1d', ?)", [day, 1.0])
        con.execute("INSERT INTO daily_price VALUES ('TCS.NS', ?, '1d', ?)", [day, 2.0 + i])
    con.execute("INSERT INTO daily_price VALUES ('INFY.BO', ?, '1d', 9.0)", [AS_OF])
    con.execute("INSERT INTO daily_price VALUES ('TCS.NS', ?, '1wk', 99.0)", [AS_OF])

    series = A.read_closes(con)

    assert series["TCS"] == ([2.0, 3.0, 4.0], AS_OF - timedelta(days=1))
    assert series["INFY"] == ([9.0], AS_OF)


def test_merge_appends_only_the_platform_closes_after_the_warehouse_ends():
    series = {"TCS": ([1.0, 2.0], date(2026, 9, 1))}
    platform = {"TCS": [(date(2026, 8, 31), 50.0), (date(2026, 9, 2), 3.0), (date(2026, 9, 3), 4.0)],
                "NEW": [(date(2026, 9, 3), 7.0)]}

    merged = A.merge_newer(series, platform)

    assert merged["TCS"] == ([1.0, 2.0, 3.0, 4.0], date(2026, 9, 3))
    assert merged["NEW"] == ([7.0], date(2026, 9, 3))


# ---- publishing


@pytest.fixture
def target():
    """DuckDB stand-ins for the two Postgres tables (migration 032), enough to run the published SQL."""
    con = duckdb.connect()
    con.execute("CREATE TABLE instruments (instrument_id VARCHAR PRIMARY KEY)")
    con.execute("INSERT INTO instruments VALUES ('TCS'), ('INFY')")
    con.execute("""CREATE TABLE market_analysis (instrument_id VARCHAR PRIMARY KEY, as_of DATE, status VARCHAR,
        observations INT, close_price DECIMAL(18,4), sma_20 DECIMAL(18,4), sma_50 DECIMAL(18,4),
        rsi_14 DECIMAL(6,2), return_20d_pct DECIMAL(10,4), volatility_pct DECIMAL(10,4),
        max_drawdown_pct DECIMAL(10,4), trend VARCHAR, score DECIMAL(6,2), suggestion VARCHAR,
        confidence VARCHAR, reasons VARCHAR, summary VARCHAR, model VARCHAR, run_id VARCHAR,
        generated_at TIMESTAMP)""")
    con.execute("""CREATE TABLE daily_predictions (instrument_id VARCHAR, for_date DATE, as_of DATE,
        last_close DECIMAL(18,4), predicted_close DECIMAL(18,4), low_68 DECIMAL(18,4), high_68 DECIMAL(18,4),
        low_90 DECIMAL(18,4), high_90 DECIMAL(18,4), prob_up DECIMAL(6,4), expected_return_pct DECIMAL(10,4),
        model VARCHAR, run_id VARCHAR, generated_at TIMESTAMP, PRIMARY KEY (instrument_id, for_date))""")
    return con


def test_published_sql_replaces_the_analysis_and_skips_unknown_instruments(target):
    analyses, predictions = A.compute({"TCS": (rising(), AS_OF), "NOPE": (falling(), AS_OF),
                                       "INFY": (rising(10), AS_OF)})
    target.execute(A.publish_sql(analyses, predictions, "run-1", datetime(2026, 10, 2, 18, 0)))
    target.execute(A.publish_sql(analyses, predictions, "run-2", datetime(2026, 10, 2, 19, 0)))

    rows = target.execute("SELECT instrument_id, status, suggestion, run_id FROM market_analysis "
                          "ORDER BY 1").fetchall()
    assert rows == [("INFY", "INSUFFICIENT_DATA", None, "run-2"), ("TCS", "OK", "BUY", "run-2")]
    predictions_rows = target.execute("SELECT instrument_id, for_date, run_id FROM daily_predictions").fetchall()
    assert predictions_rows == [("TCS", date(2026, 10, 5), "run-2")]


def test_published_sql_survives_a_run_where_nothing_has_enough_history(target):
    analyses, predictions = A.compute({"TCS": (rising(10), AS_OF)})

    target.execute(A.publish_sql(analyses, predictions, "run-1", datetime(2026, 10, 2, 18, 0)))

    assert target.execute("SELECT count(*) FROM market_analysis").fetchone()[0] == 1


def test_a_quote_in_a_reason_is_escaped():
    a = A.analyse("TCS", rising(), AS_OF)
    a.reasons.append("it's fine")

    sql = A.publish_sql([a], [], "run-1", datetime(2026, 10, 2))

    assert "it''s fine" in sql
