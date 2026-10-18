'use client';

import TeamAvatar from '@/components/ui/TeamAvatar';

/**
 * Bracket layout shared by the projected brackets (Playoffs tab during the
 * regular season) and the real playoff and toilet bowl brackets: one column
 * per round, one card per game, and optional placement games underneath.
 */

export interface BoardTeam {
  /** null for an empty slot */
  rosterId: number | null;
  name: string;
  username?: string;
  avatarUrl?: string | null;
  seed?: number | null;
  /** Small line under the name (record, odds); defaults to @username */
  caption?: string | null;
  score?: number | null;
  /** Won this game */
  won?: boolean;
  /** Not decided yet, e.g. "Winner of 4 v 5" (shown in place of a team) */
  placeholder?: string;
}

export interface BoardGame {
  id: string;
  label?: string;
  top: BoardTeam;
  bottom: BoardTeam;
  /** For a game that's been played: open both lineups */
  onOpen?: () => void;
  /** Its lineups are loading */
  opening?: boolean;
}

export interface BoardColumn {
  title: string;
  subtitle?: string;
  /** e.g. "Byes: 1. Team A · 2. Team B" */
  note?: string;
  games: BoardGame[];
}

interface BracketBoardProps {
  columns: BoardColumn[];
  extras?: { title: string; games: (BoardGame & { subtitle?: string })[] };
}


function Slot({ team, decided }: { team: BoardTeam; decided: boolean }) {
  if (team.placeholder) {
    return <div className="flex h-10 items-center text-sm italic text-[var(--muted)]">{team.placeholder}</div>;
  }
  if (team.rosterId === null) {
    return <div className="flex h-10 items-center text-sm text-[var(--muted)]">TBD</div>;
  }
  const lost = decided && !team.won;
  const caption = team.caption ?? (team.username ? `@${team.username}` : null);
  return (
    <div className={`flex items-center gap-2 ${lost ? 'opacity-60' : ''}`}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--neutral-bg)] text-[10px] font-bold text-[var(--foreground)]">
        {team.seed ?? '–'}
      </span>
      <TeamAvatar url={team.avatarUrl} name={team.name} />
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm ${team.won ? 'font-semibold text-[var(--success-text)]' : 'font-medium text-[var(--foreground)]'}`}
          title={team.name}
        >
          {team.name}
        </div>
        {caption && <div className="truncate text-xs text-[var(--muted)]">{caption}</div>}
      </div>
      {team.score !== undefined && team.score !== null && (
        <div className={`shrink-0 text-sm ${team.won ? 'font-semibold text-[var(--success-text)]' : 'text-[var(--foreground)]'}`}>
          {team.score.toFixed(2)}
        </div>
      )}
    </div>
  );
}

function GameCard({ game, subtitle }: { game: BoardGame; subtitle?: string }) {
  const decided = !!(game.top.won || game.bottom.won);
  const body = (
    <>
      {(game.label || subtitle) && (
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          <span>{game.label}</span>
          {subtitle && <span className="normal-case tracking-normal font-normal">{subtitle}</span>}
        </div>
      )}
      <div className="space-y-2">
        <Slot team={game.top} decided={decided} />
        <div className="h-px bg-[var(--border)]" />
        <Slot team={game.bottom} decided={decided} />
      </div>
      {game.onOpen && (
        <div className="mt-2 text-center text-[11px] text-[var(--muted)]">{game.opening ? 'Loading lineups…' : 'Tap for lineups'}</div>
      )}
    </>
  );
  // A game that's been played opens both lineups
  return game.onOpen ? (
    <button
      type="button"
      onClick={game.onOpen}
      aria-label={`${game.top.name} vs ${game.bottom.name}: see lineups`}
      className="block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors hover:bg-[var(--hover)]"
    >
      {body}
    </button>
  ) : (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">{body}</div>
  );
}

export default function BracketBoard({ columns, extras }: BracketBoardProps) {
  const cols = columns.length >= 3 ? 'md:grid-cols-3' : columns.length === 2 ? 'md:grid-cols-2' : '';
  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${cols}`}>
        {columns.map((col) => (
          <div key={col.title} className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-[var(--foreground)]">{col.title}</div>
              {col.subtitle && <div className="text-xs text-[var(--muted)]">{col.subtitle}</div>}
            </div>
            {col.note && (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted)]">{col.note}</div>
            )}
            {col.games.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        ))}
      </div>
      {extras && extras.games.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-[var(--foreground)]">{extras.title}</div>
          <div className="grid gap-4 md:grid-cols-2">
            {extras.games.map((g) => (
              <GameCard key={g.id} game={g} subtitle={g.subtitle} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
