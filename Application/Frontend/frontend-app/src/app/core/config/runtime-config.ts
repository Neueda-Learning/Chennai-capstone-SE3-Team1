import { InjectionToken } from '@angular/core';

/**
 * Where the backend services are. The values are written once, in Application/Config/services.env;
 * `npm start` and `npm run build` turn them into public/config.json (scripts/generate-config.mjs),
 * and main.ts loads that before the app starts. Nothing in the app writes a host or port itself.
 */
export interface RuntimeConfig {
  readonly authApiUrl: string;
  readonly tradeApiUrl: string;
  readonly frontendUrl: string;
}

export const RUNTIME_CONFIG = new InjectionToken<RuntimeConfig>('RUNTIME_CONFIG');

export const RUNTIME_CONFIG_PATH = 'config.json';

const FIELDS = ['authApiUrl', 'tradeApiUrl', 'frontendUrl'] as const;

const HOW_TO_FIX = 'Run "npm run config" (npm start and npm run build do it for you).';

export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const missing = FIELDS.filter((field) => typeof record[field] !== 'string' || record[field] === '');
  if (missing.length > 0) {
    throw new Error(`${RUNTIME_CONFIG_PATH} has no ${missing.join(', ')}. ${HOW_TO_FIX}`);
  }
  const clean = (field: (typeof FIELDS)[number]): string => (record[field] as string).replace(/\/+$/, '');
  return {
    authApiUrl: clean('authApiUrl'),
    tradeApiUrl: clean('tradeApiUrl'),
    frontendUrl: clean('frontendUrl')
  };
}

export async function loadRuntimeConfig(
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
  path: string = RUNTIME_CONFIG_PATH
): Promise<RuntimeConfig> {
  let response: Response;
  try {
    response = await fetchFn(path, { cache: 'no-store' });
  } catch (cause) {
    throw new Error(`${path} could not be fetched (${cause instanceof Error ? cause.message : String(cause)}). ${HOW_TO_FIX}`);
  }
  if (!response.ok) {
    throw new Error(`${path} could not be loaded (HTTP ${response.status}). ${HOW_TO_FIX}`);
  }
  return parseRuntimeConfig(await response.json());
}
