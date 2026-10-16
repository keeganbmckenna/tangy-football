import { RESULT_DOT_COLORS } from '@/lib/constants';

/** Dot for a real matchup result, or live, who's currently ahead */
export default function ResultDot({ result, live = false }: { result: 'W' | 'L' | 'T' | null; live?: boolean }) {
  const label = live
    ? result === 'W' ? 'Winning' : result === 'L' ? 'Losing' : result === 'T' ? 'Tied' : 'No matchup'
    : result === 'W' ? 'Win' : result === 'L' ? 'Loss' : result === 'T' ? 'Tie' : 'No result';
  return (
    <span
      className="inline-block h-3 w-3 rounded-full ring-2 ring-white/70 shrink-0 align-middle"
      style={{ backgroundColor: RESULT_DOT_COLORS[result ?? 'T'] }}
      title={`Real matchup: ${label}`}
      aria-label={`Real matchup: ${label}`}
    />
  );
}
