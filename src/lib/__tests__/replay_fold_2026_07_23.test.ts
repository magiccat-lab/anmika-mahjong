import { describe, expect, it } from 'vitest';
import { foldPaifu, mianziConsumedTiles } from '../replay';

// [2026-07-23 リョー要望 名牌譜] 牌譜 fold の検証:
// - authoritative 牌譜 [qipai.tiles あり] で手牌が追える
// - 旧 client 牌譜 [qipai.count のみ / 他家マスク] でも 'back' で壊れず進む
// - 局境界 [qipai 連続] と hule での局ラベル確定

describe('mianziConsumedTiles', () => {
  it('ポン: 方向マーカー直前 [鳴いた牌] を除いた 2 枚', () => {
    expect(mianziConsumedTiles('z111-')).toEqual(['z1', 'z1']);
    expect(mianziConsumedTiles('p444-')).toEqual(['p4', 'p4']);
  });
  it('暗槓: 4 枚全部', () => {
    expect(mianziConsumedTiles('z1111')).toEqual(['z1', 'z1', 'z1', 'z1']);
  });
});

describe('foldPaifu', () => {
  it('authoritative 牌譜: 配牌→ツモ→打牌で手牌と河が追える', () => {
    const rounds = foldPaifu([
      { type: 'qipai', player: 0, tiles: ['m1', 'm2', 'm3'] },
      { type: 'qipai', player: 1, tiles: ['p1', 'p2', 'p3'] },
      { type: 'qipai', player: 2, tiles: ['s1', 's2', 's3'] },
      { type: 'zimo', player: 0, pai: 'm4' },
      { type: 'dapai', player: 0, pai: 'm1' },
      { type: 'lizhi', player: 1, fever: true },
      { type: 'dapai', player: 1, pai: 'p1' },
      {
        type: 'hule', player: 1, isRon: false, defen: 8000, jushu: 0, changbang: 0, benbang: 0,
        hupai: [{ name: '立直', fanshu: 1 }],
        defenAfter: { 0: 21000, 1: 33000, 2: 21000 },
      },
    ]);
    expect(rounds).toHaveLength(1);
    const r = rounds[0];
    expect(r.label).toBe('東1局');
    // 配牌 step
    expect(r.steps[0].eventType).toBe('qipai');
    expect(r.steps[0].seats[0].hand).toEqual(['m1', 'm2', 'm3']);
    // ツモ後
    expect(r.steps[1].seats[0].hand).toEqual(['m1', 'm2', 'm3', 'm4']);
    // 打牌後: 手牌から消えて河に乗る
    expect(r.steps[2].seats[0].hand).toEqual(['m2', 'm3', 'm4']);
    expect(r.steps[2].seats[0].river).toEqual([{ pai: 'm1', riichi: false }]);
    // フィーバーリーチ badge + 宣言後最初の打牌が riichi 牌
    expect(r.steps[3].seats[1].riichi).toBe('fever');
    expect(r.steps[4].seats[1].river[0].riichi).toBe(true);
    // hule: defen 反映
    const last = r.steps[r.steps.length - 1];
    expect(last.seats[1].defen).toBe(33000);
    expect(last.desc).toContain('ツモ');
    expect(last.desc).toContain('8,000点');
  });

  it('旧 client 牌譜 [count のみ] は back で進み、除去も許容的', () => {
    const rounds = foldPaifu([
      { type: 'qipai', player: 0, count: 13 },
      { type: 'qipai', player: 1, count: 13 },
      { type: 'qipai', player: 2, count: 13 },
      { type: 'zimo', player: 1, pai: 'p4' },
      { type: 'dapai', player: 1, pai: 'p9' }, // 手牌に無い牌 → back を 1 枚消費
    ]);
    const r = rounds[0];
    expect(r.steps[0].seats[1].hand).toHaveLength(13);
    expect(r.steps[0].seats[1].hand[0]).toBe('back');
    expect(r.steps[1].seats[1].hand).toHaveLength(14);
    expect(r.steps[2].seats[1].hand).toHaveLength(13);
    expect(r.steps[2].seats[1].river.map((x) => x.pai)).toEqual(['p9']);
  });

  it('複数局: qipai 連続で局が切れ、ポンで河から消える', () => {
    const rounds = foldPaifu([
      { type: 'qipai', player: 0, tiles: ['z1', 'z1'] },
      { type: 'qipai', player: 1, tiles: ['m1'] },
      { type: 'qipai', player: 2, tiles: ['s1'] },
      { type: 'zimo', player: 1, pai: 'z1' },
      { type: 'dapai', player: 1, pai: 'z1' },
      { type: 'fulou', player: 0, from: 1, mianzi: 'z111-', pai: 'z1' },
      { type: 'qipai', player: 0, tiles: ['m9'] },
      { type: 'qipai', player: 1, tiles: ['p9'] },
      { type: 'qipai', player: 2, tiles: ['s9'] },
      { type: 'pingju', reason: '山切れ' },
    ]);
    expect(rounds).toHaveLength(2);
    const r1 = rounds[0];
    const ponStep = r1.steps[r1.steps.length - 1];
    expect(ponStep.desc).toContain('ポン');
    expect(ponStep.seats[0].melds).toEqual(['z111-']);
    expect(ponStep.seats[0].hand).toEqual([]); // 対子 z1z1 を消費
    expect(ponStep.seats[1].river).toEqual([]); // 鳴かれて河から消えた
    expect(rounds[1].steps[0].seats[0].hand).toEqual(['m9']);
  });

  it('北抜き event で hand から z4 が抜けて nuki が増える', () => {
    const rounds = foldPaifu([
      { type: 'qipai', player: 0, tiles: ['z4', 'm1'] },
      { type: 'qipai', player: 1, tiles: [] },
      { type: 'qipai', player: 2, tiles: [] },
      { type: 'nukiBei', player: 0, gold: false, replacement: 'p7' },
    ]);
    const last = rounds[0].steps[rounds[0].steps.length - 1];
    expect(last.seats[0].nuki).toBe(1);
    expect(last.seats[0].hand).toEqual(['m1', 'p7']);
  });

  it('ゴミ入力に耐える', () => {
    expect(foldPaifu(null)).toEqual([]);
    expect(foldPaifu([null, 42, { type: 'zimo' }, { type: 'unknown', player: 0 }])).toEqual([]);
  });
});
