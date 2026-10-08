// Run with "npm run test:config" (node --test).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { generate } from './generate-config.mjs';
import { buildRuntimeConfig, CONFIG_FILE, loadServiceConfig, serviceUrl, setting } from './service-config.mjs';

function files(config, dotenv = '') {
  const dir = mkdtempSync(join(tmpdir(), 'svc-'));
  writeFileSync(join(dir, 'services.env'), config);
  writeFileSync(join(dir, '.env'), dotenv);
  return { configFile: join(dir, 'services.env'), dotenvFile: join(dir, '.env'), dir };
}

const CONFIG = [
  'FRONTEND_HOST=localhost', 'FRONTEND_PORT=4200',
  'AUTH_SERVICE_HOST=localhost', 'AUTH_SERVICE_PORT=3000',
  'TRADE_API_HOST=localhost', 'TRADE_API_PORT=8081',
].join('\n');

test('builds the three URLs the app needs from the HOST and PORT of each service', () => {
  const values = loadServiceConfig({ ...files(CONFIG), env: {} });

  assert.deepEqual(buildRuntimeConfig(values), {
    authApiUrl: 'http://localhost:3000',
    tradeApiUrl: 'http://localhost:8081',
    frontendUrl: 'http://localhost:4200',
  });
});

test('.env overrides the file, and the environment overrides both', () => {
  const f = files(CONFIG, 'TRADE_API_PORT=9001\nAUTH_SERVICE_PORT=9002\n');
  const values = loadServiceConfig({ ...f, env: { AUTH_SERVICE_PORT: '9003' } });

  assert.equal(serviceUrl(values, 'TRADE_API'), 'http://localhost:9001');
  assert.equal(serviceUrl(values, 'AUTH_SERVICE'), 'http://localhost:9003');
});

test('a missing value is an error that says where it belongs', () => {
  assert.throws(() => setting({}, 'TRADE_API_PORT'), /Application\/Config\/services\.env/);
});

test('generate() writes config.json', () => {
  const f = files(CONFIG);
  const out = join(f.dir, 'out', 'config.json');

  generate(out, loadServiceConfig({ ...f, env: {} }));

  assert.equal(JSON.parse(readFileSync(out, 'utf8')).tradeApiUrl, 'http://localhost:8081');
});

test('the real services.env has everything the app and the dev server need', () => {
  const values = loadServiceConfig({ env: {}, dotenvFile: join(tmpdir(), 'no-such.env') });

  assert.ok(CONFIG_FILE.endsWith('services.env'));
  assert.doesNotThrow(() => buildRuntimeConfig(values));
});
