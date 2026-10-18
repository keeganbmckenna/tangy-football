'use client';

import { useState } from 'react';

/** A team's photo, or its initial if there isn't one (or it fails to load) */
export default function TeamAvatar({ url, name, size = 'h-8 w-8' }: { url?: string | null; name: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" onError={() => setFailed(true)} className={`${size} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-[var(--neutral-bg)] text-xs font-semibold text-[var(--neutral-text)]`}>
      {name.charAt(0)}
    </div>
  );
}
