from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import service_config as cfg  # noqa: E402

# Every service the code talks to has a HOST and a PORT here; the Kafka and Docker ports are on top.
SERVICES = ["FRONTEND", "AUTH_SERVICE", "AUTH_STUB", "TRADE_API", "EXECUTOR", "POSTGRES", "KAFKA"]
EXTRA_KEYS = ["TRADE_API_CONTAINER_PORT", "POSTGRES_CONTAINER_PORT", "KAFKA_LEGACY_PORT", "KAFKA_INTERNAL_PORT", "KAFKA_CONTROLLER_PORT",
              "KAFKA_VERSION", "KAFKA_DOWNLOAD_BASE_URL", "FAUXNANCE_BASE_URL", "INSTANCE_METADATA_URL"]


@pytest.fixture
def isolated(monkeypatch, tmp_path):
    """A services.env and a .env that exist only for the test, and no service variables in the environment."""
    config_file = tmp_path / "services.env"
    dotenv_file = tmp_path / ".env"
    config_file.write_text("TRADE_API_HOST=localhost\nTRADE_API_PORT=8081\nKAFKA_HOST=kafka.example\nKAFKA_PORT=29092\n",
                           encoding="utf-8")
    monkeypatch.setattr(cfg, "DOTENV_FILE", dotenv_file)
    monkeypatch.setenv("SERVICES_CONFIG_FILE", str(config_file))
    for name in ("TRADE_API_HOST", "TRADE_API_PORT", "KAFKA_HOST", "KAFKA_PORT"):
        monkeypatch.delenv(name, raising=False)
    cfg.reset_cache()
    yield config_file, dotenv_file
    cfg.reset_cache()


def test_the_real_config_file_defines_every_service_host_and_port():
    values = cfg.parse_env((Path(cfg.__file__).resolve().parents[1] / "Application" / "Config" / "services.env")
                           .read_text(encoding="utf-8"))
    missing = [k for k in [s + "_HOST" for s in SERVICES] + [s + "_PORT" for s in SERVICES] + EXTRA_KEYS if k not in values]
    assert not missing, "Application/Config/services.env is missing " + ", ".join(missing)
    for key, text in values.items():
        if key.endswith("_PORT"):
            assert text.isdigit() and 1024 <= int(text) <= 65535, key + " is not a usable port: " + text


def test_values_come_from_the_config_file(isolated):
    assert cfg.port("TRADE_API") == 8081
    assert cfg.url("TRADE_API") == "http://localhost:8081"
    assert cfg.address("KAFKA") == "kafka.example:29092"


def test_dotenv_overrides_the_config_file(isolated):
    _, dotenv_file = isolated
    dotenv_file.write_text("KAFKA_PORT=9092\n", encoding="utf-8")
    cfg.reset_cache()

    assert cfg.address("KAFKA") == "kafka.example:9092"
    assert cfg.port("TRADE_API") == 8081


def test_the_environment_overrides_dotenv_and_the_config_file(isolated, monkeypatch):
    _, dotenv_file = isolated
    dotenv_file.write_text("KAFKA_PORT=9092\n", encoding="utf-8")
    monkeypatch.setenv("KAFKA_PORT", "39092")
    cfg.reset_cache()

    assert cfg.port("KAFKA") == 39092


def test_a_missing_key_says_where_it_belongs(isolated):
    with pytest.raises(cfg.ConfigError) as caught:
        cfg.require("NO_SUCH_SERVICE_PORT")
    assert "Application/Config/services.env" in str(caught.value)


def test_value_returns_the_default_for_an_unknown_key(isolated):
    assert cfg.value("NO_SUCH_KEY") is None
    assert cfg.value("NO_SUCH_KEY", "fallback") == "fallback"


def test_parse_env_ignores_comments_blank_lines_and_export_and_strips_quotes():
    text = "# comment\n\nA=1\nexport B=2\nC=\"two words\"\nD='single'\nNOEQUALS\n =novalue\n"

    assert cfg.parse_env(text) == {"A": "1", "B": "2", "C": "two words", "D": "single"}
