import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

describe('Game3 isGameEnd', () => {
  it('全員 0 以上 + changbang 残あり で false', () => {
    const g = new Game3({ changshu: 1 });
    g.qipai();
    g.state.defen = { 0: 35000, 1: 35000, 2: 35000 };
    g.state.changbang = 0; // changshu-1=0、 まだオーラス
    expect(g.isGameEnd()).toBe(false);
  });

  it('誰か defen < 0 [トビ] で true', () => {
    const g = new Game3();
    g.qipai();
    g.state.defen = { 0: 50000, 1: -100, 2: 55100 };
    expect(g.isGameEnd()).toBe(true);
  });

  it('親の逆ぽっち自己トビも例外なく終了', () => {
    const g = new Game3();
    g.qipai();
    g.state.defen = { 0: -100, 1: 50000, 2: 55100 };
    expect(g.isGameEnd()).toBe(true);
    expect(g.isGameEnd({ ignoreTobiFor: 0 as PlayerId })).toBe(true);
  });

  it('オーラス終了 + トップ 40000+ で true [ゲーム終了]', () => {
    const g = new Game3({ changshu: 1 });
    g.qipai();
    g.state.changbang = 1; // > changshu-1=0
    g.state.defen = { 0: 50000, 1: 30000, 2: 25000 };
    expect(g.isGameEnd()).toBe(true);
  });

  it('オーラス終了 + 全員 40000 未達 で false [返り東 継続]', () => {
    const g = new Game3({ changshu: 1 });
    g.qipai();
    g.state.changbang = 1;
    g.state.defen = { 0: 35000, 1: 35000, 2: 35000 };
    expect(g.isGameEnd()).toBe(false);
  });
});

describe('Game3 getDamingangCandidates', () => {
  it('shoupai ナシ で 空配列', () => {
    const g = new Game3();
    g.qipai();
    g.shoupai.delete(0 as PlayerId);
    expect(g.getDamingangCandidates(0 as PlayerId, 1 as PlayerId, 'p7')).toEqual([]);
  });

  it('リーチ中 player は 大明槓不可', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p7','p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9']));
    g.lizhi.add(player);
    expect(g.getDamingangCandidates(player, 1 as PlayerId, 'p7')).toEqual([]);
  });

  it('同 player [diff=0] は 空配列', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p7','p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9']));
    expect(g.getDamingangCandidates(player, player, 'p7')).toEqual([]);
  });

  it('上家 [diff=1] からの p7 で + mark の大明槓 候補', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p7','p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9']));
    const cands = g.getDamingangCandidates(player, 1 as PlayerId, 'p7');
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]).toMatch(/p7+\+/);
  });
});
