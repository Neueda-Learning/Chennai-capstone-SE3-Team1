jest.mock('trustme-secrets', () => ({ __esModule: true, default: {} }));

import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { envNameFor, findUp, loadDotEnv } from './secrets';

describe('secrets', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('maps every vault secret to a conventional environment-variable name', () => {
    expect(envNameFor('PostGres')).toBe('POSTGRES_PASSWORD');
    expect(envNameFor('Fauxnance_Endpoint')).toBe('FAUXNANCE_BASE_URL');
    expect(envNameFor('Something_New')).toBe('SOMETHING_NEW');
  });

  it('finds the nearest file by walking up', () => {
    const root = mkdtempSync(join(tmpdir(), 'secrets-'));
    const nested = join(root, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, '.env'), 'X=1\n');

    expect(findUp('.env', nested)).toBe(join(root, '.env'));
  });

  it('loads .env into process.env without overriding a variable that is already set', () => {
    const root = mkdtempSync(join(tmpdir(), 'secrets-'));
    writeFileSync(join(root, '.env'), '# comment\nSECRETS_SPEC_A=from-file\nSECRETS_SPEC_B="quoted value"\n');
    process.env.SECRETS_SPEC_A = 'from-env';

    expect(loadDotEnv(root)).toBe(join(root, '.env'));
    expect(process.env.SECRETS_SPEC_A).toBe('from-env');
    expect(process.env.SECRETS_SPEC_B).toBe('quoted value');
  });
});
