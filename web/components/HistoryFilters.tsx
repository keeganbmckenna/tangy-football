'use client';

import { DEFAULT_ERA, HISTORY_ERAS, type HistoryEra } from '@/lib/analyze/history';

interface Option<T> {
  value: T;
  label: string;
}

/** A row of pill buttons, one pressed */
function Segmented<T extends string | boolean>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex w-full gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 sm:w-auto" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${
            value === o.value ? 'bg-[var(--info-bg)] text-[var(--info-text)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface HistoryFiltersProps {
  era: HistoryEra['key'];
  onEra: (era: HistoryEra['key']) => void;
  postseason: boolean;
  onPostseason: (on: boolean) => void;
  showFormer: boolean;
  onShowFormer: (on: boolean) => void;
  /** Names of managers who aren't in this season's league */
  former: string[];
  onReset: () => void;
}

/**
 * The History tab's filters, above everything they apply to: which seasons count, which games count,
 * and whether managers no longer in the league are listed. One place, so a screenful never mixes scopes.
 */
export default function HistoryFilters({ era, onEra, postseason, onPostseason, showFormer, onShowFormer, former, onReset }: HistoryFiltersProps) {
  const current = HISTORY_ERAS.find((e) => e.key === era) ?? HISTORY_ERAS[0];
  const changed = era !== DEFAULT_ERA || postseason || showFormer;
  return (
    <section aria-label="History filters" className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Filters</h2>
        {changed && (
          <button type="button" onClick={onReset} className="text-xs font-medium text-[var(--accent)] hover:underline">
            Reset
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Seasons</div>
          <Segmented label="Seasons" options={HISTORY_ERAS.map((e) => ({ value: e.key, label: e.label }))} value={era} onChange={onEra} />
          <p className="text-xs text-[var(--muted)]">{current.detail}</p>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Games counted</div>
          <Segmented
            label="Games counted"
            options={[
              { value: false, label: 'Regular season' },
              { value: true, label: '+ Playoffs & toilet bowl' },
            ]}
            value={postseason}
            onChange={onPostseason}
          />
          <p className="text-xs text-[var(--muted)]">Placement games never count</p>
        </div>
      </div>
      {former.length > 0 && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-[var(--border)] pt-3 text-sm text-[var(--foreground)]">
          <input type="checkbox" checked={showFormer} onChange={(e) => onShowFormer(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" />
          <span>
            Show former managers
            <span className="block text-xs text-[var(--muted)]">
              {former.join(', ')}. Their games still count in everyone&apos;s records.
            </span>
          </span>
        </label>
      )}
    </section>
  );
}
