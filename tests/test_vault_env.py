from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import vault_env  # noqa: E402


@pytest.fixture
def no_vault(monkeypatch, tmp_path):
    """No vault, no real environment values and an empty .env, so each test sets only what it needs."""
    monkeypatch.setattr(vault_env, "_vault", None)
    monkeypatch.setattr(vault_env, "_dotenv", {})
    for name in vault_env.ENV_NAMES.values():
        monkeypatch.delenv(name, raising=False)


class FakeVault:
    def __init__(self, values):
        self.values = values

    def fetch(self, name):
        if name not in self.values:
            raise KeyError(name)
        return self.values[name]


def test_every_vault_secret_has_a_conventional_variable_name():
    assert vault_env.env_name_for("PostGres") == "POSTGRES_PASSWORD"
    assert vault_env.env_name_for("Fauxnance_Endpoint") == "FAUXNANCE_BASE_URL"
    assert vault_env.env_name_for("Something_New") == "SOMETHING_NEW"


def test_without_a_vault_a_secret_comes_from_the_environment(no_vault, monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST", "db.env.test")

    assert vault_env.secret("PostGres_Host") == "db.env.test"


def test_without_the_environment_it_comes_from_dotenv(no_vault, monkeypatch):
    monkeypatch.setattr(vault_env, "_dotenv", {"POSTGRES_PORT": "5433"})

    assert vault_env.secret("Postgres_Port") == "5433"


def test_the_vault_wins_and_a_missing_secret_falls_back(no_vault, monkeypatch):
    monkeypatch.setattr(vault_env, "_vault", FakeVault({"PostGres_User": "vault_user"}))
    monkeypatch.setenv("POSTGRES_USER", "env_user")
    monkeypatch.setenv("POSTGRES_DB", "env_db")

    assert vault_env.secret("PostGres_User") == "vault_user"
    assert vault_env.secret("Postgres_DB") == "env_db"


def test_a_secret_nowhere_returns_the_default(no_vault):
    assert vault_env.secret("PostGres", "fallback") == "fallback"
    assert vault_env.secret("PostGres") is None


def test_dotenv_parsing():
    values = vault_env.parse_dotenv(
        "# comment\n\nA=1\nexport B=2\nC=\"with spaces\"\nD='single'\nE=\"x\\ny\"\nNOEQUALS\n"
    )

    assert values == {"A": "1", "B": "2", "C": "with spaces", "D": "single", "E": "x\ny"}


def test_no_password_means_no_vault_and_no_prompt(monkeypatch):
    monkeypatch.setattr(vault_env, "_vault", vault_env._UNSET)
    monkeypatch.delenv("TRUSTME_PASSWORD", raising=False)
    monkeypatch.delenv("TRUSTME_PASSWORD_FILE", raising=False)
    monkeypatch.setattr(sys, "_xoptions", {})

    assert vault_env.vault() is None


def test_the_database_address_falls_back_to_services_env_below_the_environment_and_dotenv(no_vault, monkeypatch):
    monkeypatch.setattr(vault_env.service_config, "_file_values",
                        {"POSTGRES_HOST": "db.config.test", "POSTGRES_PORT": "6543", "FAUXNANCE_BASE_URL": "https://api.config.test"})

    assert vault_env.secret("PostGres_Host") == "db.config.test"
    assert vault_env.secret("Postgres_Port") == "6543"
    assert vault_env.secret("Fauxnance_Endpoint") == "https://api.config.test"

    monkeypatch.setattr(vault_env, "_dotenv", {"POSTGRES_HOST": "db.dotenv.test"})
    assert vault_env.secret("PostGres_Host") == "db.dotenv.test"

    monkeypatch.setenv("POSTGRES_HOST", "db.env.test")
    assert vault_env.secret("PostGres_Host") == "db.env.test"
