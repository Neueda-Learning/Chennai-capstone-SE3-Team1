/**
 * The colours the ApexCharts are drawn in, for each theme.
 *
 * Charts are painted by a library that knows nothing about CSS variables, so they are given
 * concrete colours, and re-given them when the theme flips.
 */
export interface ChartPalette {
  /** Axis and label text. */
  fore: string;
  /** Grid lines. */
  grid: string;
  /** Tooltip theme name ApexCharts understands. */
  tooltip: 'light' | 'dark';
  /** The primary series (buys, the price line, the main slice). */
  primary: string;
  /** The secondary series (sells). */
  secondary: string;
  up: string;
  down: string;
  /** Slice colours, cycled for as many holdings as there are. */
  slices: string[];
  /** The strong text colour, for the donut's centre figure. */
  strong: string;
}

const LIGHT: ChartPalette = {
  fore: '#6C7E75',
  grid: '#E9EFEF',
  tooltip: 'dark',
  primary: '#072F1F',
  secondary: '#B4F105',
  up: '#22C55E',
  down: '#EF4444',
  slices: ['#B4F105', '#072F1F', '#F97316', '#3B82F6', '#A855F7', '#14B8A6', '#EAB308', '#EC4899', '#64748B'],
  strong: '#0B130F'
};

const DARK: ChartPalette = {
  fore: '#9FB3A9',
  grid: 'rgba(255, 255, 255, 0.08)',
  tooltip: 'dark',
  primary: '#B4F105',
  secondary: '#F97316',
  up: '#4ADE80',
  down: '#F87171',
  slices: ['#B4F105', '#4ADE80', '#F97316', '#60A5FA', '#C084FC', '#2DD4BF', '#FACC15', '#F472B6', '#94A3B8'],
  strong: '#F1F5F3'
};

export function chartPalette(isDark: boolean): ChartPalette {
  return isDark ? DARK : LIGHT;
}
