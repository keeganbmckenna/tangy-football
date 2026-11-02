/**
 * The share cards' preview images (1200 x 630, the size link previews use), drawn with next/og:
 * a matchup's teams, scores and win-odds line, or a week's awards, each with its biggest swing.
 * next/og lays out with flexbox only and inline styles, so every box with more than one child is
 * a flex box.
 */

import { ImageResponse } from 'next/og';
import type { ShareMatchup, ShareSwing, ShareTeam, ShareWeek } from '@/lib/shareData';
import type { ManagerProfile } from '@/lib/analyze/managerProfile';

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
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
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

/** When a live card was made, e.g. "1:42 AM ET" */
const madeAt = () => `${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;

function Header({ season, week, status, label }: { season: string; week: number; status: 'final' | 'live'; label?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: C.muted, fontSize: 24, letterSpacing: 2 }}>
      <div style={{ display: 'flex' }}>{`TANGY FOOTBALL  ·  ${season} WEEK ${week}${label ? `  ·  ${label}` : ''}`}</div>
      {status === 'live' ? (
        <div style={{ display: 'flex', alignItems: 'center', color: C.live, fontWeight: 700 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: C.live, marginRight: 10 }} />
          {`LIVE  ·  ${madeAt()}`}
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

/** A team as the matchup card shows it: photo, name, score, then its projection and (live) its chance to win */
function TeamBlock({ t, src, right, won, odds }: { t: ShareTeam; src: string | null; right: boolean; won: boolean; odds: number | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', width: 520 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexDirection: right ? 'row-reverse' : 'row' }}>
        <Avatar src={src} name={t.name} size={72} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', margin: right ? '0 18px 0 0' : '0 0 0 18px' }}>
          <div style={{ display: 'flex', color: C.text, fontSize: 36, fontWeight: 700 }}>{clip(t.name, 22)}</div>
          <div style={{ display: 'flex', color: C.muted, fontSize: 22 }}>{`@${clip(t.username, 24)}`}</div>
        </div>
      </div>
      <div style={{ display: 'flex', color: won ? C.win : C.text, fontSize: 84, fontWeight: 700, marginTop: 4, lineHeight: 1.05 }}>{t.score.toFixed(2)}</div>
      {(t.projected !== null || odds !== null) && (
        <div style={{ display: 'flex', fontSize: 28, color: C.muted }}>
          {t.projected !== null && `proj ${t.projected.toFixed(1)}`}
          {t.projected !== null && odds !== null && <span style={{ margin: '0 10px' }}>·</span>}
          {odds !== null && <span style={{ color: odds >= 0.5 ? C.win : C.muted, fontWeight: 700 }}>{pct(odds)}</span>}
        </div>
      )}
    </div>
  );
}

/** a's chance to win through the week as a line: above the dashed 50% line, a is favored */
function OddsLine({ odds, a, width, height }: { odds: number[]; a: string; width: number; height: number }) {
  const n = odds.length;
  const last = odds[n - 1];
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', color: C.muted, fontSize: 20, letterSpacing: 1.5 }}>{`${clip(a, 30).toUpperCase()}'S CHANCE TO WIN THROUGH THE WEEK`}</div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
        <svg width={width - 70} height={height} viewBox={`0 0 ${width - 70} ${height}`}>
          <line x1="0" y1={height / 2} x2={width - 70} y2={height / 2} stroke={C.border} strokeWidth="2" strokeDasharray="8 8" />
          <polyline
            points={odds.map((p, i) => `${((i / Math.max(n - 1, 1)) * (width - 70)).toFixed(1)},${((1 - p) * height).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={last >= 0.5 ? C.win : C.loss}
            strokeWidth="5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height, marginLeft: 12, color: C.muted, fontSize: 18 }}>
          <div style={{ display: 'flex' }}>100%</div>
          <div style={{ display: 'flex' }}>50%</div>
          <div style={{ display: 'flex' }}>0%</div>
        </div>
      </div>
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
  // a's chance to win now (live cards show each side's under its score)
  const now = m.odds?.length ? m.odds[m.odds.length - 1] : null;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: C.bg, padding: '44px 56px', fontFamily: 'Geist, sans-serif' }}>
        <Header season={m.season} week={m.week} status={m.status} label={m.leadChanges ? `${m.leadChanges} LEAD CHANGE${m.leadChanges === 1 ? '' : 'S'}` : undefined} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <TeamBlock t={m.a} src={pa} right={false} won={final && m.a.score > m.b.score} odds={!final && now !== null ? now : null} />
          <TeamBlock t={m.b} src={pb} right won={final && m.b.score > m.a.score} odds={!final && now !== null ? 1 - now : null} />
        </div>
        {m.odds && m.odds.length > 1 ? <OddsLine odds={m.odds} a={m.a.name} width={1088} height={m.swing ? 80 : 140} /> : <div style={{ display: 'flex' }} />}
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
                  <div style={{ display: 'flex', width: 260, justifyContent: 'center', fontWeight: 700 }}>{`${g.a.score.toFixed(2)}  -  ${g.b.score.toFixed(2)}`}</div>
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

/** A manager's card: career record, titles, scoring and every season's finish (lib/analyze/managerProfile.ts) */
export async function managerImage(p: ManagerProfile, name: string, avatarUrl: string | null): Promise<ImageResponse> {
  const src = await photo(avatarUrl);
  const titles = p.seasons.filter((s) => s.champion).map((s) => s.season);
  const tiles: Array<[string, string, string?]> = [
    ['RECORD', `${p.totals.wins}-${p.totals.losses}${p.totals.ties ? `-${p.totals.ties}` : ''}`, `${(p.totals.winPct * 100).toFixed(1)}%, ${ordinal(p.ranks.winPct)} of ${p.ranks.of}`],
    ['TITLES', String(titles.length), titles.join(', ') || undefined],
    ['POINTS PER GAME', p.totals.scoredGames ? p.totals.pointsPerGame.toFixed(1) : '-', p.totals.scoredGames ? `${ordinal(p.ranks.pointsPerGame)} in the league` : undefined],
    ['BEST FINISH', p.totals.bestFinish ? ordinal(p.totals.bestFinish) : '-', `${p.totals.finals} final${p.totals.finals === 1 ? '' : 's'}`],
  ];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: C.bg, padding: '44px 56px', fontFamily: 'Geist, sans-serif' }}>
        <div style={{ display: 'flex', color: C.muted, fontSize: 24, letterSpacing: 2 }}>{`TANGY FOOTBALL  ·  LEAGUE HISTORY`}</div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Avatar src={src} name={name} size={120} />
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 28 }}>
            <div style={{ display: 'flex', color: C.text, fontSize: 64, fontWeight: 700 }}>{clip(name, 22)}</div>
            <div style={{ display: 'flex', color: C.muted, fontSize: 28 }}>{`${p.seasons.length} seasons · ${clip(p.seasons[0]?.teamName ?? '', 30)}`}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          {tiles.map(([label, value, sub]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', width: 256, background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 20px' }}>
              <div style={{ display: 'flex', color: C.muted, fontSize: 18, letterSpacing: 1.5 }}>{label}</div>
              <div style={{ display: 'flex', color: C.text, fontSize: 44, fontWeight: 700 }}>{value}</div>
              <div style={{ display: 'flex', color: C.muted, fontSize: 20 }}>{clip(sub ?? ' ', 24)}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...SIZE, fonts: await fonts(), headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
  );
}

/** The league's card, for a plain link: its photo, name, the week and the standings' top teams */
export async function leagueImage(league: { name: string; season: string; week: string; avatarUrl: string | null }, top: Array<{ name: string; record: string; points: number }>): Promise<ImageResponse> {
  const src = await photo(league.avatarUrl);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: C.bg, padding: '56px', fontFamily: 'Geist, sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 520 }}>
          <Avatar src={src} name={league.name} size={150} />
          <div style={{ display: 'flex', color: C.text, fontSize: 64, fontWeight: 700, marginTop: 28 }}>Tangy Football</div>
          <div style={{ display: 'flex', color: C.muted, fontSize: 28, marginTop: 6 }}>{`${league.season} · ${league.week}`}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
          <div style={{ display: 'flex', color: C.muted, fontSize: 22, letterSpacing: 2, marginBottom: 10 }}>STANDINGS</div>
          {top.map((t, i) => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', fontSize: 30, color: C.text, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', width: 44, color: C.muted }}>{String(i + 1)}</div>
              <div style={{ display: 'flex', flex: 1 }}>{clip(t.name, 22)}</div>
              <div style={{ display: 'flex', fontWeight: 700 }}>{t.record}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...SIZE, fonts: await fonts(), headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
  );
}
