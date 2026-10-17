/**
 * Shared constants used across the application
 */

/**
 * Color palette for team visualizations
 * Used consistently across all charts and graphs
 */
export const TEAM_COLORS = [
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#10b981', // Green
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#f97316', // Orange
  '#6366f1', // Indigo
  '#84cc16', // Lime
  '#06b6d4', // Cyan
  '#a855f7', // Purple
] as const;

/**
 * Gradient header styles for different section types
 */
export const GRADIENT_STYLES = {
  primary: 'from-blue-600 to-blue-800',
  secondary: 'from-purple-600 to-purple-800',
  accent: 'from-indigo-600 to-indigo-800',
  success: 'from-teal-600 to-teal-800',
  warning: 'from-orange-600 to-orange-800',
  info: 'from-cyan-600 to-cyan-800',
} as const;

/**
 * Chart configuration defaults
 */
export const CHART_CONFIG = {
  defaultHeight: 500,
  strokeWidth: {
    default: 2,
    hovered: 4,
    median: 3,
    medianHovered: 5,
  },
  dotRadius: {
    default: 3,
    hovered: 5,
    active: 5,
    medianActive: 6,
  },
  opacity: {
    default: 1,
    dimmed: 0.2,
    median: 0.4,
  },
} as const;

export const CHART_THEME = {
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  tick: 'var(--chart-tick)',
  legend: 'var(--chart-legend)',
  tooltipBg: 'var(--chart-tooltip-bg)',
  tooltipBorder: 'var(--chart-tooltip-border)',
  tooltipText: 'var(--chart-tooltip-text)',
  tooltipMuted: 'var(--chart-tooltip-muted)',
  median: 'var(--chart-median)',
  /** Hover highlight behind a bar chart's category */
  cursor: 'var(--chart-cursor)',
} as const;

/**
 * Viridis palette for continuous ranking heatmaps.
 */
export const VIRIDIS_HEATMAP_COLORS = [
  '#440154',
  '#472d7b',
  '#3b528b',
  '#2c728e',
  '#21918c',
  '#27ad81',
  '#5ec962',
  '#aadc32',
  '#fde725',
] as const;

const RANK_TEXT_LIGHT = '#f8fafc';
const RANK_TEXT_DARK = '#0f172a';

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '');
  const intValue = Number.parseInt(normalized, 16);

  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  };
};

const interpolateRgb = (start: { r: number; g: number; b: number }, end: { r: number; g: number; b: number }, t: number) => ({
  r: Math.round(start.r + (end.r - start.r) * t),
  g: Math.round(start.g + (end.g - start.g) * t),
  b: Math.round(start.b + (end.b - start.b) * t),
});

const getRelativeLuminance = ({ r, g, b }: { r: number; g: number; b: number }) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const getViridisColor = (ratio: number) => {
  const clampedRatio = clamp(ratio);
  const scaledIndex = clampedRatio * (VIRIDIS_HEATMAP_COLORS.length - 1);
  const startIndex = Math.floor(scaledIndex);
  const endIndex = Math.min(startIndex + 1, VIRIDIS_HEATMAP_COLORS.length - 1);
  const t = scaledIndex - startIndex;

  const startRgb = hexToRgb(VIRIDIS_HEATMAP_COLORS[startIndex]);
  const endRgb = hexToRgb(VIRIDIS_HEATMAP_COLORS[endIndex]);
  const rgb = interpolateRgb(startRgb, endRgb, t);
  const luminance = getRelativeLuminance(rgb);

  return {
    backgroundColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    textColor: luminance > 0.6 ? RANK_TEXT_DARK : RANK_TEXT_LIGHT,
  };
};

/**
 * Color utility to get ranking-based colors for heatmaps.
 */
export const getRankingColor = (ranking: number, totalTeams: number) => {
  const safeTeams = Math.max(totalTeams, 1);
  const ratio = safeTeams === 1 ? 0 : (ranking - 1) / (safeTeams - 1);

  return getViridisColor(1 - ratio);
};

/**
 * Color utility to get heatmap colors by ratio.
 */
export const getHeatmapColorByRatio = (ratio: number) => getViridisColor(ratio);

/** Dot colors for a real matchup result (or, live, who's currently ahead) */
export const RESULT_DOT_COLORS: Record<'W' | 'L' | 'T', string> = {
  W: '#22c55e',
  L: '#ef4444',
  T: '#94a3b8',
};
