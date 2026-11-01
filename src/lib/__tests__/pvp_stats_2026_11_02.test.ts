import { describe, expect, it } from 'vitest';
import { aggregate, byDay, cumulativeChips, headToHead, rolling, type PvpMatch, type PvpRow } from '../pvpStats';

const row = (placement: number, o: Partial<PvpRow> = {}): PvpRow => ({
  seat: 0, incomplete: 0, rounds: 4, riichi: 1, fever_riichi: 0, furo_rounds: 1, ankan: 0, nuki: 2,
  wins: 1, tsumo_wins: 1, ron_wins: 0, deal_ins: 0, points_won: 8000, points_dealt_in: 0, hule_chips: 0,
  placement, final_defen: 30000, ...o,
});

const M: PvpMatch[] = [
  { id: 1, at: '2026-11-01 14:00:00', room: 'R', no: 1, chips: { a: 30, b: -10, c: -20 }, p: { a: row(1), b: row(2), c: row(3) } },
  { id: 2, at: '2026-11-01 14:30:00', room: 'R', no: 2, chips: { a: 20, b: -5, c: -10, d: -5 }, p: { a: row(1), b: row(2), c: row(3) } },
  { id: 3, at: '2026-11-01 15:30:00', room: 'R', no: 3, chips: { a: -40, b: 50, c: -10 }, p: { a: row(3, { deal_ins: 2 }), b: row(1), c: row(2) } },
];

describe('pvpStats', () => {
  it('aggregate: 順位・連続トップ・チップは抜け番も足す', () => {
    const ps = aggregate(M, { a: 'A' });
    const a = ps.find((p) => p.uid === 'a')!;
    expect(a.name).toBe('A');
    expect(a.games).toBe(3);
    expect(a.place).toEqual([2, 0, 1]);
    expect(a.topStreak).toBe(2);
    expect(a.chipTotal).toBe(10);
    expect(a.chipBest).toBe(30);
    expect(a.chipWorst).toBe(-40);
    expect(a.dealIns).toBe(2);
    const d = ps.find((p) => p.uid === 'd')!;
    expect(d.games).toBe(0);
    expect(d.chipTotal).toBe(-5);
    expect(ps[ps.length - 1].uid).toBe('d');
    expect(ps.reduce((s, p) => s + p.chipTotal, 0)).toBe(0);
  });

  it('cumulativeChips: 通し番号で累計', () => {
    expect(cumulativeChips(M, 'a')).toEqual([{ x: 1, y: 30 }, { x: 2, y: 50 }, { x: 3, y: 10 }]);
    expect(cumulativeChips(M, 'd')).toEqual([{ x: 2, y: -5 }]);
  });

  it('rolling: window 試合そろってから', () => {
    expect(rolling(M, 'a', 'place', 2)).toEqual([{ x: 2, y: 1 }, { x: 3, y: 2 }]);
    expect(rolling(M, 'a', 'dealin', 3)).toEqual([{ x: 3, y: 2 / 12 }]);
    expect(rolling(M, 'd', 'place', 1)).toEqual([]);
  });

  it('headToHead と byDay [日本時間で日が変わる]', () => {
    expect(headToHead(M, 'a', 'b')).toEqual({ n: 3, above: 2, chipDiff: 10 - 35 });
    const days = byDay(M);
    expect(days.map((d) => d.day)).toEqual(['2026-11-02', '2026-11-01']);
    expect(days[0].matches.map((x) => x.idx)).toEqual([3]);
    expect(days[1].chips.a).toBe(50);
  });
});
