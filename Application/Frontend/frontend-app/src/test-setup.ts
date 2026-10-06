beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does no layout, so it has no getBBox; ApexCharts asks for it when it draws a labelled annotation.
if (typeof SVGElement !== 'undefined' && !('getBBox' in SVGElement.prototype)) {
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
}
