import { newUuid } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newUuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when the page is a secure context', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555', getRandomValues: () => undefined });
    expect(newUuid()).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('builds a valid v4 UUID from getRandomValues over plain HTTP, where randomUUID is missing', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { a.fill(0xab); return a; } });
    const id = newUuid();
    expect(id).toMatch(V4);
    expect(id).toBe('abababab-abab-4bab-abab-abababababab');
  });

  it('gives a different value each time', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } });
    expect(newUuid()).not.toBe(newUuid());
  });
});
