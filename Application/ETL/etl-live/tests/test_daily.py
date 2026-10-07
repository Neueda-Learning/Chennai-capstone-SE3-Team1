from __future__ import annotations

from datetime import date

from ETL_Analysis import daily
from ETL_Analysis import pipeline
from ETL_Analysis import symbols

DAY = date(2026, 10, 7)


class FakeLive:
    def __init__(self):
        self.calls = []

    def __call__(self, symbol, use_cache=True, interval=None):
        self.calls.append((symbol, use_cache))
        return {"symbol": symbol, "candles": [], "n": len(self.calls)}


def test_a_symbol_is_fetched_once_a_day_and_served_from_the_day_cache_after_that(tmp_path):
    live = FakeLive()
    extract = daily.dated_extract(DAY, live, tmp_path)

    first = extract("TCS.NS")
    second = extract("TCS.NS")

    assert live.calls == [("TCS.NS", False)], "the live client is asked once, never through its undated cache"
    assert first == second
    assert daily.cached_symbols(DAY, tmp_path) == {"TCS.NS"}


def test_a_new_day_fetches_again(tmp_path):
    live = FakeLive()
    daily.dated_extract(DAY, live, tmp_path)("TCS.NS")
    daily.dated_extract(date(2026, 10, 8), live, tmp_path)("TCS.NS")

    assert len(live.calls) == 2


def test_old_day_caches_are_pruned_and_recent_ones_kept(tmp_path):
    for day in ("2026-09-20", "2026-10-01", "2026-10-07", "not-a-day"):
        (tmp_path / day).mkdir()

    removed = daily.prune(DAY, tmp_path, keep_days=7)

    assert removed == 1
    assert sorted(p.name for p in tmp_path.iterdir()) == ["2026-10-01", "2026-10-07", "not-a-day"]


def test_refresh_counts_the_day_cache_against_the_quota_and_loads_through_the_pipeline(tmp_path, monkeypatch):
    daily.dated_extract(DAY, FakeLive(), tmp_path)("TCS.NS")
    planned = {}
    loaded = {}
    monkeypatch.setattr(symbols, "load_symbol_file", lambda path: ["TCS.NS", "INFY.NS"])
    monkeypatch.setattr(symbols, "plan_pull", lambda universe, cached=0, check_quota=True:
                        planned.update(universe=universe, cached=cached) or {"ok": True})

    def run(universe, extract_fn=None, db_path=None):
        loaded.update(universe=universe, db=db_path)
        for symbol in universe:
            extract_fn(symbol)
        return 0

    monkeypatch.setattr(pipeline, "run", run)
    live = FakeLive()

    ok, message = daily.refresh_warehouse(DAY, "w.duckdb", live_extract=live, root=tmp_path)

    assert ok
    assert planned == {"universe": ["TCS.NS", "INFY.NS"], "cached": 1}
    assert live.calls == [("INFY.NS", False)], "TCS came from today's cache"
    assert loaded["db"] == "w.duckdb"
    assert message == f"2 of 2 symbols for {DAY}"


def test_too_little_quota_refreshes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(symbols, "load_symbol_file", lambda path: ["TCS.NS"])

    def too_low(universe, cached=0, check_quota=True):
        raise symbols.QuotaTooLow("1 request(s) needed but only 0 left today")

    monkeypatch.setattr(symbols, "plan_pull", too_low)
    monkeypatch.setattr(pipeline, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not run")))

    ok, message = daily.refresh_warehouse(DAY, "w.duckdb", live_extract=FakeLive(), root=tmp_path)

    assert not ok
    assert "only 0 left" in message


def test_exit_codes_tell_the_trade_api_what_happened(tmp_path):
    ok_refresh = lambda day, db, limit: (True, "fine")
    bad_refresh = lambda day, db, limit: (False, "no key")
    def broken_refresh(day, db, limit):
        raise RuntimeError("boom")

    assert daily.main(["--day", "2026-10-07"], refresh=ok_refresh, publish=lambda db: 0) == daily.EXIT_OK
    assert daily.main(["--day", "2026-10-07"], refresh=bad_refresh, publish=lambda db: 0) \
        == daily.EXIT_PUBLISHED_FROM_CACHE
    assert daily.main(["--day", "2026-10-07"], refresh=broken_refresh, publish=lambda db: 0) \
        == daily.EXIT_PUBLISHED_FROM_CACHE
    assert daily.main(["--day", "2026-10-07"], refresh=ok_refresh, publish=lambda db: 1) \
        == daily.EXIT_ANALYSIS_FAILED


def test_skip_refresh_publishes_from_the_stored_data_without_refreshing():
    def refresh(day, db, limit):
        raise AssertionError("must not refresh")

    published = []
    code = daily.main(["--day", "2026-10-07", "--skip-refresh", "--db", "x.duckdb"],
                      refresh=refresh, publish=lambda db: published.append(db) or 0)

    assert code == daily.EXIT_PUBLISHED_FROM_CACHE
    assert published == ["x.duckdb"]
