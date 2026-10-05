/**
 * Runs before every spec. A signed-in tab session now survives a reload (it lives in
 * sessionStorage), so whatever one spec signs in must not still be there for the next: tests
 * otherwise pass or fail depending on which spec happened to run before them.
 */
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

// jsdom has no ResizeObserver, which ApexCharts uses to redraw when its container resizes. Real
// browsers all have one; without a stand-in the charts never finish rendering under test.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
