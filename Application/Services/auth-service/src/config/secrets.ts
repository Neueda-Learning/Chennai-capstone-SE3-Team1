import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { parseEnv } from 'util';
import trustme, { TrustMeClient } from 'trustme-secrets';

const KEY_FILE_NAME = 'leapcapstoneteam1-720d03.TM';
const SEARCH_DEPTH = 5;

/** Vault secret name to the environment variable that stands in for it. */
export const ENV_NAMES: Readonly<Record<string, string>> = {
  JWT_SECRET: 'JWT_SECRET',
  PostGres_Host: 'POSTGRES_HOST',
  Postgres_Port: 'POSTGRES_PORT',
  Postgres_DB: 'POSTGRES_DB',
  PostGres_User: 'POSTGRES_USER',
  PostGres: 'POSTGRES_PASSWORD',
  Fauxnance: 'FAUXNANCE_API_KEY',
  Fauxnance_Endpoint: 'FAUXNANCE_BASE_URL',
  AUTH_PRIVATE_KEY: 'AUTH_PRIVATE_KEY',
};

export function envNameFor(secret: string): string {
  return ENV_NAMES[secret] ?? secret.toUpperCase();
}

function argOption(name: string): string | undefined {
  const flag = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(flag));
  return arg?.slice(flag.length);
}

function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

/** The nearest file called `name`, walking up from `start`. */
export function findUp(name: string, start = process.cwd()): string | null {
  let dir = resolve(start);
  for (let i = 0; i <= SEARCH_DEPTH; i++) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/**
 * Copies the nearest `.env` into `process.env`. A variable that is already set wins, so a real
 * environment variable always overrides the file.
 */
export function loadDotEnv(start = process.cwd()): string | null {
  const file = findUp('.env', start);
  if (file === null) {
    return null;
  }
  const values = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return file;
}

function readPassword(): string | undefined {
  const inline = nonBlank(argOption('trustme-password')) ?? nonBlank(process.env.TRUSTME_PASSWORD);
  if (inline !== undefined) {
    return inline;
  }
  const file = nonBlank(argOption('trustme-password-file')) ?? nonBlank(process.env.TRUSTME_PASSWORD_FILE);
  return file === undefined ? undefined : readFileSync(file.trim(), 'utf8').trim();
}

/**
 * Opens the TrustMe vault without ever prompting, or returns null. It opens with a supplied
 * password (`--trustme-password`, `--trustme-password-file`, `TRUSTME_PASSWORD` or
 * `TRUSTME_PASSWORD_FILE`), or with a key this machine already remembers. With neither, the library
 * would ask on the terminal, so it is pointed at a password file that does not exist and fails at
 * once instead.
 */
export async function openVault(): Promise<TrustMeClient | null> {
  const keyFile =
    nonBlank(argOption('trustme-key-file')) ?? nonBlank(process.env.TRUSTME_KEY_FILE) ?? findUp(KEY_FILE_NAME);
  if (!keyFile || !existsSync(keyFile)) {
    return null;
  }
  try {
    const password = readPassword();
    if (password !== undefined) {
      return await trustme.using(keyFile, password);
    }
    const noPrompt = `--trustme-password-file=${join(dirname(resolve(keyFile)), '.no-trustme-password')}`;
    process.argv.push(noPrompt);
    try {
      return await trustme.using(keyFile);
    } finally {
      process.argv.splice(process.argv.indexOf(noPrompt), 1);
    }
  } catch {
    return null;
  }
}

/** A secret from the vault, else from its environment variable (or `.env`), else ''. */
export async function readSecret(vault: TrustMeClient | null, name: string): Promise<string> {
  if (vault !== null) {
    try {
      const value = await vault.fetch(name);
      if (typeof value === 'string' && value !== '') {
        return value;
      }
    } catch {
      // fall back to the environment below
    }
  }
  return process.env[envNameFor(name)] ?? '';
}
