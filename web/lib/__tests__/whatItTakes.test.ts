import { describe, expect, it } from 'vitest';
import { matchupModels, remainingDistribution, RP_STEP, type LiveGame, type LiveProjection } from '../analyze/live';
import { gameScriptNote, needLine, oddsIfAdds, outcomes, playerSwings, sideQuantile, swaps, target } from '../analyze/whatItTakes';
import type { SleeperMatchup } from '../types';

const proj = (points: number, team: string, position = 'WR', spreadRatio = 0.6): LiveProjection => ({ points, team, spreadRatio, name: 'P', position, injury: null });
const sm = (roster_id: number, points: number, starters: string[], players: string[] = starters): SleeperMatchup => ({ roster_id, matchup_id: 1, points, starters, players });
const game = (state: LiveGame['state'], remaining: number, extra: Partial<LiveGame> = {}): LiveGame => ({ state, remaining, label: '', ...extra });


describe('what it takes', () => {
  // Both sides with players still to play: the normal model
  const projections = { a1: proj(15, 'AAA'), a2: proj(12, 'CCC', 'RB'), b1: proj(18, 'BBB'), b2: proj(10, 'DDD', 'TE') };
  const games = { AAA: game('in', 0.5), CCC: game('pre', 1), BBB: game('in', 0.6), DDD: game('pre', 1) };
  const both = matchupModels([sm(1, 60, ['a1', 'a2']), sm(2, 65, ['b1', 'b2'])], projections, games, 25)[0];

  it("agrees with the card's odds: a side's odds over its own possible totals average to them", () => {
    // Integrate oddsIfAdds over a's remaining total (its normal curve in this case)
    const mu = both.a.s.projected - both.a.s.score;
    const sd = Math.sqrt(both.a.variance);
    let total = 0;
    let weight = 0;
    for (let z = -6; z <= 6; z += 0.01) {
      const w = Math.exp(-0.5 * z * z);
      total += w * oddsIfAdds(both, 'a', mu + z * sd);
      weight += w;
    }
    expect(total / weight).toBeCloseTo(both.aWinOdds, 3);
    // And from b's side
    total = 0;
    weight = 0;
    const muB = both.b.s.projected - both.b.s.score;
    const sdB = Math.sqrt(both.b.variance);
    for (let z = -6; z <= 6; z += 0.01) {
      const w = Math.exp(-0.5 * z * z);
      total += w * oddsIfAdds(both, 'b', muB + z * sdB);
      weight += w;
    }
    expect(total / weight).toBeCloseTo(1 - both.aWinOdds, 3);
  });

  it('needs what the other side is expected to finish with, and a range from its players', () => {
    const t = target(both, 'a')!;
    expect(t.exact).toBe(false);
    expect(t.favored).toBeCloseTo(both.b.s.projected - both.a.s.score, 6);
    expect(t.low).toBeLessThan(t.favored);
    expect(t.high).toBeGreaterThan(t.favored);
    expect(oddsIfAdds(both, 'a', t.low)).toBeCloseTo(0.25, 4);
  });

  it('gives better odds for a better day, the typical day at the median', () => {
    const [bad, typical, great] = outcomes(both, 'a');
    expect(bad.adds).toBeLessThan(typical.adds);
    expect(great.adds).toBeGreaterThan(typical.adds);
    expect(bad.odds).toBeLessThan(typical.odds);
    expect(great.odds).toBeGreaterThan(typical.odds);
    expect(typical.adds).toBeCloseTo(both.a.s.projected - both.a.s.score, 4);
  });

  it("ranks players by how much they swing it, each side's own way", () => {
    const swings = playerSwings(both);
    expect(swings).toHaveLength(4);
    for (const s of swings) expect(Math.sign(s.aSwing)).toBe(s.side === 'a' ? 1 : -1);
    for (let i = 1; i < swings.length; i++) expect(Math.abs(swings[i - 1].aSwing)).toBeGreaterThanOrEqual(Math.abs(swings[i].aSwing));
    for (const s of swings) expect(s.high).toBeGreaterThan(s.low);
  });

  // One side done: the exact need, from the players' real distributions
  const oneSided = matchupModels(
    [sm(1, 80, ['a1']), sm(2, 92, ['b1'])],
    { a1: proj(14, 'AAA'), b1: proj(10, 'BBB') },
    { AAA: game('in', 0.5), BBB: game('post', 0) },
    25
  )[0];

  it('needs exactly the deficit once the other side is done, at the odds shown', () => {
    expect(oneSided.weight).toBe(1);
    const t = target(oneSided, 'a')!;
    expect(t).toMatchObject({ exact: true, favored: 12 });
    expect(target(oneSided, 'b')).toBeNull();
    expect(needLine(oneSided)).toMatchObject({ side: 'a', need: 12, players: 1, exact: true });
    // Adding 12+ wins (ties smoothed over half a point, as the model does)
    const pAt = (x: number) => oddsIfAdds(oneSided, 'a', x);
    expect(pAt(13)).toBeGreaterThan(0.99);
    expect(pAt(11)).toBeLessThan(0.01);
    // Averaged over his real distribution, the odds shown
    let avg = 0;
    for (const [k, p] of remainingDistribution(oneSided.a.players, oneSided.a.defenses)) avg += p * pAt(k * RP_STEP);
    expect(avg).toBeCloseTo(oneSided.aWinOdds, 6);
    // Its typical rest of the game: the player tables' median, not the normal's mean
    expect(sideQuantile(oneSided, 'a', 0.5)).toBeLessThan(7);
  });

  it('says nothing once the side still playing already leads a finished opponent', () => {
    const ahead = matchupModels([sm(1, 100, ['a1']), sm(2, 92, ['b1'])], { a1: proj(14, 'AAA'), b1: proj(10, 'BBB') }, { AAA: game('in', 0.5), BBB: game('post', 0) }, 25)[0];
    expect(needLine(ahead)).toBeNull();
  });

  it('says nothing before anyone has played', () => {
    const pre = matchupModels([sm(1, 0, ['a1']), sm(2, 0, ['b1'])], { a1: proj(14, 'AAA'), b1: proj(10, 'BBB') }, { AAA: game('pre', 1), BBB: game('pre', 1) }, 25)[0];
    expect(needLine(pre)).toBeNull();
  });

  it('finds open lineup swaps that help, and none for players already playing', () => {
    const projections = { a1: proj(4, 'AAA'), a2: proj(16, 'CCC'), a3: proj(20, 'EEE'), b1: proj(18, 'BBB') };
    const games = { AAA: game('pre', 1), CCC: game('pre', 1), EEE: game('in', 0.5), BBB: game('pre', 1) };
    const matchups = [sm(1, 50, ['a1'], ['a1', 'a2', 'a3']), sm(2, 50, ['b1'])];
    const model = matchupModels(matchups, projections, games, 25)[0];
    const open = swaps(model, 'a', matchups, projections, games, ['WR']);
    // a2 (16, not started) for a1 (4); a3's game has started, so he can't come in
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ slot: 0, out: 'a1', in: 'a2' });
    expect(open[0].after).toBeGreaterThan(open[0].before + 0.1);
    // A slot that doesn't take his position
    expect(swaps(model, 'a', matchups, projections, games, ['RB'])).toHaveLength(0);
  });

  it('notes game script only for receivers late in a lopsided game', () => {
    expect(gameScriptNote('WR', game('in', 0.3, { score: 31, opponentScore: 7 }))).toMatch(/^Up 24/);
    expect(gameScriptNote('TE', game('in', 0.3, { score: 3, opponentScore: 27 }))).toMatch(/^Down 24/);
    expect(gameScriptNote('RB', game('in', 0.3, { score: 31, opponentScore: 7 }))).toBeNull();
    expect(gameScriptNote('WR', game('in', 0.7, { score: 31, opponentScore: 7 }))).toBeNull();
    expect(gameScriptNote('WR', game('in', 0.3, { score: 20, opponentScore: 7 }))).toBeNull();
  });
});
