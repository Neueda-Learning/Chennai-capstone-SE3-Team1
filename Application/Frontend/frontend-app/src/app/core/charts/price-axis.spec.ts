import {
  PlotGeometry,
  inferDirection,
  insidePlot,
  isFiniteGeometry,
  offsetOfPrice,
  percentFrom,
  priceAtOffset,
  roundPrice
} from './price-axis';

// A 300px-tall plot starting 10px below the top, spanning 100 to 200 on the price axis.
const G: PlotGeometry = { translateX: 60, translateY: 10, gridWidth: 500, gridHeight: 300, min: 100, max: 200 };

describe('priceAtOffset', () => {
  it('maps the top of the plot to the maximum and the bottom to the minimum', () => {
    expect(priceAtOffset(G, 10)).toBe(200);
    expect(priceAtOffset(G, 310)).toBe(100);
  });

  it('maps the middle to the middle, and rounds to the paisa', () => {
    expect(priceAtOffset(G, 160)).toBe(150);
    expect(priceAtOffset(G, 11)).toBe(199.67);
  });

  it('is null above or below the plotting area, so a click on the axis or title places nothing', () => {
    expect(priceAtOffset(G, 9)).toBeNull();
    expect(priceAtOffset(G, 311)).toBeNull();
  });
});

describe('offsetOfPrice', () => {
  it('is the inverse of priceAtOffset', () => {
    for (const price of [100, 125.5, 150, 199.99, 200]) {
      expect(priceAtOffset(G, offsetOfPrice(G, price))).toBeCloseTo(price, 1);
    }
  });

  it('puts a price beyond the axis outside the plot', () => {
    expect(offsetOfPrice(G, 250)).toBeLessThan(G.translateY);
    expect(offsetOfPrice(G, 50)).toBeGreaterThan(G.translateY + G.gridHeight);
  });
});

describe('insidePlot', () => {
  it('is true within the plotting area and false outside it, on either axis', () => {
    expect(insidePlot(G, 100, 100)).toBe(true);
    expect(insidePlot(G, 59, 100)).toBe(false);
    expect(insidePlot(G, 561, 100)).toBe(false);
    expect(insidePlot(G, 100, 9)).toBe(false);
    expect(insidePlot(G, 100, 311)).toBe(false);
  });
});

describe('isFiniteGeometry', () => {
  it('accepts a usable plot and rejects missing, empty or degenerate ones', () => {
    expect(isFiniteGeometry(G)).toBe(true);
    expect(isFiniteGeometry(null)).toBe(false);
    expect(isFiniteGeometry(undefined)).toBe(false);
    expect(isFiniteGeometry({ ...G, gridHeight: 0 })).toBe(false);
    expect(isFiniteGeometry({ ...G, min: 100, max: 100 })).toBe(false);
    expect(isFiniteGeometry({ ...G, min: Number.NaN })).toBe(false);
    expect(isFiniteGeometry({ ...G, max: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe('inferDirection', () => {
  it('waits for a rise above the current price and a fall below it', () => {
    expect(inferDirection(110, 100)).toBe('ABOVE');
    expect(inferDirection(90, 100)).toBe('BELOW');
  });

  it('treats a level equal to the price, or an unknown price, as a rise', () => {
    expect(inferDirection(100, 100)).toBe('ABOVE');
    expect(inferDirection(100, null)).toBe('ABOVE');
  });
});

describe('percentFrom and roundPrice', () => {
  it('gives the signed distance from the current price', () => {
    expect(percentFrom(110, 100)).toBeCloseTo(10);
    expect(percentFrom(95, 100)).toBeCloseTo(-5);
    expect(percentFrom(5, null)).toBeNull();
    expect(percentFrom(5, 0)).toBeNull();
  });

  it('rounds to two decimals', () => {
    expect(roundPrice(123.456)).toBe(123.46);
    expect(roundPrice(123.451)).toBe(123.45);
  });
});
