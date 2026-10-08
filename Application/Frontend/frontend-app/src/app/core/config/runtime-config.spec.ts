import { loadRuntimeConfig, parseRuntimeConfig } from './runtime-config';

const VALID = { authApiUrl: 'http://auth.test:1111', tradeApiUrl: 'http://trade.test:2222', frontendUrl: 'http://ui.test:3333' };

function respond(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('runtime config', () => {
  it('reads the three URLs and drops a trailing slash', () => {
    expect(parseRuntimeConfig({ ...VALID, tradeApiUrl: 'http://trade.test:2222/' })).toEqual(VALID);
  });

  it('names every missing field and says how to fix it', () => {
    expect(() => parseRuntimeConfig({ authApiUrl: VALID.authApiUrl })).toThrow(/tradeApiUrl, frontendUrl.*npm run config/);
  });

  it('rejects something that is not an object', () => {
    expect(() => parseRuntimeConfig(null)).toThrow(/authApiUrl/);
    expect(() => parseRuntimeConfig('nope')).toThrow(/authApiUrl/);
  });

  it('loads config.json from the app root', async () => {
    const seen: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify(VALID));
    }) as typeof fetch;

    await expect(loadRuntimeConfig(fetchFn)).resolves.toEqual(VALID);
    expect(seen).toEqual(['config.json']);
  });

  it('explains a missing file', async () => {
    await expect(loadRuntimeConfig(respond(404, {}))).rejects.toThrow(/HTTP 404.*npm run config/);
  });

  it('explains a network failure', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    await expect(loadRuntimeConfig(failing)).rejects.toThrow(/Failed to fetch.*npm run config/);
  });
});
