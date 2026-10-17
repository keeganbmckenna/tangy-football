'use client';

import { ReactNode } from 'react';
import { GRADIENT_STYLES } from '@/lib/constants';

interface SectionCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  gradientType?: keyof typeof GRADIENT_STYLES;
  footer?: ReactNode;
}

/**
 * Reusable card component with a colored header (a gradient in light mode, a
 * solid deep shade of the same color in dark mode; see globals.css)
 *
 * @example
 * ```tsx
 * <SectionCard
 *   title="Weekly Scores"
 *   subtitle="Points scored each week"
 *   gradientType="secondary"
 * >
 *   <YourContent />
 * </SectionCard>
 * ```
 */
export default function SectionCard({
  title,
  subtitle,
  children,
  gradientType = 'primary',
  footer,
}: SectionCardProps) {
  const gradientClass = GRADIENT_STYLES[gradientType];

  return (
    <div className="section-card bg-[var(--surface-elevated)] rounded-lg shadow-lg overflow-hidden border border-[var(--border)]">
      {/* Header */}
      <div className={`section-header bg-gradient-to-r ${gradientClass} px-6 py-4`} data-tone={gradientType}>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {subtitle && <p className="text-white/90 text-sm mt-1">{subtitle}</p>}
      </div>

      {/* Content */}
      {children}

      {/* Footer */}
      {footer && (
        <div className="px-6 py-3 bg-[var(--surface)] border-t border-[var(--border)] text-[var(--muted)]">
          {footer}
        </div>
      )}
    </div>
  );
}
