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
