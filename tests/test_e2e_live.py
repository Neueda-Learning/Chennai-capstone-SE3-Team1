"""Tests of scripts/e2e_live.py itself, against a throwaway HTTP stub. The live run is the real check; these
only prove the harness reads responses correctly and fails where it should."""
from __future__ import annotations

import base64
import json
import sys
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import e2e_live  # noqa: E402


def make_token(account_id=1, ttl=3600) -> str:
    def part(value: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    return part({"alg": "HS256"}) + "." + part({"accountId": account_id, "exp": int(time.time()) + ttl}) + ".sig"


def test_jwt_claims_reads_the_payload_without_the_secret():
    assert e2e_live.jwt_claims(make_token(7))["accountId"] == 7


def test_jwt_claims_rejects_a_non_jwt():
    with pytest.raises(e2e_live.StepFailed):
        e2e_live.jwt_claims("not-a-token")


def test_thresholds_sit_either_side_of_the_live_price():
    price = Decimal("3300.50")
    assert e2e_live.crossing_threshold(price) > price
    assert e2e_live.reached_threshold(price) < price
    assert e2e_live.crossing_threshold(price) == Decimal("3303.81")
    assert e2e_live.reached_threshold(price) == Decimal("3297.19")


def test_limit_price_clears_the_ask():
    assert e2e_live.limit_price({"price": 100, "ask": 100.2}) == Decimal("101.21")
    assert e2e_live.limit_price({"price": 100, "ask": None}) == Decimal("101.00")


def test_envelope_is_a_quote_for_the_symbol_at_the_price():
    envelope = e2e_live.quote_envelope({"symbol": "TCS", "currency": "INR"}, Decimal("3303.81"))
    assert envelope["eventType"] == "QUOTE" and envelope["schemaVersion"] == 1
    assert envelope["payload"]["symbol"] == "TCS" and envelope["payload"]["price"] == 3303.81
    assert envelope["payload"]["stale"] is False


def test_leaked_address_is_found_in_a_field_or_a_message():
    assert not e2e_live.leaked_address([{"kind": "PRICE_ALERT", "message": "TCS reached 3500"}])
    assert e2e_live.leaked_address([{"address": "x"}])
    assert e2e_live.leaked_address([{"message": "sent to someone@example.test"}])


class Stack:
    """Just enough of the Trade API for the harness: preferences, quotes, orders, alerts, history."""

    def __init__(self, fill=True, fire=True):
        self.fill, self.fire = fill, fire
        self.channel = None
        self.alerts: list[dict] = []
        self.history: list[dict] = []

    def now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def note(self, kind: str):
        self.history.append({"id": f"n{len(self.history)}", "kind": kind, "message": kind, "channel": self.channel,
                             "status": "SENT", "createdAt": self.now(), "deliveredAt": self.now()})

    def handle(self, method, path, body):
        if path.endswith("/preferences"):
            if method == "PUT":
                self.channel = body["channel"]
            return (200, {"accountId": 1, "defaultAccountId": 1, "channel": self.channel}) if self.channel else \
                (404, {"errorCode": "PRF-404"})
        if path.startswith("/api/v1/market/quotes"):
            return 200, [{"symbol": "TCS", "price": 3300.5, "ask": 3300.7, "stale": False, "quoteAsOf": self.now()}]
        if path == "/api/v1/orders":
            if self.fill:
                self.note("ORDER_FILLED")
            return 201, {"orderId": "o-1", "status": "NEW"}
        if "/alerts" in path:
            if method == "POST":
                self.alerts.append({"id": "a-1", "state": "ARMED", "deliveryState": None, "firedPrice": None})
                return 201, self.alerts[0]
            if method == "DELETE":
                self.alerts.clear()
                return 204, None
            return 200, self.alerts
        if "/notification-history" in path:
            return 200, self.history
        return 404, {}

    def publish(self):
        if self.fire and self.alerts:
            self.alerts[0].update(state="FIRED", deliveryState="QUEUED", firedPrice=3303.81)
            self.note("PRICE_ALERT")


@pytest.fixture
def server():
    stack = Stack()

    class Handler(BaseHTTPRequestHandler):
        def respond(self, method):
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if length else None
            status, payload = stack.handle(method, self.path, body)
            data = b"" if payload is None else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self): self.respond("GET")
        def do_PUT(self): self.respond("PUT")
        def do_POST(self): self.respond("POST")
        def do_DELETE(self): self.respond("DELETE")
        def log_message(self, *args): pass

    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield stack, f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


def run_against(stack, url, tmp_path, monkeypatch, extra=()):
    token = tmp_path / "token.txt"
    token.write_text(make_token())
    args = e2e_live.parse(["--api", url, "--token-file", str(token), "--timeout", "4", *extra])
    run = e2e_live.Run(args)

    def kafka(self, main_class, *arguments, stdin=None):
        if main_class.endswith("ConsumerGroupCommand"):
            return 0, "\n".join(e2e_live.REQUIRED_GROUPS), ""
        stack.publish()
        return 0, "", ""

    monkeypatch.setattr(e2e_live.Run, "kafka", kafka)
    monkeypatch.setattr(e2e_live, "REPO_ROOT", tmp_path)
    return run


def test_the_whole_chain_passes_against_a_working_stack(server, tmp_path, monkeypatch):
    stack, url = server
    run = run_against(stack, url, tmp_path, monkeypatch, ["--cleanup"])
    assert run.execute() == 0
    assert all(ok for _, ok, _ in run.steps)
    assert "every step passed" in (tmp_path / "logs" / "local" / "e2e-report.md").read_text()
    assert stack.alerts == []


def test_a_missing_trade_notification_stops_the_run_and_says_so(server, tmp_path, monkeypatch):
    stack, url = server
    stack.fill = False
    run = run_against(stack, url, tmp_path, monkeypatch)
    assert run.execute() == 1
    assert run.steps[-1][1] is False
    assert "FAILED" in (tmp_path / "logs" / "local" / "e2e-report.md").read_text()


def test_an_alert_that_never_fires_fails_the_run(server, tmp_path, monkeypatch):
    stack, url = server
    stack.fire = False
    run = run_against(stack, url, tmp_path, monkeypatch)
    assert run.execute() == 1
    assert run.steps[-1][0] == "The alert fired and was handed to Notifications"


def test_an_expired_token_is_refused_before_anything_is_called(server, tmp_path, monkeypatch):
    stack, url = server
    (tmp_path / "token.txt").write_text(make_token(ttl=-10))
    args = e2e_live.parse(["--api", url, "--token-file", str(tmp_path / "token.txt")])
    monkeypatch.setattr(e2e_live, "REPO_ROOT", tmp_path)
    run = e2e_live.Run(args)
    assert run.execute() == 1
    assert stack.history == [] and stack.alerts == []
