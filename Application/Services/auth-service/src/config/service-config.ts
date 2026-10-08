import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { parseEnv } from 'util';

/**
 * Where the services live: Application/Config/services.env (see Application/Config/README.md).
 * Nothing in this service writes a host, port or URL itself; it asks here. A value is the
 * environment variable, else the repo-root .env (main.ts loads it into process.env first), else
 * services.env.
 */

const SEARCH_DEPTH = 5;
const CONFIG_RELATIVE_PATHS = [join('Application', 'Config', 'services.env'), join('Config', 'services.env')];

/** The nearest `relative` path, walking up from `start`. */
export function findUp(relative: string, start = process.cwd()): string | null {
  let dir = resolve(start);
  for (let i = 0; i <= SEARCH_DEPTH; i++) {
    const candidate = join(dir, relative);
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

/** SERVICES_CONFIG_FILE when set (a Docker image has no repository tree), else the nearest services.env. */
export function servicesConfigFile(start = process.cwd()): string | null {
  const override = process.env.SERVICES_CONFIG_FILE?.trim();
  if (override) {
    return existsSync(override) ? override : null;
  }
  for (const relative of CONFIG_RELATIVE_PATHS) {
    const found = findUp(relative, start);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

type Values = Readonly<Record<string, string | undefined>>;
let cached: Values | null = null;

export function servicesConfig(): Values {
  if (cached === null) {
    const file = servicesConfigFile();
    cached = file === null ? {} : parseEnv(readFileSync(file, 'utf8'));
  }
  return cached;
}

/** For tests that change the environment or the file. */
export function resetServicesConfig(): void {
  cached = null;
}

export function serviceSetting(name: string): string {
  const value = process.env[name] || servicesConfig()[name];
  if (!value) {
    throw new Error(
      `${name} is not set. It belongs in Application/Config/services.env ` +
        '(or the environment / .env as an override).',
    );
  }
  return value;
}

export const serviceHost = (service: string): string => serviceSetting(`${service}_HOST`);
export const servicePort = (service: string): number => Number(serviceSetting(`${service}_PORT`));
/** host:port of a service, from its KAFKA_HOST and KAFKA_PORT style keys. */
export const serviceAddress = (service: string): string => `${serviceHost(service)}:${servicePort(service)}`;
/** scheme://host:port of a service, from its AUTH_SERVICE_HOST and AUTH_SERVICE_PORT style keys. */
export const serviceUrl = (service: string, scheme = 'http'): string => `${scheme}://${serviceAddress(service)}`;
