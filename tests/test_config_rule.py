from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import check_config as rule  # noqa: E402

PORTS = rule.config_ports()


def flagged(text: str, path: str = "Application/Services/x/src/app.ts") -> list:
    return rule.check_text(path, text, PORTS)


def test_the_repository_writes_no_service_port_or_url_outside_the_config():
    offences = rule.scan()

    assert not offences, "service addresses are written outside Application/Config/services.env:\n" + "\n".join(
        "  " + str(o) for o in offences)


def test_the_ports_it_looks_for_are_the_ones_services_env_defines():
    assert {"3000", "4200", "8081", "8082", "5432", "29092", "9092", "19092", "29093"} <= set(PORTS)


@pytest.mark.parametrize("line", [
    "const base = 'http://localhost:3000';",                    # a URL literal
    "export const API = 'http://127.0.0.1:8081/api';",          # loopback with a literal port
    "fetch('http://trade.example.com/api')",                    # any other host
    "broker = 'localhost:29092'",                               # host:port with a configured port
    "bootstrap: kafka:19092",                                   # a container-network address
    "server.port=8081",                                         # a port assigned to something named port
    "  port: 8082",
    "$ApiPort = 8081",
    "const PORT = 4000;",
    "EXPOSE 3000",
    '      - "5432:5432"',                                      # a docker port mapping
    "DEFAULT = 'https://y4t9nq2bqf.execute-api.eu-west-2.amazonaws.com/v1'",
    "ip=$(curl http://169.254.169.254/latest/meta-data/local-ipv4)",
])
def test_a_written_out_port_or_url_is_flagged(line):
    assert flagged(line), line


@pytest.mark.parametrize("line", [
    "const base = `http://${host}:${port}`;",                   # built from the config
    "server.port=${TRADE_API_PORT}",
    "$ApiPort = [int](Get-Svc 'TRADE_API_PORT')",
    "curl http://localhost:$PORT/health",                        # loopback with a variable port
    'Invoke-RestMethod -Uri "http://${AuthHost}:$AuthPort/health"',
    "const timeout = 3000;",                                     # a number that is not a port
    "price = randint(120, 4200)",
    "// see https://json.schemastore.org/nest-cli",               # not a service of ours
    "xmlns='http://www.w3.org/2001/XMLSchema'",
    "port: ${KAFKA_PORT}",
])
def test_reading_the_value_from_the_config_is_not_flagged(line):
    assert not flagged(line), line


def test_a_justified_literal_carries_the_marker_on_its_line_or_the_line_above():
    assert not flagged("fauxnance.base-url=http://localhost:1  # config-ok: invalid on purpose")
    assert not flagged("# config-ok: invalid on purpose\nfauxnance.base-url=http://localhost:1")
    assert flagged("# config-ok: invalid on purpose\n\nfauxnance.base-url=http://localhost:1")


@pytest.mark.parametrize("path", [
    "Application/Config/services.env",
    "Application/Contracts/api-schemas/auth-api.yaml",
    "Application/Services/auth-service/src/auth/auth.service.spec.ts",
    "Application/Services/auth-service/test/auth.e2e-spec.ts",
    "Application/Services/order-service/src/test/resources/application-test.properties",
    "Application/Services/order-service/src/test/java/com/x/FooTest.java",
    "Application/ETL/etl-live/tests/test_dashboard.py",
    "tests/test_e2e_live.py",
    "docs/curl-reference.md",
    "Application/Frontend/frontend-app/src/app/generated/auth-client/api/auth.service.ts",
    "Application/Frontend/frontend-app/package-lock.json",
])
def test_fixtures_docs_contracts_and_generated_code_are_not_scanned(path):
    assert not rule.is_scanned(path)


@pytest.mark.parametrize("path", [
    "Application/Services/order-service/src/main/resources/application.properties",
    "Application/Services/executor-service/src/main/resources/application.yml",
    "Application/Services/order-service/Dockerfile",
    "Application/Frontend/frontend-app/src/app/app.config.ts",
    "Application/Frontend/frontend-app/scripts/start.mjs",
    "scripts/e2e_live.py",
    "run-local.ps1",
    "Application/Infrastructure/Kafka/up.sh",
    "infra/postgres/docker-compose.yml",
])
def test_source_and_infrastructure_files_are_scanned(path):
    assert rule.is_scanned(path)
