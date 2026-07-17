import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

describe('Game3 xiangting', () => {
  it('shoupai 未配給 [transition 中] で 99 [crash 防止]', () => {
    const g = new Game3();
    g.qipai();
    g.shoupai.delete(0 as PlayerId);
    expect(g.xiangting(0 as PlayerId)).toBe(99);
  });

  it('テンパイ手 = 0 シャンテン', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    expect(g.xiangting(player)).toBe(0);
  });

  it('和了形 = -1 シャンテン', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('s8');
    expect(g.xiangting(player)).toBe(-1);
  });

  it('物理 m7 が一萬の役割を担う国士13面待ちを0シャンテンと数える', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai([
      'm7', 'm9', 'p1', 'p9', 's1', 's9',
      'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7',
    ]));
    expect(g.xiangting(player)).toBe(0);
  });
});

describe('Game3 mostCommonPaiInHand', () => {
  it('単純な手牌で 最多牌を返す', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['p7','p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9']);
    // p7 と s7 が各 3 枚 → 最初に見つかる方 [Object.entries 順]、 重要なのは戻り値が p7/s7 のいずれか
    const result = g.mostCommonPaiInHand(sp);
    expect(['p7', 's7']).toContain(result);
  });

  it('全牌 1 枚ずつでも 何か返す [null じゃない]', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['m7','m9','p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2']);
    const result = g.mostCommonPaiInHand(sp);
    expect(result).toBeTruthy();
  });

  it('player 指定で nukidora を z4 count に加算', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.nukidora[player] = 3;
    g.nukidoraGold[player] = 0;
    const sp = buildShoupai(['p1','p1','p2','p2','p3','p3','s1','s2','s3','s4','s5','s6','s7']);
    const result = g.mostCommonPaiInHand(sp, { player });
    // z4 が 3 枚 [nukidora] でカウント最多 → z4 が返る
    expect(result).toBe('z4');
  });

  it('includeHua=true で huapai も candidate', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f1', 'f1', 'f1', 'f1'];
    g.nukidora[player] = 0;
    g.nukidoraGold[player] = 0;
    const sp = buildShoupai(['p1','p1','p2','p2','p3','p3','s1','s2','s3','s4','s5','s6','s7']);
    const result = g.mostCommonPaiInHand(sp, { player, includeHua: true });
    expect(result).toBe('f1'); // huapai 4 件で最多
  });
});
