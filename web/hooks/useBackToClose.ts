'use client';

import { useEffect, useRef } from 'react';

/**
 * A dialog that the back button (or a phone's back gesture) closes, instead of leaving the page:
 * opening it adds a history entry, and closing it any other way (✕, Escape, the backdrop) takes
 * that entry off again. The app's own back/forward handling skips these (backToCloseActive).
 */

let open = 0;
let skip = 0;

/** Whether a back press is a dialog's (the app's popstate handler leaves it alone) */
export function backToCloseActive(): boolean {
  if (skip > 0) {
    skip--;
    return true;
  }
  return open > 0;
}

export function useBackToClose(onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const marker = Math.random().toString(36).slice(2);
    open++;
    window.history.pushState({ ...(window.history.state ?? {}), dialog: marker }, '');
    let closedByBack = false;
    const onPop = () => {
      closedByBack = true;
      close.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      open--;
      // Closed some other way: take its entry off (that back press isn't the app's to handle)
      if (!closedByBack && window.history.state?.dialog === marker) {
        skip++;
        window.history.back();
      }
    };
  }, []);
}
