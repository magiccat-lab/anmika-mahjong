// [2026-10-15 通報 20261015 #1「ポッチツモれなくなった」 room LX0C rev 870]
// リーチ中に青ぽっち (オールマイティ) をツモ、裏ドラ表示が [z5g (神ぽっち), f2 (華)]。
// 神ぽっちの再計算 (game3 hule の神ぽっちの段) だけが表示列から華を外しておらず、f2 が majiang-core に渡って
// 選んだ後の hule が必ず null → store.tsumo が「神ぽっち選択後のツモ再計算失敗」で止まり、
// オンラインでは server が tsumo を 40 回以上 reject していた (client の canTsumo は true のまま)
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

const read = (store: any): any => get(store);

function setup(fubaopai: string[]) {
  const store = createGameStore();
  const game: Game3 = read(store).game;
  store.setCpuSeats([]);
  const me = game.lunbanToPlayerId(game.state.lunban);
  game.diyizimo = false;
  for (const p of [0, 1, 2] as PlayerId[]) {
    game.huapai[p] = [];
    game.goldHand[p] = { p: 0, s: 0, z: 0 };
    game.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 };
    game.nukidora[p] = 0;
    game.nukidoraGold[p] = 0;
    game.kinpeiTarget[p] = null;
  }
  const shan: any = game.shan;
  shan._baopai = ['m7', 'z7'];
  shan._fubaopai = fubaopai;
  shan.commitDoraReveal?.();
  // 通報の手: m99 p124(赤5)6 s234678、待ちは p3。ツモは青ぽっち
  const sp = buildShoupai(['m9', 'm9', 'p1', 'p2', 'p4', 'p0', 'p6', 's2', 's3', 's4', 's6', 's7', 's8']);
  sp.zimo('z5b');
  game.shoupai.set(me, sp);
  (game as any).lizhi.add(me);
  read(store).lastZimo = 'z5b';
  return { store, game, me };
}

describe('裏ドラ表示に神ぽっちと華が並んでも、青ぽっちでツモれる', () => {
  it('神ぽっちを選んだ後の hule が null にならない', () => {
    const { game, me } = setup(['z5g', 'f2']);
    const occ = game.getKamiPochiDoraOccurrences(me);
    expect(occ.map((o) => o.key)).toEqual(['fubaopai:0']);
    game.kamiPochiDoraChoices[me]['fubaopai:0'] = 'm9';
    const r = game.hule(me);
    expect(r).not.toBeNull();
    expect((r.hupai ?? []).map((h: any) => h.name).join(' ')).toContain('神ぽっち');
    // m9 を選べば裏ドラは手の m9 2 枚
    expect((r.hupai ?? []).find((h: any) => h.name === '裏ドラ')?.fanshu).toBe(2);
  });
  it('store.tsumo が和了まで進む (通報ではここで止まっていた)', () => {
    const { store, me } = setup(['z5g', 'f2']);
    store.tsumo();
    const s = read(store);
    expect(s.message).not.toContain('再計算失敗');
    expect(s.lastWinner).toBe(me);
  });
  it('華が無い裏ドラ表示は前と同じに和了る', () => {
    const { store, me } = setup(['z5g']);
    store.tsumo();
    expect(read(store).lastWinner).toBe(me);
  });
});
