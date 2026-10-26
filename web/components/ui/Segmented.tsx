'use client';

/** A small pill toggle between a few views */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="inline-flex shrink-0 gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            value === o.id ? 'bg-[var(--info-bg)] text-[var(--info-text)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
