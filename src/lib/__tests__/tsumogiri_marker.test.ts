import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 機能 1 [手出し / ツモ切り 区別] 2026-05-15
//   discardLog entry の tsumogiri flag を 検証。
//   - 直前 zimo と同じ pai を切る → tsumogiri=true
//   - 手の中の他牌を切る → tsumogiri=false
describe('discardLog tsumogiri flag', () => {
  it('ツモ牌をそのまま切ると tsumogiri=true', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // 手牌固定 + 任意の牌をツモ
    g.shoupai.set(player, buildShoupai(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('s9');
    g.lastZimoInfo = { player, pai: 's9', pochi: null, gold: false };
    g.dapai('s9');
    const log = g.discardLog[player];
    expect(log.length).toBe(1);
    expect(log[0].pai).toBe('s9');
    expect(log[0].tsumogiri).toBe(true);
  });

  it('手の中から別の牌を切ると tsumogiri=false [手出し]', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    g.shoupai.set(player, buildShoupai(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('s9');
    g.lastZimoInfo = { player, pai: 's9', pochi: null, gold: false };
    // ツモは s9、 手出しで p1 を切る
    g.dapai('p1');
    const log = g.discardLog[player];
    expect(log.length).toBe(1);
    expect(log[0].pai).toBe('p1');
    expect(log[0].tsumogiri).toBe(false);
  });
});
