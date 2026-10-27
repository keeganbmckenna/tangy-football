'use client';

const ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** Positions in lineup order, from the ones present */
export const positionsOf = (positions: Iterable<string>) =>
  [...new Set(positions)].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

/** Pick any number of positions; none picked means all */
export function PositionChips({
  positions,
  value,
  onChange,
  label,
}: {
  positions: string[];
  value: string[];
  onChange: (value: string[]) => void;
  label: string;
}) {
  const chip = (on: boolean) =>
    `whitespace-nowrap rounded-full px-2 py-1 sm:px-3 text-xs font-semibold transition-colors ${
      on ? 'bg-[var(--info-bg)] text-[var(--info-text)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'
    }`;
  return (
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange([])} aria-pressed={value.length === 0} className={chip(value.length === 0)}>
        All
      </button>
      {positions.map((p) => {
        const on = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
            aria-pressed={on}
            className={chip(on)}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

/** Players to leave alone (never dropped, or never traded), picked from a roster */
export function KeepPicker({
  players,
  value,
  onChange,
  summary,
}: {
  players: Array<{ id: string; label: string }>;
  value: string[];
  onChange: (value: string[]) => void;
  summary: string;
}) {
  return (
    <details className="group rounded-lg border border-[var(--border)] text-sm">
      <summary className="cursor-pointer px-3 py-2 text-[var(--foreground)]">
        {summary}
        {value.length > 0 && <span className="ml-1 text-[var(--muted)]">({value.length})</span>}
      </summary>
      <div className="grid gap-x-4 gap-y-1 border-t border-[var(--border)] px-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
        {players.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={value.includes(p.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))}
              className="h-4 w-4"
            />
            <span className="truncate">{p.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
