'use client';

import { useEffect, useRef } from 'react';

/**
 * The page background: faint chalkboard plays (O's, X's and routes) drawing
 * themselves one at a time, each at a new angle and drifting slowly in its own
 * direction. Purely decorative: it ignores taps, pauses while the tab is
 * hidden, and shows one still play when the device asks for reduced motion.
 * Cards are slightly see-through (globals.css), so it shows faintly behind them.
 */

const NS = 'http://www.w3.org/2000/svg';
const CYCLE_MS = 11000;

// One formation on a 1000-wide board, line of scrimmage at y=120
const OFFENSE = [...[440, 470, 500, 530, 560].map((x) => [x, 128]), [500, 158], [500, 190], [150, 128], [850, 128], [250, 134], [720, 134]];
const DEFENSE = [[440, 104], [500, 104], [560, 104], [380, 80], [620, 80], [500, 70], [160, 92], [840, 92], [300, 40], [700, 40], [500, 22]];
const PLAYS = [
  // Four verticals
  ['M150 128 L150 20', 'M850 128 L850 20', 'M250 134 L270 70 L270 18', 'M720 134 L700 70 L700 18', 'M500 190 C560 190 600 175 640 150'],
  // Slant-flat
  ['M150 128 L150 98 L240 40', 'M850 128 L850 98 L760 40', 'M250 134 L210 150 L120 150', 'M720 134 L760 150 L880 150', 'M500 190 L500 170 L540 110 L560 60'],
  // Mesh
  ['M150 128 L180 92 L620 92', 'M850 128 L820 100 L380 100', 'M250 134 L250 40 L170 20', 'M720 134 L720 40 L820 20', 'M500 190 C460 190 420 180 380 160'],
  // Post-wheel
  ['M150 128 L150 70 L330 14', 'M850 128 L850 70 L670 14', 'M250 134 L320 140 L340 60 L320 16', 'M720 134 L690 90 L760 60', 'M500 190 L620 190 C680 190 700 150 700 100'],
];
// Line-of-scrimmage angles and pan headings (degrees), cycled separately
const ANGLES = [-24, 14, -8, 26, -16, 6];
const HEADINGS = [200, 25, 290, 115, 340, 160];

const mark = {
  o: (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="7"/>`,
  x: (x: number, y: number) => `<path d="M${x - 6} ${y - 6} L${x + 6} ${y + 6} M${x + 6} ${y - 6} L${x - 6} ${y + 6}"/>`,
};

export default function Chalkboard() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const pan = svg.querySelector<SVGGElement>('.chalk-pan')!;
    const board = svg.querySelector<SVGGElement>('.chalk-board')!;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timers: number[] = [];
    let play = 0;

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const n = play++;
      const angle = ANGLES[n % ANGLES.length];
      // Big enough to span the screen; on phones small enough to see the whole formation
      const scale = w < 640 ? w / 640 : Math.max(w, h) / 820;
      const cx = w * (0.42 + (0.16 * ((n * 37) % 10)) / 10);
      const cy = h * (0.38 + (0.24 * ((n * 53) % 10)) / 10);
      board.setAttribute('transform', `translate(${cx} ${cy}) rotate(${angle}) scale(${scale}) translate(-500 -110)`);
      board.style.transition = 'none';
      board.style.opacity = '1';

      const marks = document.createElementNS(NS, 'g');
      marks.innerHTML =
        OFFENSE.map(([x, y]) => mark.o(x, y)).join('') +
        DEFENSE.map(([x, y]) => mark.x(x, y)).join('') +
        '<path d="M-400 120 L1400 120" stroke-dasharray="3 10"/>';
      board.replaceChildren(marks);
      const routes = PLAYS[n % PLAYS.length].map((d) => {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('marker-end', 'url(#chalk-arrow)');
        board.appendChild(p);
        return p;
      });
      if (still) return;

      // Marks fade in one by one, then each route draws itself
      [...marks.children].forEach((el, k) => {
        const s = (el as SVGElement).style;
        s.opacity = '0';
        s.transition = 'opacity .4s ease';
        timers.push(window.setTimeout(() => (s.opacity = '1'), 70 * k));
      });
      routes.forEach((p, k) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = `${len}`;
        p.style.strokeDashoffset = `${len}`;
        p.style.transition = `stroke-dashoffset 1.4s ease-in-out ${1.6 + k * 0.7}s`;
      });
      // A slow drift in its own direction, unrelated to the play's angle
      const heading = (HEADINGS[n % HEADINGS.length] * Math.PI) / 180;
      const dist = Math.hypot(w, h) * 0.05;
      const dx = Math.cos(heading) * dist;
      const dy = Math.sin(heading) * dist;
      pan.style.transition = 'none';
      pan.style.transform = `translate(${-dx}px, ${-dy}px)`;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          pan.style.transition = `transform ${CYCLE_MS}ms linear`;
          pan.style.transform = `translate(${dx}px, ${dy}px)`;
          routes.forEach((p) => (p.style.strokeDashoffset = '0'));
        })
      );
      timers.push(
        window.setTimeout(() => {
          board.style.transition = 'opacity 1.6s ease';
          board.style.opacity = '0';
        }, CYCLE_MS - 1700),
        window.setTimeout(draw, CYCLE_MS)
      );
    };

    const stop = () => timers.splice(0).forEach((t) => window.clearTimeout(t));
    // Pause while the tab is hidden; start a fresh play when it's back
    const onVisibility = () => {
      stop();
      if (!document.hidden) draw();
    };
    draw();
    if (!still) document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="chalkboard pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <svg ref={svgRef} className="absolute inset-0 h-full w-full">
        <defs>
          {/* Rough edges, so it reads as chalk rather than clean vector lines */}
          <filter id="chalk-rough">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves={2} />
            <feDisplacementMap in="SourceGraphic" scale={1.8} />
          </filter>
          <marker id="chalk-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10" fill="none" stroke="currentColor" strokeWidth={2} />
          </marker>
        </defs>
        <g className="chalk-pan">
          <g
            className="chalk-board"
            filter="url(#chalk-rough)"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  );
}
