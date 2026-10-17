'use client';

import { FootballSpinner } from '@/components/ui/Football';

interface LoadingSpinnerProps {
  message?: string;
}

/**
 * Reusable loading spinner: a tumbling football with an optional message
 *
 * @example
 * ```tsx
 * <LoadingSpinner message="Loading league data..." />
 * ```
 */
export default function LoadingSpinner({ message = 'Loading...' }: LoadingSpinnerProps) {
  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
      <div className="text-center">
        <FootballSpinner />
        <p className="mt-4 text-[var(--muted)] text-lg">{message}</p>
      </div>
    </div>
  );
}
