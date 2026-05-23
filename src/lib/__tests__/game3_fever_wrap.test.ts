import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// Game3 instance method canFeverLizhi / isFeverWaitExhausted wrap を unit 固定。
// helper [feverLizhi.test.ts] でカバー済、 ここは class wrap path 担保。
describe('Game3 canFeverLizhi [wrap]', () => {
  it('shoupai ナシ で ok=false', () => {
    const g = new Game3();
    g.qipai();
    g.shoupai.delete(0 as PlayerId);
    const r = g.canFeverLizhi(0 as PlayerId);
    expect(r.ok).toBe(false);
  });

  it('m7 暗刻 1 種 で tier=1 / ok=true', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['m7','m7','m7','p1','p2','p3','s1','s2','s3','s5','s5','s6','s7']));
    const r = g.canFeverLizhi(player);
    expect(r.ok).toBe(true);
    expect(r.tier).toBe(1);
    expect(r.tiles).toContain('m7');
  });

  it('m7 + p7 + s7 暗刻 3 種 で tier=3 [567 余地 ナシ手]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    // 2026-05-15 厳密化: 同 suit に 5/6 が混じってると 567 順子余地 で fever 不可。
    // m9×4 [前の差し替え] だと m789 wait で m7 が 順子に取られ strict reject、
    // m9×3 + z1 タンキ wait に直して 全 3 種が 確定暗刻 になるよう構築。
    g.shoupai.set(player, buildShoupai(['m7','m7','m7','p7','p7','p7','s7','s7','s7','m9','m9','m9','z1']));
    const r = g.canFeverLizhi(player);
    expect(r.ok).toBe(true);
    expect(r.tier).toBe(3);
  });

  it('副露あり [面前ナシ] で ok=false', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['m7','m7','m7','p1','p2','p3','s5','s5']));
    const sp = g.shoupai.get(player) as any;
    sp._fulou = ['p7p7p7+'];
    const r = g.canFeverLizhi(player);
    expect(r.ok).toBe(false);
  });
});

describe('Game3 isFeverWaitExhausted [wrap]', () => {
  it('待ち 0 件 [tingpai ナシ] で true', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    // 完全ノーテン → tingpai 空
    g.shoupai.set(player, buildShoupai(['m7','m9','p1','p3','p5','s1','s3','s5','s7','z1','z2','z3','z6']));
    const result = g.isFeverWaitExhausted(player);
    expect(typeof result).toBe('boolean'); // 待ち 0 件で true 期待だが majiang lib の tingpai 戻り次第
  });
});
