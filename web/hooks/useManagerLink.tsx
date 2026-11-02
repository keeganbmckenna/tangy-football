'use client';

import { createContext, useContext } from 'react';

/**
 * A manager's "@username" anywhere in the site opens their page in the History tab. The app
 * provides the opener (it knows the season's managers and switches tabs); without it, plain text.
 */
export const ManagerLinkContext = createContext<((username: string) => boolean) | null>(null);

export function ManagerLink({ username, className = '' }: { username: string; className?: string }) {
  const open = useContext(ManagerLinkContext);
  if (!open || !username) return <span className={className}>@{username}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open(username);
      }}
      className={`text-left hover:underline ${className}`}
      title={`${username}: see their page`}
    >
      @{username}
    </button>
  );
}
