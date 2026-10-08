// "npm start": writes public/config.json, then runs "ng serve" on the host and port the config gives
// the frontend (FRONTEND_HOST / FRONTEND_PORT in Application/Config/services.env). Extra arguments
// go to ng serve, so "npm start -- --open" works.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { generate } from './generate-config.mjs';
import { loadServiceConfig, serviceHost, servicePort } from './service-config.mjs';

const values = loadServiceConfig();
const config = generate(undefined, values);
console.log(`config.json: auth ${config.authApiUrl}, trade ${config.tradeApiUrl}`);

const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');
const args = [ng, 'serve', '--host', serviceHost(values, 'FRONTEND'), '--port', String(servicePort(values, 'FRONTEND')), ...process.argv.slice(2)];
const child = spawn(process.execPath, args, { stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
