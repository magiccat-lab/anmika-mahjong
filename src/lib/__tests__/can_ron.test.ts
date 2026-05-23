import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// canRon の基本ガード + フリテン + 間八萬 z5 逆ぽ ロン禁止 を unit 固定。
describe('Game3 canRon', () => {
  it('shoupai ナシ で false', () => {
    const g = new Game3();
    g.qipai();
    g.shoupai.delete(0 as PlayerId);
    expect(g.canRon(0 as PlayerId, 'p1', 1 as PlayerId)).toBe(false);
  });

  it('ノーテン手 で false', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['m7','m9','p1','p3','p5','s1','s3','s5','s7','z1','z2','z3','z6']));
    expect(g.canRon(player, 'p1', 1 as PlayerId)).toBe(false);
  });

  it('リーチ中 + 待ち牌 ロン で true', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    // テンパイ手 [p1p1p1 p2p2p2 p3p3p3 s7s7s7 s8] s8 単騎待ち
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    g.lizhi.add(player);
    expect(g.canRon(player, 's8', 1 as PlayerId)).toBe(true);
  });

  it('副露あり + 待ち牌 ロン で boolean 返却 [hule 結果次第]', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s8']));
    const sp = g.shoupai.get(player) as any;
    sp._fulou = ['s7s7s7+'];
    expect(typeof g.canRon(player, 's8', 1 as PlayerId)).toBe('boolean');
  });

  it('間八萬: 逆ぽ [赤 / 黄] の z5 は ロン不可', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = 0 as PlayerId;
    const fromPlayer = 1 as PlayerId;
    g.shoupai.set(player, buildShoupai(['m7','m9','p1','p2','p3','s1','s2','s3','s7','s7','s7','s5','s5']));
    g.lizhi.add(player);
    // 1 が 赤ぽっち z5 [pochi='red'] を打牌した state
    g.discardLog[fromPlayer] = [{ pai: 'z5', pochi: 'red' }];
    expect(g.canRon(player, 'z5', fromPlayer)).toBe(false);
  });

  it('間八萬: 黄ぽっち z5 も ロン不可', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = 0 as PlayerId;
    const fromPlayer = 1 as PlayerId;
    g.shoupai.set(player, buildShoupai(['m7','m9','p1','p2','p3','s1','s2','s3','s7','s7','s7','s5','s5']));
    g.lizhi.add(player);
    g.discardLog[fromPlayer] = [{ pai: 'z5', pochi: 'yellow' }];
    expect(g.canRon(player, 'z5', fromPlayer)).toBe(false);
  });

  it('フィーバー成立後は非フィーバー家のロン不可', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const feverPlayer = 0 as PlayerId;
    const player = 1 as PlayerId;
    g.feverActive[feverPlayer] = true;
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    g.lizhi.add(player);
    expect(g.canRon(player, 's8', 2 as PlayerId)).toBe(false);
  });

  it('フィーバー宣言牌へのロンだけは非フィーバー家でも許可 [fever undo 用]', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const feverPlayer = 0 as PlayerId;
    const player = 1 as PlayerId;
    g.feverActive[feverPlayer] = true;
    g.feverDeclareDapaiPlayer = feverPlayer;
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    g.lizhi.add(player);
    expect(g.canRon(player, 's8', feverPlayer)).toBe(true);
  });
});
