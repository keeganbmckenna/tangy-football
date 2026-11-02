'use client';

import { useEffect } from 'react';

/**
 * A share link's page goes straight on to that view of the site. Chat apps read the link's preview
 * (the card picture and description) from the page's metadata without running this.
 */
export default function OpenSite({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return null;
}
