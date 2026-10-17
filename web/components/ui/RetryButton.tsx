'use client';

/** "Try again" for a card whose data didn't load */
export default function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--hover)]"
    >
      Try again
    </button>
  );
}
