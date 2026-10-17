/** A football (the loading spinner and the app icon are drawn from this) */
export const FOOTBALL_SVG_PATHS = `
  <path d="M6 32 C16 13 48 13 58 32 C48 51 16 51 6 32 Z" fill="#8a4a21" stroke="#5b2e12" stroke-width="2" />
  <path d="M17.5 26.2 C16.2 29.8 16.2 34.2 17.5 37.8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" />
  <path d="M46.5 26.2 C47.8 29.8 47.8 34.2 46.5 37.8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" />
  <path d="M23 32 H41" stroke="#fff" stroke-width="2.4" stroke-linecap="round" />
  <path d="M26 28.5 V35.5 M30 28.5 V35.5 M34 28.5 V35.5 M38 28.5 V35.5" stroke="#fff" stroke-width="2" stroke-linecap="round" />
`;

export default function Football({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden dangerouslySetInnerHTML={{ __html: FOOTBALL_SVG_PATHS }} />
  );
}

/** A football tumbling end over end above its shadow */
export function FootballSpinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-10 w-10' : 'h-14 w-14';
  return (
    <div className="football-spinner flex flex-col items-center" role="status" aria-label="Loading">
      <div className="football-hop">
        <Football className={`football-tumble ${dim}`} />
      </div>
      <div className="football-shadow mt-1 h-1.5 w-8 rounded-full bg-[var(--foreground)] opacity-15" />
    </div>
  );
}
