import { TestBed } from '@angular/core/testing';

import { THEME_STORAGE, THEME_STORAGE_KEY, ThemeService } from './theme.service';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value)
  };
}

function stubSystemPreference(prefersDark: boolean): void {
  vi.stubGlobal('matchMedia', undefined);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: prefersDark && query.includes('dark'), media: query })
  });
}

describe('ThemeService', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-bs-theme');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function create(storage: Storage, prefersDark = false): ThemeService {
    stubSystemPreference(prefersDark);
    TestBed.configureTestingModule({ providers: [{ provide: THEME_STORAGE, useValue: storage }] });
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    return service;
  }

  it('starts light when nothing is saved and the system has no preference', () => {
    const service = create(memoryStorage());

    expect(service.theme()).toBe('light');
    expect(service.isDark()).toBe(false);
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
  });

  it('follows the system preference when nothing is saved', () => {
    const service = create(memoryStorage(), true);

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });

  it('prefers a saved choice over the system preference', () => {
    const service = create(memoryStorage({ [THEME_STORAGE_KEY]: 'light' }), true);

    expect(service.theme()).toBe('light');
  });

  it('ignores a saved value that is neither theme', () => {
    const service = create(memoryStorage({ [THEME_STORAGE_KEY]: 'sepia' }), true);

    expect(service.theme()).toBe('dark');
  });

  it('toggles, applies the change to <html> and remembers it', () => {
    const storage = memoryStorage();
    const service = create(storage);

    service.toggle();
    TestBed.tick();

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    service.toggle();
    TestBed.tick();

    expect(service.theme()).toBe('light');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('keeps working for the tab when storage is unavailable', () => {
    const broken: Storage = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    };
    const service = create(broken);

    service.set('dark');
    TestBed.tick();

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });
});
