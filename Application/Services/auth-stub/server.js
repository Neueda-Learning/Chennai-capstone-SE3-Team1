const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const util = require('util');
const trustme = require('trustme-secrets');

const app = express();
app.use(express.json());

let SECRET;

const USERS = {
  alice: { password: 'mission123', roles: ['MISSION_OPERATOR'] },
  bob: { password: 'wrongpermissions', roles: ['GUEST'] },
};

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS[username];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'invalid username or password' });
  }
  const token = jwt.sign(
    { sub: username, roles: user.roles },
    SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  res.json({ token });
});

app.get('/health', (req, res) => res.json({ status: 'up' }));

// Where this stub listens comes from AUTH_STUB_HOST / AUTH_STUB_PORT in Application/Config/services.env.
let HOST;
let PORT;

function findUp(name) {
  let dir = process.cwd();
  for (let i = 0; i <= 5; i++) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Application/Config/services.env (SERVICES_CONFIG_FILE points elsewhere, e.g. in Docker).
function servicesConfig() {
  const override = (process.env.SERVICES_CONFIG_FILE || '').trim();
  const file = override
    ? (fs.existsSync(override) ? override : null)
    : findUp(path.join('Application', 'Config', 'services.env')) || findUp(path.join('Config', 'services.env'));
  return file ? util.parseEnv(fs.readFileSync(file, 'utf8')) : {};
}

// A host/port/URL setting: the environment (where .env lands), else services.env. No default here.
function setting(name, fileValues) {
  const value = process.env[name] || fileValues[name];
  if (!value) {
    throw new Error(`${name} is not set. It belongs in Application/Config/services.env (or the environment / .env as an override).`);
  }
  return value;
}

// The repository's .env, without overriding a variable that is already set.
function loadDotEnv() {
  const file = findUp('.env');
  if (!file) return;
  for (const [key, value] of Object.entries(util.parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function argOption(name) {
  const flag = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(flag));
  return arg && arg.slice(flag.length);
}

// The vault first, never prompting: it opens with a supplied password, or with a key this machine
// remembers; otherwise it is pointed at a password file that does not exist and fails at once.
async function vaultSecret(name) {
  const keyFile = argOption('trustme-key-file') || process.env.TRUSTME_KEY_FILE || findUp('leapcapstoneteam1-720d03.TM');
  if (!keyFile || !fs.existsSync(keyFile)) return undefined;
  const password = argOption('trustme-password') || process.env.TRUSTME_PASSWORD;
  const noPrompt = `--trustme-password-file=${path.join(path.dirname(path.resolve(keyFile)), '.no-trustme-password')}`;
  try {
    if (password) return await (await trustme.using(keyFile, password)).fetch(name);
    process.argv.push(noPrompt);
    return await (await trustme.using(keyFile)).fetch(name);
  } catch {
    return undefined;
  } finally {
    const i = process.argv.indexOf(noPrompt);
    if (i !== -1) process.argv.splice(i, 1);
  }
}

async function main() {
  loadDotEnv();
  const fileValues = servicesConfig();
  HOST = setting('AUTH_STUB_HOST', fileValues);
  PORT = Number(setting('AUTH_STUB_PORT', fileValues));
  SECRET = (await vaultSecret('JWT_SECRET')) || process.env.JWT_SECRET;
  if (!SECRET || SECRET.length < 32) {
    throw new Error('JWT_SECRET is missing or shorter than 32 characters (TrustMe vault, environment or .env)');
  }
  app.listen(PORT, () => {
    console.log(`trading-auth-stub listening on http://${HOST}:${PORT}`);
    console.log(`Try: curl -X POST http://${HOST}:${PORT}/login -H "Content-Type: application/json" -d '{"username":"alice","password":"mission123"}'`);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
