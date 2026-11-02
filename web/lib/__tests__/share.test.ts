import { describe, expect, it } from 'vitest';
import { biggestSwing, leadChanges } from '../shareData';
import { imageType } from '../shareImage';
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
});
