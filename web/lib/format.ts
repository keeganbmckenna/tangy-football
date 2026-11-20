/**
 * Shared number formatting.
 */

/**
 * A number with its sign ("+1.2", "−0.6"), rounded before the sign is chosen so a value that
 * rounds to zero shows as plain "0.0" rather than "−0.0" or "+0.0"
 */
export function signed(v: number, digits = 1): string {
  const text = Math.abs(v).toFixed(digits);
  if (Number(text) === 0) return (0).toFixed(digits);
  return `${v > 0 ? '+' : '−'}${text}`;
}

/** Changes in percentage points smaller than this are within the odds simulation's precision: shown grey, not colored */
export const PP_NOISE = 0.5;

/** A change in percentage points: one decimal under 10 ("+0.4", "−2.2", "0.0"), whole points from 10 ("+12") */
export const ppChange = (d: number) => signed(d, Math.abs(d) < 9.95 ? 1 : 0);

/** Color for a change in percentage points: grey within the noise, else green for good and red for bad */
export const ppTone = (d: number, bad = false) =>
  Math.abs(d) < PP_NOISE ? 'var(--muted)' : (bad ? d < 0 : d > 0) ? 'var(--success-text)' : 'var(--danger-text)';

/** Rounded the way it's shown, for coloring or comparing by the number people see */
export const asShown = (v: number, digits = 1) => Number(v.toFixed(digits));

/**
 * The change between two probabilities in whole percentage points, as the difference of the two
 * rounded numbers people see (so "70% → 70%" is never "+1")
 */
export const pointsChange = (from: number, to: number) => Math.round(to * 100) - Math.round(from * 100);

/**
 * A chance as a whole percent: "100%" or "0%" only when certain, otherwise never rounded up to
 * either (">99%", "<1%"), so an undecided game never reads as decided
 */
export function percent(p: number, sign = '%'): string {
  if (p >= 1) return `100${sign}`;
  if (p <= 0) return `0${sign}`;
  if (p > 0.995) return `>99${sign}`;
  if (p < 0.005) return `<1${sign}`;
  return `${Math.round(p * 100)}${sign}`;
}
