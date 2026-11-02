'use client';

import { useState } from 'react';

/**
 * Shares an address of the site (which previews as its card in chat apps, lib/sharePreview.ts): the
 * phone's share sheet where there is one, otherwise the link copied
 */
export default function ShareButton({ path, title, label = 'Share', icon = false, className = '' }: { path: string; title: string; label?: string; icon?: boolean; className?: string }) {
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
  if (icon) {
    // Just the icon (a check once the link is copied), for tight spots like a dialog's header
    return (
      <button type="button" onClick={share} className={`rounded-md p-1.5 ${className}`} aria-label={copied ? 'Link copied' : `${label}: ${title}`} title={copied ? 'Link copied' : label}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {copied ? (
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          ) : (
            <>
              <path d="M12 3v12" />
              <path d="M7.5 7.5L12 3l4.5 4.5" />
              <path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" />
            </>
          )}
        </svg>
      </button>
    );
  }
  return (
    <button type="button" onClick={share} className={`rounded-md px-2 py-1 text-xs font-semibold ${className}`} aria-label={`${label}: ${title}`}>
      {copied ? 'Link copied' : label}
    </button>
  );
}
