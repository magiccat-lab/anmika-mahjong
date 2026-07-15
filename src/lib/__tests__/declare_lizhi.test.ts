import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// declareLizhi の挙動 + オプション [open / shuvari / fever] + 3 軒目 block を unit 固定。

function makeTenpaiLunbanGame(qijia: PlayerId = 0): Game3 {
  const g = new Game3({ qijia });
  g.qipai();
  const player = g.lunbanToPlayerId(g.state.lunban);
  // テンパイ手 + zimo
  g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
  const sp = g.shoupai.get(player) as any;
  sp.zimo('s9');
  return g;
}

describe('Game3 declareLizhi', () => {
  it('canLizhi 不成立で false [テンパイじゃない]', () => {
    const g = new Game3();
    g.qipai();
    // 配牌直後 = 親以外 zimo ナシ なので canLizhi 不成立
    const player = g.lunbanToPlayerId(g.state.lunban);
    g.shoupai.set(player, buildShoupai(['p1','p3','p5','p7','p9','s1','s3','s5','s7','z1','z2','z3','z6']));
    (g.shoupai.get(player) as any).zimo('z7');
    expect(g.declareLizhi()).toBe(false);
  });

  it('成立で 1000 点供託 + lizhibang +1', () => {
    const g = makeTenpaiLunbanGame();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const defenBefore = g.state.defen[player];
    const bangBefore = g.state.lizhibang;
    expect(g.declareLizhi()).toBe(true);
    expect(g.state.defen[player]).toBe(defenBefore - 1000);
    expect(g.state.lizhibang).toBe(bangBefore + 1);
    expect(g.lizhi.has(player)).toBe(true);
    expect(g.yifaActive[player]).toBe(true);
    expect(g.lizhiDeclareDapai[player]).toBe(true);
  });

  it('opts.open=true で 2000 点供託 + openLizhi 登録 + lizhibang +2', () => {
    const g = makeTenpaiLunbanGame();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const defenBefore = g.state.defen[player];
    const bangBefore = g.state.lizhibang;
    expect(g.declareLizhi({ open: true })).toBe(true);
    expect(g.state.defen[player]).toBe(defenBefore - 2000);
    expect(g.state.lizhibang).toBe(bangBefore + 2);
    expect(g.openLizhi.has(player)).toBe(true);
  });

  it('オープンリーチは2000点未満からも供託し、箱下まで許可する', () => {
    const g = makeTenpaiLunbanGame();
    const player = g.lunbanToPlayerId(g.state.lunban);
    g.state.defen[player] = -500;
    expect(g.declareLizhi({ open: true })).toBe(true);
    expect(g.state.defen[player]).toBe(-2500);
    expect(g.state.lizhibang).toBe(2);
  });

  it('オープン 3 軒目 block: 既 2 人 open なら 3 人目 open は false', () => {
    const g = makeTenpaiLunbanGame();
    g.openLizhi.add(1 as PlayerId);
    g.openLizhi.add(2 as PlayerId);
    expect(g.declareLizhi({ open: true })).toBe(false);
    // 通常リーチは OK
    const player = g.lunbanToPlayerId(g.state.lunban);
    expect(g.canLizhi(player)).toBe(true);
  });

  it('shuvari=true で shuvariActive=true + 使用済 flag', () => {
    const g = makeTenpaiLunbanGame();
    const player = g.lunbanToPlayerId(g.state.lunban);
    expect(g.declareLizhi({ shuvari: true })).toBe(true);
    expect(g.shuvariActive[player]).toBe(true);
    expect(g.shuvariUsed[player]).toBe(true);
  });

  it('shuvari 使用済 player は shuvariActive 立てない [半荘 1 回限定]', () => {
    const g = makeTenpaiLunbanGame();
    const player = g.lunbanToPlayerId(g.state.lunban);
    g.shuvariUsed[player] = true;
    expect(g.declareLizhi({ shuvari: true })).toBe(true);
    expect(g.shuvariActive[player]).toBe(false); // 使用済なので 立たない
  });

  it('events に lizhi event 記録', () => {
    const g = makeTenpaiLunbanGame();
    const player = g.lunbanToPlayerId(g.state.lunban);
    g.declareLizhi({ open: true });
    const ev = g.events.find((e: any) => e.type === 'lizhi' && e.player === player);
    expect(ev).toBeDefined();
    expect((ev as any).open).toBe(true);
  });
});
