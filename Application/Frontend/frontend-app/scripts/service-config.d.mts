export type ServiceValues = Record<string, string>;

export const CONFIG_FILE: string;
export const DOTENV_FILE: string;

export function loadServiceConfig(options?: {
  env?: Record<string, string | undefined>;
  configFile?: string;
  dotenvFile?: string;
}): ServiceValues;
export function setting(values: ServiceValues, name: string): string;
export function serviceHost(values: ServiceValues, service: string): string;
export function servicePort(values: ServiceValues, service: string): number;
export function serviceUrl(values: ServiceValues, service: string, scheme?: string): string;
export function buildRuntimeConfig(values: ServiceValues): {
  authApiUrl: string;
  tradeApiUrl: string;
  frontendUrl: string;
};
