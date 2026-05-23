import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// canLizhi のゲート条件 [副露 / zimo / シャンテン / 点棒 / 既 lizhi] を unit 固定。
// toolbar 自席 filter [6e9b3b8] の根本側を 守る。
describe('Game3 canLizhi', () => {
  function makeTenpaiGame(): { g: Game3; player: PlayerId } {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // テンパイ手 [p1p1p1 p2p2p2 p3p3p3 s7s7s7 s8] を強制配置 + zimo s8
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('s9');
    return { g, player };
  }

  it('zimo ナシ で false', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // qipai 直後 = 親 player 以外は zimo ナシ
    const nonZimoPlayer = ((player + 1) % 3) as PlayerId;
    expect(g.canLizhi(nonZimoPlayer)).toBe(false);
  });

  it('既にリーチ済 player は false [二重 lizhi 防止]', () => {
    const { g, player } = makeTenpaiGame();
    g.lizhi.add(player);
    expect(g.canLizhi(player)).toBe(false);
  });

  it('point 負 で false [defen < 0]', () => {
    const { g, player } = makeTenpaiGame();
    g.state.defen[player] = -1;
    expect(g.canLizhi(player)).toBe(false);
  });

  it('point 0 でも リーチ可能 [トビ扱い、 0 以上 OK]', () => {
    const { g, player } = makeTenpaiGame();
    g.state.defen[player] = 0;
    expect(g.canLizhi(player)).toBe(true);
  });

  it('副露ありで false [明刻 / 明順]', () => {
    const { g, player } = makeTenpaiGame();
    const sp = g.shoupai.get(player) as any;
    sp._fulou = ['p7p7p7+']; // 明刻 [方向 mark あり]
    expect(g.canLizhi(player)).toBe(false);
  });

  it('副露が暗槓のみなら リーチ可能 [門前扱い]', () => {
    const { g, player } = makeTenpaiGame();
    const sp = g.shoupai.get(player) as any;
    // 暗槓表記: mpsz + 4 digit、 方向 mark なし [例 m7777]
    sp._fulou = ['p7777']; // 暗槓
    expect(g.canLizhi(player)).toBe(true);
  });

  it('シャンテン > 0 [ノーテン] で false', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // 完全ノーテン手 [シャンテン 5 程度]
    g.shoupai.set(player, buildShoupai(['p1','p3','p5','p7','p9','s1','s3','s5','s7','s9','z1','z2','z3']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('z6');
    expect(g.canLizhi(player)).toBe(false);
  });
});
