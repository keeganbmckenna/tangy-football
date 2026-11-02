/**
 * The share cards' preview images (1200 x 630, the size link previews use), drawn with next/og:
 * a matchup's teams, scores and win-odds line, or a week's awards, each with its biggest swing.
 * next/og lays out with flexbox only and inline styles, so every box with more than one child is
 * a flex box.
 */

import { ImageResponse } from 'next/og';
import type { ShareMatchup, ShareSwing, ShareTeam, ShareWeek } from '@/lib/shareData';

export const SIZE = { width: 1200, height: 630 };

const C = {
  bg: '#0a0a0a',
  card: '#151515',
  border: '#2a2a2a',
  text: '#f5f5f5',
  muted: '#9ca3af',
  win: '#22c55e',
  loss: '#ef4444',
  live: '#ef4444',
};

const pct = (p: number) => (p >= 1 ? '100%' : p <= 0 ? '0%' : p > 0.995 ? '>99%' : p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);

/** An image's real format from its first bytes (Sleeper serves JPEGs labelled image/png); null for others */
export function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

/** A team photo as a data URL, so one that fails to load can't fail the whole image */
async function photo(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = imageType(bytes);
    return type ? `data:${type};base64,${Buffer.from(bytes).toString('base64')}` : null;
  } catch {
    return null;
  }
}

// The site's font (Geist), regular and bold, as TTF from Google Fonts (which serves TTF to clients
// that don't ask for WOFF2); without it next/og's own regular font, with no bold
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;700';
type Font = { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' };
let fontsLoaded: Promise<Font[]> | null = null;

function fonts(): Promise<Font[]> {
  fontsLoaded ??= (async () => {
    try {
      const css = await (await fetch(FONT_CSS, { signal: AbortSignal.timeout(3000) })).text();
      const urls = [...css.matchAll(/src: url\((https:[^)]+\.ttf)\)/g)].map((m) => m[1]);
      if (urls.length < 2) return [];
      const [regular, bold] = await Promise.all(urls.slice(0, 2).map(async (u) => (await fetch(u, { signal: AbortSignal.timeout(3000) })).arrayBuffer()));
      return [
        { name: 'Geist', data: regular, weight: 400, style: 'normal' },
        { name: 'Geist', data: bold, weight: 700, style: 'normal' },
      ];
    } catch {
      fontsLoaded = null;
      return [];
    }
  })();
  return fontsLoaded;
}

function Avatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt="" style={{ borderRadius: size / 2, objectFit: 'cover' }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: C.border, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size / 2.2, fontWeight: 700 }}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Header({ season, week, status, label }: { season: string; week: number; status: 'final' | 'live'; label?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: C.muted, fontSize: 24, letterSpacing: 2 }}>
      <div style={{ display: 'flex' }}>{`TANGY FOOTBALL  ·  ${season} WEEK ${week}${label ? `  ·  ${label}` : ''}`}</div>
      {status === 'live' ? (
        <div style={{ display: 'flex', alignItems: 'center', color: C.live, fontWeight: 700 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: C.live, marginRight: 10 }} />
          LIVE
        </div>
      ) : (
        <div style={{ display: 'flex', fontWeight: 700 }}>FINAL</div>
      )}
    </div>
  );
}

function Swing({ swing, matchup }: { swing: ShareSwing; matchup?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
      <div style={{ display: 'flex', color: C.muted, fontSize: 22, letterSpacing: 1.5 }}>
        {`BIGGEST SWING${matchup ? `  ·  ${clip(matchup, 60).toUpperCase()}` : ''}`}
      </div>
      <div style={{ display: 'flex', color: C.text, fontSize: 28, marginTop: 6, lineHeight: 1.25 }}>{clip(swing.desc, 120)}</div>
      <div style={{ display: 'flex', color: C.muted, fontSize: 24, marginTop: 6 }}>
        {`${clip(swing.team, 30)}: ${pct(swing.from)} to `}
        <span style={{ color: swing.to >= 0.5 ? C.win : C.text, fontWeight: 700, marginLeft: 8 }}>{pct(swing.to)}</span>
      </div>
    </div>
  );
}

function TeamBlock({ t, src, right, won }: { t: ShareTeam; src: string | null; right: boolean; won: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', width: 520 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexDirection: right ? 'row-reverse' : 'row' }}>
        <Avatar src={src} name={t.name} size={72} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', margin: right ? '0 18px 0 0' : '0 0 0 18px' }}>
          <div style={{ display: 'flex', color: C.text, fontSize: 36, fontWeight: 700 }}>{clip(t.name, 22)}</div>
          <div style={{ display: 'flex', color: C.muted, fontSize: 22 }}>{`@${clip(t.username, 24)}`}</div>
        </div>
      </div>
      <div style={{ display: 'flex', color: won ? C.win : C.text, fontSize: 84, fontWeight: 700, marginTop: 8 }}>{t.score.toFixed(2)}</div>
    </div>
  );
}

/** a's odds through the week as a line, 100% at the top, with the 50% line */
function OddsLine({ odds, a, b, width, height }: { odds: number[]; a: string; b: string; width: number; height: number }) {
  const n = odds.length;
  const pts = odds.map((p, i) => `${((i / Math.max(n - 1, 1)) * width).toFixed(1)},${((1 - p) * height).toFixed(1)}`).join(' ');
  const last = odds[n - 1];
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted, fontSize: 20 }}>
        <div style={{ display: 'flex' }}>{`${clip(a, 30)} 100%`}</div>
        <div style={{ display: 'flex' }}>{`now ${pct(last)}`}</div>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ marginTop: 6, marginBottom: 6 }}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={C.border} strokeWidth="2" strokeDasharray="8 8" />
        <polyline points={pts} fill="none" stroke={last >= 0.5 ? C.win : C.loss} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', color: C.muted, fontSize: 20 }}>{`${clip(b, 30)} 100%`}</div>
    </div>
  );
}

const cacheHeaders = (status: 'final' | 'live') => ({
  // A finished week doesn't change; a live one does (chat apps keep their own copy anyway)
  'Cache-Control': status === 'final' ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'public, s-maxage=120, stale-while-revalidate=300',
});

export async function matchupImage(m: ShareMatchup): Promise<ImageResponse> {
  const [pa, pb] = await Promise.all([photo(m.a.avatarUrl), photo(m.b.avatarUrl)]);
  const final = m.status === 'final';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: C.bg, padding: '44px 56px', fontFamily: 'Geist, sans-serif' }}>
        <Header season={m.season} week={m.week} status={m.status} label={m.leadChanges ? `${m.leadChanges} LEAD CHANGE${m.leadChanges === 1 ? '' : 'S'}` : undefined} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <TeamBlock t={m.a} src={pa} right={false} won={final && m.a.score > m.b.score} />
          <TeamBlock t={m.b} src={pb} right won={final && m.b.score > m.a.score} />
        </div>
        {m.odds && m.odds.length > 1 ? <OddsLine odds={m.odds} a={m.a.name} b={m.b.name} width={1088} height={m.swing ? 90 : 150} /> : <div style={{ display: 'flex' }} />}
        {m.swing ? <Swing swing={m.swing} /> : <div style={{ display: 'flex' }} />}
      </div>
    ),
    { ...SIZE, fonts: await fonts(), headers: cacheHeaders(m.status) }
  );
}

export async function weekImage(w: ShareWeek): Promise<ImageResponse> {
  const awards = w.awards.slice(0, 6);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: C.bg, padding: '44px 56px', fontFamily: 'Geist, sans-serif' }}>
        <Header season={w.season} week={w.week} status={w.status} label={w.status === 'final' ? 'RECAP' : 'SO FAR'} />
        {awards.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {awards.map((a) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', width: 352, background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 18px', marginBottom: 14 }}>
                <div style={{ display: 'flex', color: C.muted, fontSize: 18, letterSpacing: 1.5 }}>{a.label.toUpperCase()}</div>
                <div style={{ display: 'flex', color: C.text, fontSize: 26, fontWeight: 700, marginTop: 4 }}>{clip(a.who, 24)}</div>
                <div style={{ display: 'flex', color: C.muted, fontSize: 22, marginTop: 2 }}>{a.detail}</div>
              </div>
            ))}
          </div>
        ) : (
          // A week in progress: every matchup's score and odds
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {w.games.map((g) => {
              const p = g.odds?.[g.odds.length - 1] ?? null;
              return (
                // Each team's chance on its own side, green for the favorite
                <div key={g.matchupId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 26, color: C.text, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', width: 70, color: p !== null && p >= 0.5 ? C.win : C.muted, fontSize: 22 }}>{p !== null ? pct(p) : ''}</div>
                  <div style={{ display: 'flex', width: 320 }}>{clip(g.a.name, 20)}</div>
                  <div style={{ display: 'flex', width: 260, justifyContent: 'center', fontWeight: 700 }}>{`${g.a.score.toFixed(1)}  -  ${g.b.score.toFixed(1)}`}</div>
                  <div style={{ display: 'flex', width: 320, justifyContent: 'flex-end' }}>{clip(g.b.name, 20)}</div>
                  <div style={{ display: 'flex', width: 70, justifyContent: 'flex-end', color: p !== null && p < 0.5 ? C.win : C.muted, fontSize: 22 }}>{p !== null ? pct(1 - p) : ''}</div>
                </div>
              );
            })}
          </div>
        )}
        {w.swing ? <Swing swing={w.swing} matchup={w.swing.matchup} /> : <div style={{ display: 'flex' }} />}
      </div>
    ),
    { ...SIZE, fonts: await fonts(), headers: cacheHeaders(w.status) }
  );
}
