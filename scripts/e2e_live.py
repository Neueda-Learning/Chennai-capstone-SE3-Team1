#!/usr/bin/env python3
"""Live end-to-end check of the Sprint 10 chain against the running stack. Nothing is stubbed.

    python scripts/e2e_live.py                           # token from logs/local/token.txt, PUSH channel
    python scripts/e2e_live.py --channel EMAIL           # the same chain, delivered by the vault SMTP account
    python scripts/e2e_live.py --real-quote              # wait for the market poller's own quote, publish nothing
    python scripts/e2e_live.py --username test.trader --password 'TestTrader#2026!'

What it does, in order, against the Trade API, Kafka and the consumers that are already running:

  1. Preflight: the API serves the Sprint 10 routes, and the consumer groups notification-service,
     watchlist-service and portfolio-service are attached to the live broker.
  2. Preferences: stores a channel through PUT /preferences and reads it back.
  3. Order: reads the latest real quote, places a real BUY order priced just over the ask, and waits for the
     executor to fill it and for the ledger to show ORDER_FILLED on the stored channel.
  4. Alert: creates an ABOVE alert, then either publishes one quote that reaches the threshold to the
     market-data topic (default) or waits for the market poller's own next quote (--real-quote), and waits
     for the alert to fire, be handed to Notifications, and appear as PRICE_ALERT in the same ledger.
  5. Checks both notifications used the stored channel and that no response carries an address.

Every check goes through the public routes, so no database credentials are needed. Results are printed and
written to logs/local/e2e-report.md. Exit status is 0 only when every step passed.

The published quote (default mode) is one message at the alert threshold, 0.1% over the latest real price;
the market poller overwrites it with a real quote within a poll interval. The order and the alert are real
rows and are kept so they can be shown; pass --cleanup to delete the alert afterwards.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from decimal import ROUND_DOWN, ROUND_UP, Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
REQUIRED_GROUPS = ("notification-service", "watchlist-service", "portfolio-service")
TRADE_KINDS = ("ORDER_FILLED", "ORDER_REJECTED", "ORDER_CANCELLED")


class StepFailed(Exception):
    pass


def jwt_claims(token: str) -> dict:
    try:
        body = token.split(".")[1]
        body += "=" * (-len(body) % 4)
        return json.loads(base64.urlsafe_b64decode(body))
    except (IndexError, ValueError) as error:
        raise StepFailed("the token is not a JWT") from error


def crossing_threshold(price: Decimal) -> Decimal:
    """An ABOVE threshold just over the live price, so the alert is armed and not already reached."""
    return (price * Decimal("1.001")).quantize(Decimal("0.01"), rounding=ROUND_UP)


def reached_threshold(price: Decimal) -> Decimal:
    """An ABOVE threshold just under the live price, reached by the poller's next quote."""
    return (price * Decimal("0.999")).quantize(Decimal("0.01"), rounding=ROUND_DOWN)


def limit_price(quote: dict) -> Decimal:
    """A BUY limit that clears the ask, so the order is not refused for sitting below it."""
    basis = Decimal(str(quote.get("ask") or quote["price"]))
    return (basis * Decimal("1.01")).quantize(Decimal("0.01"), rounding=ROUND_UP)


def quote_envelope(quote: dict, price: Decimal) -> dict:
    payload = {
        "symbol": quote["symbol"],
        "price": float(price),
        "bid": float(price),
        "ask": float(price),
        "currency": quote.get("currency") or "INR",
        "change": quote.get("change"),
        "changePercent": quote.get("changePercent"),
        "previousClose": quote.get("previousClose"),
        "marketState": quote.get("marketState") or "REGULAR",
        "stale": False,
        "quoteAsOf": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    return {
        "eventId": str(uuid.uuid4()),
        "eventType": "QUOTE",
        "eventTime": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "e2e-live",
        "schemaVersion": 1,
        "payload": payload,
    }


def leaked_address(entries: list) -> bool:
    for entry in entries:
        if any(key in entry for key in ("address", "email", "destination")):
            return True
        if "@" in str(entry.get("message", "")):
            return True
    return False


class Run:
    def __init__(self, args):
        self.args = args
        self.steps: list[tuple[str, bool, str]] = []
        self.facts: dict[str, str] = {}
        self.token = ""
        self.account_id = 0

    def record(self, name: str, ok: bool, detail: str = "") -> None:
        self.steps.append((name, ok, detail))
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""), flush=True)
        if not ok:
            raise StepFailed(name)

    def call(self, method: str, url: str, body=None, headers=None, timeout=20):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode()
                return response.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            try:
                return error.code, json.loads(raw)
            except ValueError:
                return error.code, raw
        except (urllib.error.URLError, OSError) as error:
            raise StepFailed(f"cannot reach {url}: {error}") from error

    def api(self, method: str, path: str, body=None):
        return self.call(method, self.args.api + path, body, {"Authorization": "Bearer " + self.token})

    def account(self, suffix: str) -> str:
        return f"/api/v1/accounts/{self.account_id}/{suffix}"

    def wait_for(self, probe, seconds: int, every: float = 2.0):
        deadline = time.monotonic() + seconds
        while True:
            found = probe()
            if found:
                return found
            if time.monotonic() >= deadline:
                return None
            time.sleep(every)

    def kafka(self, main_class: str, *arguments: str, stdin: str | None = None):
        libs = str(Path(self.args.kafka_home) / "libs" / "*")
        command = ["java", "-cp", libs, main_class, *arguments]
        done = subprocess.run(command, input=stdin, capture_output=True, text=True, timeout=60)
        return done.returncode, done.stdout, done.stderr

    def sign_in(self) -> None:
        args = self.args
        if args.username:
            status, body = self.call("POST", args.auth + "/auth/login",
                                     {"username": args.username, "password": args.password})
            if status != 200 or not isinstance(body, dict) or "accessToken" not in body:
                raise StepFailed(f"sign-in through the auth service answered {status}")
            self.token = body["accessToken"]
        else:
            path = Path(args.token_file)
            if not path.is_file():
                raise StepFailed(f"no token file at {path}; run run-local.ps1 or pass --username and --password")
            self.token = path.read_text().strip()
        claims = jwt_claims(self.token)
        if claims.get("exp", 0) <= time.time():
            raise StepFailed("the token has expired; run-local.ps1 mints a new one, or sign in with --username")
        if not claims.get("accountId"):
            raise StepFailed("the token has no accountId; link a bank account and refresh first")
        self.account_id = int(claims["accountId"])

    def preflight(self) -> None:
        self.sign_in()
        status, _ = self.api("GET", self.account("alerts"))
        self.record("Trade API serves the Watchlists route", status == 200,
                    f"HTTP {status}" if status == 200 else f"HTTP {status}: rebuild and restart with run-local.ps1")
        status, body = self.api("GET", self.account("preferences"))
        known = status == 200 or (status == 404 and isinstance(body, dict) and body.get("errorCode") == "PRF-404")
        self.record("Trade API serves the Preferences route", known, f"HTTP {status}")
        status, _ = self.api("GET", self.account("notification-history?limit=1"))
        self.record("Trade API serves the Notifications route", status == 200, f"HTTP {status}")
        code, out, err = self.kafka("kafka.admin.ConsumerGroupCommand",
                                    "--bootstrap-server", self.args.bootstrap, "--list")
        groups = set(out.split())
        missing = [group for group in REQUIRED_GROUPS if group not in groups]
        self.record("Consumer groups attached to the live broker", code == 0 and not missing,
                    "all of " + ", ".join(REQUIRED_GROUPS) if not missing else "missing " + ", ".join(missing))

    def preference(self) -> None:
        channel = self.args.channel
        status, body = self.api("PUT", self.account("preferences"),
                                {"defaultAccountId": self.account_id, "channel": channel})
        self.record("Store the channel preference", status == 200, f"PUT -> HTTP {status}")
        status, body = self.api("GET", self.account("preferences"))
        ok = status == 200 and body.get("channel") == channel
        self.record("Read the preference back", ok, f"channel={body.get('channel') if isinstance(body, dict) else body}")

    def pick_quote(self) -> dict:
        status, quotes = self.api("GET", "/api/v1/market/quotes")
        if status != 200 or not isinstance(quotes, list):
            raise StepFailed(f"market quotes answered {status}")
        live = [q for q in quotes if q.get("price") and not q.get("stale")]
        if self.args.symbol:
            live = [q for q in live if q["symbol"] == self.args.symbol.upper()]
        self.record("A live, non-stale quote exists", bool(live),
                    f"{len(live)} usable of {len(quotes)}" if live else "the market poller has produced nothing usable")
        quote = live[0]
        self.facts["symbol"] = quote["symbol"]
        self.facts["real quote"] = f"{quote['price']} as of {quote.get('quoteAsOf')}"
        return quote

    def notifications(self) -> list:
        status, body = self.api("GET", self.account("notification-history?limit=50"))
        if status != 200 or not isinstance(body, list):
            raise StepFailed(f"notification history answered {status}")
        return body

    def order(self, quote: dict) -> dict:
        started = datetime.now(timezone.utc)
        price = limit_price(quote)
        status, body = self.api("POST", "/api/v1/orders", {
            "accountId": self.account_id, "symbol": quote["symbol"], "side": "BUY", "quantity": 1,
            "price": float(price), "idempotencyKey": "e2e-" + uuid.uuid4().hex[:16]})
        accepted = status in (200, 201, 202) and isinstance(body, dict)
        self.record("Place a real BUY order", accepted,
                    f"{quote['symbol']} x1 at {price} -> HTTP {status}" + ("" if accepted else f" {body}"))
        self.facts["order id"] = str(body.get("orderId"))

        def trade_notification():
            for entry in self.notifications():
                if entry["kind"] in TRADE_KINDS and datetime.fromisoformat(entry["createdAt"]) >= started:
                    return entry
            return None

        found = self.wait_for(trade_notification, self.args.timeout)
        self.record("The ledger shows the trade outcome", found is not None,
                    f"{found['kind']} / {found['status']} / {found['channel']}" if found else
                    f"nothing within {self.args.timeout}s; is the executor running and the market open?")
        wanted = ("ORDER_FILLED",) if not self.args.accept_rejected else TRADE_KINDS
        self.record("The order was filled", found["kind"] in wanted, found["kind"])
        return found

    def settle(self, label: str, first: dict, kind: str) -> dict:
        def sent():
            for entry in self.notifications():
                if entry["id"] == first["id"] and entry["status"] in ("SENT", "FAILED"):
                    return entry
            return None

        final = self.wait_for(sent, 45)
        status = final["status"] if final else "still " + first["status"]
        self.record(f"{label} was delivered on the channel", bool(final) and final["status"] == "SENT",
                    f"{kind} {status}")
        return final

    def alert(self, quote: dict) -> dict:
        price = Decimal(str(quote["price"]))
        threshold = reached_threshold(price) if self.args.real_quote else crossing_threshold(price)
        status, created = self.api("POST", self.account("alerts"),
                                   {"symbol": quote["symbol"], "threshold": float(threshold), "direction": "ABOVE"})
        self.record("Create a price alert", status == 201 and created.get("state") == "ARMED",
                    f"ABOVE {threshold} on {quote['symbol']} -> HTTP {status}")
        alert_id = created["id"]
        self.facts["alert id"] = alert_id
        started = datetime.now(timezone.utc)

        if self.args.real_quote:
            print(f"        waiting up to {self.args.timeout}s for the market poller's own next quote", flush=True)
        else:
            line = quote["symbol"] + "|" + json.dumps(quote_envelope(quote, threshold))
            code, _, err = self.kafka("kafka.tools.ConsoleProducer", "--bootstrap-server", self.args.bootstrap,
                                      "--topic", "market-data", "--property", "parse.key=true",
                                      "--property", "key.separator=|", stdin=line + "\n")
            self.record("Publish a crossing quote to market-data", code == 0,
                        f"{quote['symbol']} at {threshold}" if code == 0 else err.strip()[-200:])

        def fired():
            status, listing = self.api("GET", self.account("alerts"))
            for entry in listing if status == 200 else []:
                if entry["id"] == alert_id and entry["state"] == "FIRED" and entry.get("deliveryState"):
                    return entry
            return None

        entry = self.wait_for(fired, self.args.timeout)
        self.record("The alert fired and was handed to Notifications", entry is not None,
                    f"{entry['state']} at {entry['firedPrice']}, delivery {entry['deliveryState']}" if entry else
                    "still ARMED: is the watchlist-service consumer running?")
        self.record("The hand-over was accepted", entry["deliveryState"] == "QUEUED", entry["deliveryState"])

        def ledger_row():
            for item in self.notifications():
                if item["kind"] == "PRICE_ALERT" and datetime.fromisoformat(item["createdAt"]) >= started:
                    return item
            return None

        row = self.wait_for(ledger_row, 30)
        self.record("The ledger shows the PRICE_ALERT row", row is not None,
                    f"{row['status']} / {row['channel']}" if row else "no PRICE_ALERT row appeared")
        return row

    def verify(self, trade: dict, alert: dict) -> None:
        wanted = self.args.channel
        self.record("Both notifications used the stored channel", trade["channel"] == wanted == alert["channel"],
                    f"stored {wanted}, trade {trade['channel']}, alert {alert['channel']}")
        self.record("No response carries an address", not leaked_address(self.notifications()))

    def cleanup(self) -> None:
        alert_id = self.facts.get("alert id")
        if self.args.cleanup and alert_id:
            status, _ = self.api("DELETE", self.account(f"alerts/{alert_id}"))
            self.record("Delete the alert", status in (200, 204), f"HTTP {status}")

    def write_report(self, failed: str | None) -> Path:
        out = REPO_ROOT / "logs" / "local" / "e2e-report.md"
        out.parent.mkdir(parents=True, exist_ok=True)
        lines = [
            "# Live end-to-end run",
            "",
            f"- Run at: {datetime.now().astimezone().isoformat(timespec='seconds')}",
            f"- Account: {self.account_id or 'not signed in'}",
            f"- Channel: {self.args.channel}",
            "- Crossing quote: " + ("the market poller's own" if self.args.real_quote
                                    else "one message published to market-data"),
            f"- Result: {'FAILED at ' + failed if failed else 'every step passed'}",
            "",
            "| Step | Result | Detail |",
            "|---|---|---|",
        ]
        lines += [f"| {name} | {'pass' if ok else 'FAIL'} | {detail} |" for name, ok, detail in self.steps]
        lines += ["", "| Fact | Value |", "|---|---|"]
        lines += [f"| {key} | {value} |" for key, value in self.facts.items()]
        out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return out

    def execute(self) -> int:
        failed = None
        try:
            print("Preflight")
            self.preflight()
            print("Preference")
            self.preference()
            print("Trade notification")
            quote = self.pick_quote()
            trade = self.order(quote)
            trade = self.settle("The trade notification", trade, "ORDER") or trade
            print("Price alert")
            alert = self.alert(quote)
            alert = self.settle("The alert notification", alert, "PRICE_ALERT") or alert
            print("Checks")
            self.verify(trade, alert)
            self.cleanup()
        except StepFailed as error:
            failed = str(error)
            if not self.steps or self.steps[-1][1]:
                self.steps.append((failed, False, ""))
                print(f"  [FAIL] {failed}")
        report = self.write_report(failed)
        print()
        print("Every step passed." if failed is None else f"Stopped: {failed}")
        print(f"Report: {report}")
        return 0 if failed is None else 1


def parse(argv=None):
    on_windows = os.name == "nt"
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default="http://localhost:8081")
    p.add_argument("--auth", default="http://localhost:3000")
    p.add_argument("--token-file", default=str(REPO_ROOT / "logs" / "local" / "token.txt"))
    p.add_argument("--username", help="sign in through the auth service instead of reading the token file")
    p.add_argument("--password", default=os.environ.get("E2E_PASSWORD", ""))
    p.add_argument("--bootstrap", default="localhost:9092")
    p.add_argument("--kafka-home", default="C:\\kafka" if on_windows else "/opt/kafka")
    p.add_argument("--channel", choices=["PUSH", "EMAIL"], default="PUSH")
    p.add_argument("--symbol", help="trade and alert on this symbol (default: the first live quote)")
    p.add_argument("--real-quote", action="store_true", help="wait for the market poller's quote; publish nothing")
    p.add_argument("--accept-rejected", action="store_true", help="count a rejection notification as the trade outcome")
    p.add_argument("--timeout", type=int, default=150, help="seconds to wait for each asynchronous step")
    p.add_argument("--cleanup", action="store_true", help="delete the alert at the end")
    return p.parse_args(argv)


if __name__ == "__main__":
    sys.exit(Run(parse()).execute())
