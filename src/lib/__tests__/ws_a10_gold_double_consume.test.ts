import { describe, it, expect } from 'vitest';
import { emptyGoldHand, resolveGoldDiscardFlag } from '../game3/gold';
import type { GoldHand, LastZimoGoldInfo } from '../game3/gold';
import type { PlayerId } from '../types';

// WSA-A10: resolveGoldDiscardFlag の金消費二重呼び出し回帰。
// 物理金牌 [gp/gs/gN] と metaGold / lastZimo 一致 / fallback が重なっても、
// 手持ち金の消費は 1 枚まで [codex 検証 2026-07-15: 残2枚が実際に2枚減っていた]。

const noZimo: LastZimoGoldInfo = { player: null, pai: null, gold: false };

function hand(p = 0, s = 0, z = 0): GoldHand {
  const h = emptyGoldHand();
  h.p = p;
  h.s = s;
  h.z = z;
  return h;
}

describe('WSA-A10 gold double consume', () => {
  it('metaGold=true + 物理金牌 でも消費は1枚 [旧実装は2枚減]', () => {
    const h = hand(2);
    const isGold = resolveGoldDiscardFlag({
      player: 0 as PlayerId,
      corePai: 'p0',
      paiForHand: 'gp',
      metaGold: true,
      hand: h,
      lastZimoInfo: noZimo,
    });
    expect(isGold).toBe(true);
    expect(h.p).toBe(1);
  });

  it('lastZimo 金一致 + 物理金牌 でも消費は1枚', () => {
    const h = hand(0, 2);
    const isGold = resolveGoldDiscardFlag({
      player: 0 as PlayerId,
      corePai: 's0',
      paiForHand: 'gs',
      hand: h,
      lastZimoInfo: { player: 0 as PlayerId, pai: 'gs', gold: true },
    });
    expect(isGold).toBe(true);
    expect(h.s).toBe(1);
  });

  it('fallback [hand>0] + 物理金牌 でも消費は1枚', () => {
    const h = hand(2);
    const isGold = resolveGoldDiscardFlag({
      player: 0 as PlayerId,
      corePai: 'p0',
      paiForHand: 'gp',
      hand: h,
      lastZimoInfo: noZimo,
    });
    expect(isGold).toBe(true);
    expect(h.p).toBe(1);
  });

  it('metaGold=true のみ [物理牌ナシ] は従来どおり1枚消費', () => {
    const h = hand(2);
    const isGold = resolveGoldDiscardFlag({
      player: 0 as PlayerId,
      corePai: 'p0',
      paiForHand: 'p0',
      metaGold: true,
      hand: h,
      lastZimoInfo: noZimo,
    });
    expect(isGold).toBe(true);
    expect(h.p).toBe(1);
  });

  it('metaGold=false + 物理金牌 は isGold=true で1枚消費 [従来挙動維持]', () => {
    const h = hand(1);
    const isGold = resolveGoldDiscardFlag({
      player: 0 as PlayerId,
      corePai: 'p0',
      paiForHand: 'gp',
      metaGold: false,
      hand: h,
      lastZimoInfo: noZimo,
    });
    expect(isGold).toBe(true);
    expect(h.p).toBe(0);
  });

  it('metaGold=false + 物理牌ナシ は消費ゼロ・isGold=false', () => {
    const h = hand(2);
    const isGold = resolveGoldDiscardFlag({
      player: 0 as PlayerId,
      corePai: 'p0',
      paiForHand: 'p0',
      metaGold: false,
      hand: h,
      lastZimoInfo: noZimo,
    });
    expect(isGold).toBe(false);
    expect(h.p).toBe(2);
  });

  it('残1枚で経路が重なっても負数にならない', () => {
    const h = hand(1);
    const isGold = resolveGoldDiscardFlag({
      player: 0 as PlayerId,
      corePai: 'p0',
      paiForHand: 'gp',
      metaGold: true,
      hand: h,
      lastZimoInfo: noZimo,
    });
    expect(isGold).toBe(true);
    expect(h.p).toBe(0);
  });
});
