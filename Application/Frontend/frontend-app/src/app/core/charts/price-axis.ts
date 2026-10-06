import { AlertDirection } from '../services/watchlist.service';

/**
 * Where the plotting area of a chart sits, and what price range its vertical axis spans. Lets a mouse position
 * on the chart be turned into a price (to place an alert marker) and a price back into a position (to draw the
 * guide line that follows the pointer).
 */
export interface PlotGeometry {
  translateX: number;
  translateY: number;
  gridWidth: number;
  gridHeight: number;
  min: number;
  max: number;
}

export function isFiniteGeometry(g: PlotGeometry | null | undefined): g is PlotGeometry {
  return (
    g !== null &&
    g !== undefined &&
    [g.translateX, g.translateY, g.gridWidth, g.gridHeight, g.min, g.max].every(Number.isFinite) &&
    g.gridHeight > 0 &&
    g.gridWidth > 0 &&
    g.max > g.min
  );
}

/** Is this point (in pixels from the chart's top-left) inside the plotting area? */
export function insidePlot(g: PlotGeometry, offsetX: number, offsetY: number): boolean {
  return (
    offsetX >= g.translateX &&
    offsetX <= g.translateX + g.gridWidth &&
    offsetY >= g.translateY &&
    offsetY <= g.translateY + g.gridHeight
  );
}

/** The price at a vertical pixel position, rounded to the paisa; null outside the plotting area. */
export function priceAtOffset(g: PlotGeometry, offsetY: number): number | null {
  if (offsetY < g.translateY || offsetY > g.translateY + g.gridHeight) {
    return null;
  }
  const fromTop = (offsetY - g.translateY) / g.gridHeight;
  return roundPrice(g.max - fromTop * (g.max - g.min));
}

/** The vertical pixel position of a price, which can fall outside the plotting area when the price is off the axis. */
export function offsetOfPrice(g: PlotGeometry, price: number): number {
  return g.translateY + ((g.max - price) / (g.max - g.min)) * g.gridHeight;
}

export function roundPrice(price: number): number {
  return Math.round(price * 100) / 100;
}

/** A marker above today's price waits for a rise; one below it waits for a fall. */
export function inferDirection(threshold: number, current: number | null): AlertDirection {
  return current !== null && threshold < current ? 'BELOW' : 'ABOVE';
}

/** How far a price is from the current one, as a signed percentage, or null with no current price. */
export function percentFrom(price: number, current: number | null): number | null {
  return current === null || current === 0 ? null : ((price - current) / current) * 100;
}
