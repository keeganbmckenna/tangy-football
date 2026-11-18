'use client';

import { ReactNode } from 'react';
import { GRADIENT_STYLES } from '@/lib/constants';
import HowItWorks from '@/components/ui/HowItWorks';

interface SectionCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  gradientType?: keyof typeof GRADIENT_STYLES;
  /** An explanation, folded under "How this works" (footerOpen: always shown, for a legend) */
  footer?: ReactNode;
  footerOpen?: boolean;
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
  footerOpen = false,
}: SectionCardProps) {
  const gradientClass = GRADIENT_STYLES[gradientType];

  return (
    <div className="section-card bg-[var(--surface-elevated)] rounded-lg shadow-lg overflow-hidden border border-[var(--border)]">
      {/* Header */}
      <div className={`section-header bg-gradient-to-r ${gradientClass} px-4 py-3 sm:px-6 sm:py-4`} data-tone={gradientType}>
        <h2 className="text-xl font-bold text-white sm:text-2xl">{title}</h2>
        {subtitle && <p className="text-white/90 text-sm mt-1">{subtitle}</p>}
      </div>

      {/* Content */}
      {children}

      {/* Footer */}
      {footer && (
        <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--muted)] sm:px-6">
          {footerOpen ? footer : <HowItWorks>{footer}</HowItWorks>}
        </div>
      )}
    </div>
  );
}
