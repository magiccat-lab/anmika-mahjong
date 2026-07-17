import { describe, expect, it } from 'vitest';
import { Game3 } from '../game3';
import { Shan3, defaultSanmaRule, generateTilePool } from '../shan3';

function fourKanGoldenPool(): string[] {
  const remaining = generateTilePool(defaultSanmaRule()).map(String);
  const take = (pai: string): string => {
    const index = remaining.indexOf(pai);
    if (index < 0) throw new Error(`fixed pool is missing ${pai}`);
    return remaining.splice(index, 1)[0];
  };
  const takeNonHua = (): string => {
    const index = remaining.findIndex((pai) => !pai.startsWith('f'));
    if (index < 0) throw new Error('fixed pool has no non-huapai tile');
    return remaining.splice(index, 1)[0];
  };

  // Dealer starts with three quads and one 5p. The regular draw and first two
  // kan replacements complete the fourth 5p quad; the last two replacements
  // form the pair needed for a four-kans win.
  const dealerHand = [
    'p1', 'p1', 'p1', 'p1',
    'p2', 'p2', 'p2', 'p2',
    'p4', 'p4', 'p4', 'p4',
    'p5',
  ].map(take);
  const dealerDraw = take('p0');
  const kanReplacements = ['gp', 'p5', 'z1', 'z1'].map(take);

  // Shan3 removes original indexes 4..7 as the initial front/back indicators,
  // then reserves the first 16 remaining tiles for rinshan.
  const initialIndicators = Array.from({ length: 4 }, takeNonHua);
  const restOfRinshan = Array.from({ length: 12 }, takeNonHua);
  const otherHands = Array.from({ length: 26 }, takeNonHua);
  const drawSequence: string[] = [];
  for (let i = 0; i < 13; i++) {
    drawSequence.push(dealerHand[i], otherHands[i], otherHands[i + 13]);
  }
  drawSequence.push(dealerDraw);

  return [
    ...kanReplacements,
    ...initialIndicators,
    ...restOfRinshan,
    ...remaining,
    ...drawSequence.reverse(),
  ];
}

function openKanDora(shan: Shan3): void {
  shan.gangzimo();
  shan.kaigang();
}

describe('WSA-A2 kan-derived dora limit', () => {
  it('allows four kans even after two autumn dora additions and rejects the fifth', () => {
    const shan = new Shan3(defaultSanmaRule(), generateTilePool(defaultSanmaRule()));
    shan.drawNewDora(false);
    shan.drawNewDora(false);

    for (let i = 0; i < 4; i++) expect(() => openKanDora(shan)).not.toThrow();
    expect(shan.kanDoraCount).toBe(4);
    expect(() => shan.gangzimo()).toThrow(/4 kan dora max/);
  });

  it('includes the kan dora count in snapshot and restore', () => {
    const shan = new Shan3(defaultSanmaRule(), generateTilePool(defaultSanmaRule()));
    openKanDora(shan);
    openKanDora(shan);
    const snapshot = shan.snapshot();

    openKanDora(shan);
    expect(shan.kanDoraCount).toBe(3);
    shan.restore(snapshot);
    expect(shan.kanDoraCount).toBe(2);
  });

  it('hides kan candidates once four kan dora have been opened', () => {
    const game = new Game3({ qijia: 0, preShuffledPool: fourKanGoldenPool() });
    game.qipai();
    game.zimo();
    expect(game.getKanCandidates(0)).toContain('p1111');

    for (let i = 0; i < 4; i++) openKanDora(game.shan);
    expect(game.getKanCandidates(0)).toEqual([]);
  });

  it('reaches the four-kans double-yakuman path through four legal declarations', () => {
    const game = new Game3({ qijia: 0, preShuffledPool: fourKanGoldenPool() });
    game.qipai();
    expect(game.zimo()).toBe('p0');

    for (const expected of ['p1111', 'p2222', 'p4444']) {
      expect(game.getKanCandidates(0)).toContain(expected);
      expect(game.declareKan(0, expected)).not.toBeNull();
    }
    const fourth = game.getKanCandidates(0).find((mianzi) => /^p[50]{4}$/.test(mianzi));
    expect(fourth).toBeDefined();
    expect(game.declareKan(0, fourth!)).toBe('z1');
    expect(game.shan.kanDoraCount).toBe(4);

    game.lizhi.add(0);
    const result = game.hule(0);
    expect(result).not.toBeNull();
    expect(result!.hupai.map((h: { name: string }) => h.name)).toContain('四槓子 [ダブル役満]');
  });
});
