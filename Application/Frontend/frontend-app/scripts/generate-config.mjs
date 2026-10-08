// Writes public/config.json, which the app fetches at start-up to learn where the auth service and
// the Trade API are. The values come from Application/Config/services.env (see service-config.mjs).
// Runs before "npm start" and "npm run build"; run it by hand with "npm run config".
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRuntimeConfig, loadServiceConfig } from './service-config.mjs';

export const OUTPUT_FILE = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public', 'config.json');

export function generate(outputFile = OUTPUT_FILE, values = loadServiceConfig()) {
  const config = buildRuntimeConfig(values);
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, JSON.stringify(config, null, 2) + '\n');
  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = generate();
  console.log(`config.json: auth ${config.authApiUrl}, trade ${config.tradeApiUrl}, ui ${config.frontendUrl}`);
}
