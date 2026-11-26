/**
 * The two halves of a matchup card, shared by the live and past-week cards so every week looks the same
 * (as compact as Sleeper's): the avatar at the outer edge, the score toward the middle with a line under
 * it, then the names under the card's middle row. A finished game's winner keeps full strength with a
 * trophy by its name; the loser's score fades. No color carries the result on its own.
 */
import type { ReactNode } from 'react';
import TeamAvatar from '@/components/ui/TeamAvatar';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import { percent } from '@/lib/format';

export function SideScore({ name, avatarUrl, align, score, sub, faded = false }: {
  name: string;
  avatarUrl: string | null;
  align: 'left' | 'right';
  score: ReactNode;
  /** Under the score (the live projection) */
  sub?: ReactNode;
  /** The loser of a finished game */
  faded?: boolean;
}) {
  return (
    <div className={`flex min-w-0 items-center justify-between gap-2 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <TeamAvatar url={avatarUrl} name={name} size="h-9 w-9" />
      <div className={align === 'right' ? 'text-left' : 'text-right'}>
        <div className={`text-xl font-bold leading-tight tabular-nums ${faded ? 'text-[var(--muted)]' : 'text-[var(--foreground)]'}`}>{score}</div>
        {sub && <div className="text-[11px] tabular-nums text-[var(--muted)]">{sub}</div>}
      </div>
    </div>
  );
}

export function SideName({ name, username, align, won = false }: { name: string; username: string; align: 'left' | 'right'; won?: boolean }) {
  return (
    <div className={`min-w-0 flex-1 ${align === 'right' ? 'text-right' : ''}`}>
      <div className={`flex min-w-0 items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span className="truncate text-sm font-semibold leading-tight text-[var(--foreground)]" title={name}>{name}</span>
        {won && <span role="img" aria-label="Won" className="shrink-0 text-sm leading-none">🏆</span>}
      </div>
      <div className="truncate text-[11px] text-[var(--muted)]">@{username}</div>
    </div>
  );
}

/** The least of the odds bar either side gets, so a lopsided matchup still shows who's ahead */
const MIN_BAR_SHARE = 0.03;

/** Win odds, left side's chance a: the favorite's half and number in the win color */
export function OddsBar({ a }: { a: number }) {
  // The bar keeps a sliver of each side (the numbers stay exact), so the favorite shows at >99%
  const bar = Math.min(Math.max(a, MIN_BAR_SHARE), 1 - MIN_BAR_SHARE);
  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs font-semibold tabular-nums">
      <span className="w-9" style={{ color: a >= 0.5 ? RESULT_DOT_COLORS.W : 'var(--muted)' }}>{percent(a)}</span>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--neutral-bg)]" role="img" aria-label={`Win odds ${percent(a)} to ${percent(1 - a)}`}>
        <div style={{ width: `${bar * 100}%`, backgroundColor: a >= 0.5 ? RESULT_DOT_COLORS.W : RESULT_DOT_COLORS.L, transition: 'width .6s ease' }} />
        <div style={{ width: `${(1 - bar) * 100}%`, backgroundColor: a < 0.5 ? RESULT_DOT_COLORS.W : RESULT_DOT_COLORS.L, transition: 'width .6s ease' }} />
      </div>
      <span className="w-9 text-right" style={{ color: a <= 0.5 ? RESULT_DOT_COLORS.W : 'var(--muted)' }}>{percent(1 - a)}</span>
    </div>
  );
}
