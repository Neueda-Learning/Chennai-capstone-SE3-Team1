export interface ChartPalette {
  fore: string;
  grid: string;
  tooltip: 'light' | 'dark';
  primary: string;
  secondary: string;
  up: string;
  down: string;
  slices: string[];
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
