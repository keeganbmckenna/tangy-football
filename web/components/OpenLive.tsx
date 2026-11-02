'use client';

import { useEffect } from 'react';

/**
 * A live share link's page goes straight on to the site's live view, which keeps updating. Chat
 * apps read the page's preview without running this, so their picture is unchanged.
 */
export default function OpenLive({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return null;
}
