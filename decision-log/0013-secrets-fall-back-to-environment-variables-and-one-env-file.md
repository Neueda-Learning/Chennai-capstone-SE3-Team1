# 0013 Secrets come from the vault first, then environment variables, then one .env

| Field | Value |
|---|---|
| Status | accepted |
| Date | 2026-10-07 |
| Decided by | requested by the team |

## Context

Every secret (database connection, `JWT_SECRET`, the Fauxnance key and endpoint, `AUTH_PRIVATE_KEY`) was read only from the TrustMe vault. Without the key file and its password nothing started, and each client library asks for the password on the console when none is passed, so a service started by a script or an IDE could sit waiting for input. The repository also had two environment examples (the root `.env.example` and the frontend's `.env.test.example`) and `Application/Infrastructure/Kafka/up.sh` wrote a third `.env` next to the Kafka compose file.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep the vault as the only source | One place a value can live | No way to run the stack, the scripts or the DB tests without the vault password; a missing password can hang a process |
| Environment variables first, vault second | Familiar twelve-factor order | A stray variable silently overrides the team's shared value, the failure the vault-only rule was protecting against |
| **Vault first, then an environment variable, then the root `.env`** | The vault still wins wherever it is available; everything also runs without it | Two places a value can come from; a stale `.env` can be used without anyone noticing that the vault was not |

## Decision

1. Every secret has a fallback variable with a conventional name (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `FAUXNANCE_API_KEY`, `FAUXNANCE_BASE_URL`, `AUTH_PRIVATE_KEY`). The same table lives in `VaultEnvironmentPostProcessor` (Trade API, executor), `src/config/secrets.ts` (auth service), `server.js` (auth stub) and `scripts/vault_env.py` (Python scripts and ETL).
2. The vault is opened only when its key file exists and a password is supplied (or, for Java and Node, the machine remembers the key). No client ever prompts; when the vault is unavailable, or does not hold a secret, the fallback is used for that secret.
3. There is one environment file: `.env` at the repository root, copied from the tracked `.env.example`. `.env` and every other `.env.*` are git-ignored. A real environment variable always wins over `.env`. The Spring test profile (`trustme.enabled=false`) reads neither the vault nor `.env`.
4. `trustme-spring` is replaced by the core `trustme` library plus `VaultEnvironmentPostProcessor`, because its property source threw instead of letting a placeholder fall back.
5. `run-local.ps1` picks one source for the whole stack (`-NoVault`, or Enter at the password prompt, means `.env`) so the auth service and the API never sign and verify with different `JWT_SECRET` values.

## Consequences

The stack, the scripts and the database tests run on a machine with only `.env`. A value in `.env` that differs from the vault is used without warning wherever the vault cannot be opened, so a rotated vault secret must also be rotated in any `.env` that is still used. Adding a secret means adding it to TrustMe and a fallback line to `.env.example`. `.env.example` must never hold a real credential.
