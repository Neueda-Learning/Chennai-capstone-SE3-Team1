// Where the services live: Application/Config/services.env (see Application/Config/README.md).
//
// The browser cannot read that file, so the scripts here read it and write public/config.json
// (generate-config.mjs); the app loads that at start-up. The same reader serves the dev-server
// starter (start.mjs) and Playwright, so no host, port or URL is written anywhere in this project.
//
// A value is, in order: a real environment variable, the repo-root .env, Application/Config/services.env.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const APPLICATION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const CONFIG_FILE = join(APPLICATION_DIR, 'Config', 'services.env');
export const DOTENV_FILE = join(APPLICATION_DIR, '..', '.env');

function read(file) {
  return file && existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
}

/** All keys of services.env, each overridden by .env and then by the real environment. */
export function loadServiceConfig({
  env = process.env,
  configFile = env.SERVICES_CONFIG_FILE || CONFIG_FILE,
  dotenvFile = DOTENV_FILE,
} = {}) {
  const values = { ...read(configFile), ...read(dotenvFile) };
  for (const key of Object.keys(values)) {
    if (env[key]) {
      values[key] = env[key];
    }
  }
  return values;
}

export function setting(values, name) {
  const value = values[name];
  if (!value) {
    throw new Error(`${name} is not set. It belongs in Application/Config/services.env (or the environment / .env as an override).`);
  }
  return value;
}

export const serviceHost = (values, service) => setting(values, `${service}_HOST`);
export const servicePort = (values, service) => Number(setting(values, `${service}_PORT`));
export const serviceUrl = (values, service, scheme = 'http') =>
  `${scheme}://${serviceHost(values, service)}:${servicePort(values, service)}`;

/** What the running app needs to know; written to public/config.json. */
export function buildRuntimeConfig(values) {
  return {
    authApiUrl: serviceUrl(values, 'AUTH_SERVICE'),
    tradeApiUrl: serviceUrl(values, 'TRADE_API'),
    frontendUrl: serviceUrl(values, 'FRONTEND'),
  };
}
