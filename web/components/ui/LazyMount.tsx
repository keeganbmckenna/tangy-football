'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

// Charts build one at a time with a frame in between, so a tab with several shows
// up straight away and never freezes for longer than one chart takes
let queue: Promise<void> = Promise.resolve();
const afterNextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * Renders its children only once they come near the screen, holding their height
 * until then. Charts are the slow part of a tab switch, so a tab only builds the
 * ones you can see and the rest as you scroll to them.
 */
export default function LazyMount({ height, children }: { height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        queue = queue.then(() => {
          if (!alive) return;
          setShown(true);
          return afterNextFrame();
        });
      },
      { rootMargin: '300px 0px' }
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [shown]);

  return (
    <div ref={ref} style={{ minHeight: height }}>
      {shown ? children : null}
    </div>
  );
}
