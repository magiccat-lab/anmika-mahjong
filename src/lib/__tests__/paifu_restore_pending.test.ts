import { describe, expect, it } from 'vitest';
import { buildShoupai } from '../game3';
import { buildStateFromPaifu } from '../store/paifuIo';

function serializeShoupai(sp: any) {
  return {
    bingpai: {
      _: sp._bingpai._ ?? 0,
      m: [...sp._bingpai.m],
      p: [...sp._bingpai.p],
      s: [...sp._bingpai.s],
      z: [...sp._bingpai.z],
    },
    fulou: [...(sp._fulou ?? [])],
    zimo: sp._zimo ?? null,
  };
}

function basePaifu(overrides: Record<string, any>) {
  return {
    type: 'anmika-mahjong-paifu',
    version: 2,
    timestamp: 'pending-test',
    shan: { currentPai: ['s1','s2'], initialPai: [], baopai: [], fubaopai: [], rinshan: ['m1','m2','m3','m4'], rinshanUsed: 0, kanDoraCount: 0 },
    state: {
      qijia: 0,
      lunban: 0,
      jushu: 0,
      changbang: 0,
      benbang: 0,
      defen: { 0: 35000, 1: 35000, 2: 35000 },
      lizhibang: 0,
      finished: false,
    },
    shoupai: {
      0: serializeShoupai(buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8'])),
      1: serializeShoupai(buildShoupai(['m7','m9','p1','p3','p5','s1','s3','s5','s7','z1','z2','z3','z6'])),
      2: serializeShoupai(buildShoupai(['m7','m9','p1','p3','p5','s1','s3','s5','s7','z1','z2','z3','z6'])),
    },
    he: { 0: [], 1: ['s8'], 2: [] },
    events: [{ type: 'dapai', player: 1, pai: 's8' }],
    lizhi: [0],
    ...overrides,
  };
}

describe('buildStateFromPaifu pending action restore', () => {
  it('restores ron decision after a saved discard', () => {
    const s = buildStateFromPaifu(basePaifu({}));
    expect(s).not.toBeNull();
    expect(s!.lastDapai).toEqual({ player: 1, pai: 's8' });
    expect(s!.awaitingRonDecision).toBe(true);
    expect(s!.message).toContain('ロン可能');
  });

  it('restores pon/damingang decision after a saved discard with no ron', () => {
    const p0 = buildShoupai(['p7','p7','p7','p1','p2','p3','s1','s2','s3','s7','s8','s9','m9']);
    const s = buildStateFromPaifu(basePaifu({
      shoupai: {
        0: serializeShoupai(p0),
        1: serializeShoupai(buildShoupai(['m7','m9','p1','p3','p5','s1','s3','s5','s7','z1','z2','z3','z6'])),
        2: serializeShoupai(buildShoupai(['m7','m9','p1','p3','p5','s1','s3','s5','s7','z1','z2','z3','z6'])),
      },
      he: { 0: [], 1: ['p7'], 2: [] },
      events: [{ type: 'dapai', player: 1, pai: 'p7' }],
      lizhi: [],
    }));
    expect(s).not.toBeNull();
    expect(s!.lastDapai).toEqual({ player: 1, pai: 'p7' });
    expect(s!.awaitingFulou).toBe(true);
    expect(s!.kanCandidates.some((c) => c.player === 0 && c.mianzi.length > 0)).toBe(true);
  });

  it('restores the v2 kan-dora limit and preserves disabled ura-dora', () => {
    const paifu = basePaifu({});
    paifu.shan.kanDoraCount = 3;
    paifu.shan.fubaopai = null;
    const s = buildStateFromPaifu(paifu);

    expect(s).not.toBeNull();
    expect(s!.game.shan.kanDoraCount).toBe(3);
    expect((s!.game.shan as any)._fubaopai).toBeNull();
  });
});
