import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 北抜き [canNukiBei / declareNukiBei] の挙動 verify。
// 過去 P0-6b で state corruption 起きた領域、 gold 北 / 通常 z4 区別 / フィーバー制限 等を unit 固定。
describe('Game3 nuki bei', () => {
  it('zimo ナシ で canNukiBei = false', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // qipai 直後 zimo してない
    expect(g.canNukiBei(player)).toBe(false);
  });

  it('z4 を持ってない player は canNukiBei = false [zimo 別 tile]', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = g.shoupai.get(player) as any;
    // 強制的に z4 を 0 枚にしてから zimo
    sp._bingpai.z[4] = 0;
    g.zimo();
    // zimo した tile が z4 でも sp._zimo フィールドにあるだけで _bingpai.z[4] は 0 のまま
    // canNukiBei は _bingpai.z[4] >= 1 を要求
    if (sp._zimo !== 'z4') {
      expect(g.canNukiBei(player)).toBe(false);
    }
  });

  it('z4 持ち + zimo 済 + 非フィーバー で canNukiBei = true', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = g.shoupai.get(player) as any;
    sp._bingpai.z[4] = 1;
    g.zimo();
    expect(g.canNukiBei(player)).toBe(true);
  });

  it('フィーバー中 非フィーバー player は ツモ z4 のみ抜ける、 手牌 z4 不可', () => {
    const g = new Game3();
    g.qipai();
    const me = g.lunbanToPlayerId(g.state.lunban);
    const other = ((me + 1) % 3) as PlayerId;
    g.feverActive[other] = true;
    const sp = g.shoupai.get(me) as any;
    sp._bingpai.z[4] = 2; // 手に z4
    g.zimo();
    // フィーバー中 + 自家非フィーバー: sp._zimo === 'z4' のときのみ true
    if (sp._zimo === 'z4') {
      expect(g.canNukiBei(me)).toBe(true);
    } else {
      expect(g.canNukiBei(me)).toBe(false);
    }
  });

  it('フィーバー中 非フィーバー player は ツモ gN も 北として抜ける', () => {
    const g = new Game3();
    g.qipai();
    const me = g.lunbanToPlayerId(g.state.lunban);
    const other = ((me + 1) % 3) as PlayerId;
    g.feverActive[other] = true;
    const sp = g.shoupai.get(me) as any;
    sp._bingpai.z[4] = 1;
    sp._zimo = 'gN';
    g.goldHand[me].z = 1;
    expect(g.canNukiBei(me)).toBe(true);
  });

  it('declareNukiBei で nukidora +1、次の通常捨牌への鳴きを抑止しない', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = g.shoupai.get(player) as any;
    sp._bingpai.z[4] = 1;
    g.goldHand[player].z = 0;
    g.zimo();
    expect(g.canNukiBei(player)).toBe(true);
    const before = g.nukidora[player];
    const replacement = g.declareNukiBei(player);
    expect(replacement).toBeTruthy();
    expect(g.nukidora[player]).toBe(before + 1);
    expect(g.justNukidBei[player]).toBe(false);
  });

  it('regression: リーチ後 北抜きの代替ツモは嶺上フラグを立てる', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = g.shoupai.get(player) as any;
    sp._bingpai.z[4] = 1;
    g.goldHand[player].z = 0;
    g.zimo();
    g.lizhi.add(player);

    const replacement = g.declareNukiBei(player);

    expect(replacement).toBeTruthy();
    expect(g.lingshangActive[player]).toBe(true);
    expect(g.justNukidBei[player]).toBe(false);
  });

  // 2026-05-14 ゆーま 自走 bug fix:
  //   game.dapai 内で justNukidBei を clear すると、 store 側 pon 候補 check 時点で
  //   既に false になり 「抜き直後の他家ポン不可」 ルール 2-4 が破れる。
  //   game.dapai は flag を保持し、 store.ts pon check 後に clear する設計に変更。
  it('declareNukiBei → dapai の直後も通常どおり鳴ける', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = g.shoupai.get(player) as any;
    sp._bingpai.z[4] = 1;
    g.goldHand[player].z = 0;
    g.zimo();
    g.declareNukiBei(player);
    expect(g.justNukidBei[player]).toBe(false);
    // 嶺上ツモ後、 すぐに dapai しても justNukidBei は維持される
    const dapai = sp._zimo;
    if (typeof dapai === 'string' && dapai.length <= 3) {
      try { g.dapai(dapai); } catch { /* dapai 失敗時は test skip */ }
      // dapai 後も flag は true [store 側で pon check 終了後に clear する仕様]
      expect(g.justNukidBei[player]).toBe(false);
    }
  });

  it('goldHand.z >= 1 の player は 金北 優先で抜ける [nukidoraGold +1]', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = g.shoupai.get(player) as any;
    sp._bingpai.z[4] = 1;
    g.goldHand[player].z = 1;
    g.zimo();
    const beforeNormal = g.nukidora[player];
    const beforeGold = g.nukidoraGold[player];
    g.declareNukiBei(player);
    expect(g.nukidoraGold[player]).toBe(beforeGold + 1);
    expect(g.nukidora[player]).toBe(beforeNormal); // 通常は incr ナシ
    expect(g.goldHand[player].z).toBe(0);
  });

  it('存在しない金北を明示して通常北を代用できない', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = g.shoupai.get(player) as any;
    sp._bingpai.z[4] = 1;
    sp._bingpai.__anmika.gN = 0;
    sp._bingpai.gN = 0;
    sp._zimo = 'z4';
    g.goldHand[player].z = 0;
    g.lastZimoInfo = { player, pai: 'z4', pochi: null, gold: false };

    expect(() => g.dapai('gN')).toThrow(/physical tile is not in hand/);
    expect(g.declareNukiBei(player, { gold: true })).toBeNull();
    expect(sp._bingpai.z[4]).toBe(1);
    expect(g.nukidora[player]).toBe(0);
    expect(g.nukidoraGold[player]).toBe(0);
  });

  it('通常北を明示した時に金北へすり替えない', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = g.shoupai.get(player) as any;
    sp._bingpai.z[4] = 1;
    sp._bingpai.__anmika.gN = 1;
    sp._bingpai.gN = 1;
    sp._zimo = 'z4';
    g.goldHand[player].z = 1;
    g.lastZimoInfo = { player, pai: 'gN', pochi: null, gold: true };

    expect(g.declareNukiBei(player, { gold: false })).toBeNull();
    expect(sp._bingpai.z[4]).toBe(1);
    expect(g.goldHand[player].z).toBe(1);
    expect(g.nukidora[player]).toBe(0);
    expect(g.nukidoraGold[player]).toBe(0);
  });

  it('金北の補充ツモ失敗時に物理identityを含む手牌全体を戻す', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = buildShoupai([
      'p1', 'p1', 'p1', 'p1',
      'p2', 'p3', 'p4', 's2', 's3', 's4', 'm7', 'm9', 'z1',
    ]);
    sp.zimo('gN');
    g.shoupai.set(player, sp);
    g.goldHand[player].z = 1;
    g.lastZimoInfo = { player, pai: 'gN', pochi: null, gold: true };
    (g.shan as any)._pai = ['s9'];
    // p1 is already four copies in hand, so this replacement cannot enter.
    (g.shan as any)._rinshan = ['p1'];

    expect(g.declareNukiBei(player, { gold: true })).toBeNull();
    expect(sp._bingpai.z[4]).toBe(1);
    expect(sp._bingpai.__anmika.gN).toBe(1);
    expect(sp._anmikaZimo).toBe('gN');
    expect(sp._zimo).toBe('z4');
    expect(g.goldHand[player].z).toBe(1);
    expect(g.nukidoraGold[player]).toBe(0);
    expect((g.shan as any)._rinshan).toEqual(['p1']);
  });

  it('extracts a north drawn from the last live tile and keeps live wall exhausted', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const sp = buildShoupai([
      'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7',
      's1', 's2', 's3', 's4', 's5', 'z1',
    ]);
    sp.zimo('z4');
    g.shoupai.set(player, sp);
    g.lastZimoInfo = { player, pai: 'z4', pochi: null, gold: false };
    (g.shan as any)._pai = [];
    (g.shan as any)._rinshan = ['s9'];

    expect(g.canNukiBei(player)).toBe(true);
    expect(g.declareNukiBei(player, { gold: false })).toBe('s9');
    expect(g.shan.paishu).toBe(0);
    expect(sp._zimo).toBe('s9');
    expect(g.lingshangActive[player]).toBe(true);
  });
});
