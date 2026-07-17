import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { Shan3 } from '../shan3';
import type { PlayerId } from '../types';

// getPonCandidates / getKanCandidates の挙動を unit 固定。
// 反時計周り [P0→P2→P1] 方向計算 fix [89d024b] regression 防衛。
describe('Game3 getPonCandidates', () => {
  it('shoupai ナシ で 空配列', () => {
    const g = new Game3();
    g.qipai();
    g.shoupai.delete(0 as PlayerId);
    expect(g.getPonCandidates(0 as PlayerId, 1 as PlayerId, 'p7')).toEqual([]);
  });

  it('リーチ中 player は ポン不可 [空配列]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9','m9']));
    g.lizhi.add(player);
    expect(g.getPonCandidates(player, 1 as PlayerId, 'p7')).toEqual([]);
  });

  it('北抜き直後 [justNukidBei] の他家ポン不可', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const from = 1 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9','m9']));
    g.justNukidBei[from] = true;
    expect(g.getPonCandidates(player, from, 'p7')).toEqual([]);
  });

  it('同 player ロン [diff=0] は 空配列 [自家打牌からポンしない]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9','m9']));
    expect(g.getPonCandidates(player, 0 as PlayerId, 'p7')).toEqual([]);
  });

  it('上家 [反時計 diff=1] からの打牌 候補返却 [候補は 1+ 件]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const from = 1 as PlayerId; // diff=(1-0+3)%3=1 → 上家
    g.shoupai.set(player, buildShoupai(['p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9','m9']));
    const cands = g.getPonCandidates(player, from, 'p7');
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]).toMatch(/p7+\+/); // 上家 = + mark
  });

  it('下家 [反時計 diff=2] からの打牌 候補は - mark', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const from = 2 as PlayerId; // diff=(2-0+3)%3=2 → 下家
    g.shoupai.set(player, buildShoupai(['p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9','m9']));
    const cands = g.getPonCandidates(player, from, 'p7');
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]).toMatch(/p7+-/);
  });
});

describe('Game3 getKanCandidates', () => {
  it('shoupai ナシ で 空配列', () => {
    const g = new Game3();
    g.qipai();
    g.shoupai.delete(0 as PlayerId);
    expect(g.getKanCandidates(0 as PlayerId)).toEqual([]);
  });

  it('他家フィーバー中 [自家非フィーバー] で 空配列', () => {
    const g = new Game3();
    g.qipai();
    g.feverActive[1] = true;
    expect(g.getKanCandidates(0 as PlayerId)).toEqual([]);
  });

  it('自家フィーバー中なら 自家 candidate 返却される', () => {
    const g = new Game3();
    g.qipai();
    g.feverActive[0] = true;
    // 結果 array は majiang-core 任せ、 空配列 / 1+ 件 のいずれか [throw しないこと]
    expect(Array.isArray(g.getKanCandidates(0 as PlayerId))).toBe(true);
  });

  it('オンライン投影の blind 山でも合法な自己暗槓候補を隠さない', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const sp = buildShoupai([
      'z5b','z5r','z5g',
      'p1','p2','p3','p4','p5','p6','s1','s2','s3','z1',
    ]);
    sp.zimo('z5y');
    g.shoupai.set(player, sp);
    g.shan = Shan3.createBlind({
      rule: g.shanRule,
      baopai: ['p1', 's1'],
      fubaopai: null,
      paishu: 3,
    });
    g.shan.rinshanUsed = 0;

    expect(g.shan.canDrawRinshan).toBe(true);
    expect(g.getKanCandidates(player)).toContain('z5555');
  });

  it('リーチ中の白暗槓は実候補 z5555 をそのまま宣言できる', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const sp = buildShoupai([
      'z5b','z5r','z5g',
      'p1','p2','p3','p4','p5','p6','s1','s2','s3','z1',
    ]);
    sp.zimo('z5y');
    g.shoupai.set(player, sp);
    g.lizhi.add(player);
    g.lizhiDeclareDapai[player] = false;
    (g.shan as any)._rinshan = ['p9'];
    (g.shan as any)._pai = ['p7', 'p8', 'p9'];

    const candidate = g.getKanCandidates(player).find((m) => m.startsWith('z5'));
    expect(candidate).toBe('z5555');
    expect(g.declareKan(player, candidate!)).toBe('p9');
    expect(sp._fulou).toContain('z5555');
  });
});
