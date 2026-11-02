'use client';

import { useState } from 'react';

/**
 * Shares a link to one of the share pages (app/share): the phone's share sheet where there is one,
 * otherwise the link copied
 */
export default function ShareButton({ path, title, label = 'Share', className = '' }: { path: string; title: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = new URL(path, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ url, title });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Share sheet dismissed, or no clipboard: nothing to do
    }
  };
  return (
    <button type="button" onClick={share} className={`rounded-md px-2 py-1 text-xs font-semibold ${className}`} aria-label={`${label}: ${title}`}>
      {copied ? 'Link copied' : label}
    </button>
  );
}
