/**
 * The two halves of a matchup card, shared by the live and past-week cards so every week looks the same
 * (as compact as Sleeper's): the avatar at the outer edge, the score toward the middle with a line under
 * it, then the names under the card's middle row. A finished game's winner keeps full strength with a
 * trophy by its name; the loser's score fades. No color carries the result on its own.
 */
import type { ReactNode } from 'react';
import TeamAvatar from '@/components/ui/TeamAvatar';

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
