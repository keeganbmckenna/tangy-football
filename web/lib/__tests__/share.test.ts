import { describe, expect, it } from 'vitest';
import { biggestSwing, firstSide, leadChanges, oriented, type ShareMatchup } from '../shareData';
import { imageType, oddsSegments } from '../shareImage';
import { readLinkTarget } from '../urlState';
import type { WinHistoryMatchup } from '../winHistory';

describe('share cards', () => {
  it('counts lead changes as the chart does: past 55% the other way', () => {
    expect(leadChanges([0.5, 0.6, 0.52, 0.4, 0.7])).toBe(2);
    // Wobbling around 50% isn't a lead change
    expect(leadChanges([0.5, 0.54, 0.46, 0.53, 0.47])).toBe(0);
    expect(leadChanges([])).toBe(0);
  });

  const h: WinHistoryMatchup = {
    matchupId: 1,
    a: 10,
    b: 20,
    odds: [0.5, 0.7, 0.3],
    scores: [[0, 0], [7, 0], [7, 12]],
    events: [
      { t: 1, desc: 'A touchdown for a', players: [{ side: 'a', name: 'X', pts: 7 }], before: 0.5, after: 0.7 },
      { t: 2, desc: 'A long touchdown for b', players: [{ side: 'b', name: 'Y', pts: 12 }], before: 0.7, after: 0.3 },
      { t: 3, desc: null, players: [{ side: 'a', name: 'Z', pts: 30 }], before: 0.3, after: 0.95 },
    ],
  };
  const names = (id: number) => (id === 10 ? 'Team A' : 'Team B');

  it("picks the play that moved the odds most, from the side it helped, never one without its play", () => {
    const s = biggestSwing(h, names)!;
    expect(s).toMatchObject({ desc: 'A long touchdown for b', players: ['Y'], team: 'Team B' });
    expect(s.from).toBeCloseTo(0.3);
    expect(s.to).toBeCloseTo(0.7);
    expect(biggestSwing({ ...h, events: [] }, names)).toBeNull();
  });

  it("reads an image's real format from its bytes, not its label", () => {
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg');
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(imageType(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();
  });

  it("reads a share link's week and matchup", () => {
    expect(readLinkTarget('?season=2026&week=8&matchup=2')).toEqual({ week: 8, matchup: 2 });
    expect(readLinkTarget('?week=8')).toEqual({ week: 8, matchup: null });
    expect(readLinkTarget('?tab=stats')).toBeNull();
    expect(readLinkTarget('?week=40')).toBeNull();
  });

  const game = (status: 'final' | 'live', sa: number, sb: number): ShareMatchup => ({
    season: '2026',
    week: 8,
    matchupId: 2,
    status,
    a: { rosterId: 1, name: 'A', username: 'a', avatarUrl: null, score: sa, projected: null },
    b: { rosterId: 2, name: 'B', username: 'b', avatarUrl: null, score: sb, projected: null },
    odds: [0.5, 0.8],
    swing: null,
    leadChanges: 0,
  });

  it("puts the sharer's team first, else a finished game's winner, else Sleeper's order", () => {
    const sharerB = oriented(game('live', 90, 80), 2);
    expect([sharerB.a.rosterId, sharerB.b.rosterId]).toEqual([2, 1]);
    // The odds line turns with it
    expect(sharerB.odds![1]).toBeCloseTo(0.2);
    expect(oriented(game('final', 80, 90), 1).a.rosterId).toBe(1);
    expect(oriented(game('final', 80, 90), null).a.rosterId).toBe(2);
    // Someone else's team, or a live game with nobody named: as Sleeper lists it
    expect(oriented(game('final', 90, 80), 7).a.rosterId).toBe(1);
    expect(oriented(game('live', 80, 90), null).a.rosterId).toBe(1);
  });

  it("reads the sharer's roster from the link", () => {
    expect(firstSide('3')).toBe(3);
    expect(firstSide(null)).toBeNull();
    expect(firstSide('x')).toBeNull();
  });

  it("splits the odds line where it crosses 50%, so each piece takes one team's color", () => {
    // 0.7 -> 0.3 crosses halfway between the two samples
    const pieces = oddsSegments([0.7, 0.3, 0.2], 100, 100);
    expect(pieces.map(([, above]) => above)).toEqual([true, false]);
    expect(pieces[0][0]).toBe('0.0,30.0 25.0,50.0');
    expect(pieces[1][0]).toBe('25.0,50.0 50.0,70.0 100.0,80.0');
    expect(oddsSegments([0.6, 0.8], 10, 10)).toHaveLength(1);
  });
});
