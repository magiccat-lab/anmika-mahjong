// 2026-09-03 リョー報告:「フィーバー最初の 2p ツモ時のみ、表ドラの神ポが無効になってた」
//
// でかぽっち [リーチ一発中に本待ちでない p1/p2 をツモ] は swap して初めて和了形になるため、
// hule() の base 計算も神ぽっちの再 hule も null を返す。旧 code は「再 hule が成功した時だけ
// param.baopai/fubaopai を神ぽっち適用後の表示列に差し替える」実装だったので、swap path が
// 素の表示列 [正ぽっちは除外済み] で数え、選択済み神ぽっちのドラが丸ごと落ちていた。
// フィーバー 2 回目以降は一発が消えて でかぽっち が成立しないため、最初の 1 回だけ壊れる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

const read = (store: any): any => get(store as any);
const hupaiNames = (result: any): string[] => (result?.hupai ?? []).map((h: any) => String(h.name));
const doraFanshu = (result: any): number | undefined =>
  (result?.hupai ?? []).find((h: any) => h.name === 'ドラ')?.fanshu;

/** 現手番を人間にし、乱数配牌由来の華 / 金 / ぽっち / 嶺上状態を消して決定論化する */
function prepareHumanTurn(): { game: Game3; player: PlayerId } {
  const store = createGameStore();
  const game: Game3 = read(store).game;
  const player = game.lunbanToPlayerId(game.state.lunban);
  store.setCpuSeats(([0, 1, 2] as PlayerId[]).filter((p) => p !== player));
  game.diyizimo = false;
  for (const p of [0, 1, 2] as PlayerId[]) {
    game.huapai[p] = [];
    game.goldHand[p] = { p: 0, s: 0, z: 0 };
    game.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 };
    game.nukidora[p] = 0;
    game.nukidoraGold[p] = 0;
    game.kinpeiTarget[p] = null;
    game.lingshangActive[p] = false;
    game.lingshangFromKan[p] = false;
  }
  return { game, player };
}

// 待ちに p1/p2 を含まない七対子 p5 単騎。swap [p2 → p5] で初めて和了形になる = でかぽっち成立形
const NON_WAIT_CHITOI = ['m7', 'm7', 'p3', 'p3', 'p5', 's4', 's4', 's5', 's5', 's6', 's6', 's8', 's8'];

/** 表ドラに正ぽっち [z5g] を出し、リーチ一発でツモ牌を pai に固定して本物の zimo() を走らせる */
function setupKamiPochiDraw(pai: string, opts: { yifa: boolean }) {
  const { game, player } = prepareHumanTurn();
  game.shoupai.set(player, buildShoupai(NON_WAIT_CHITOI));
  game.lizhi.add(player);
  game.yifaActive[player] = opts.yifa;
  const shan: any = game.shan;
  shan._baopai = ['z5g'];      // 正ぽっち [緑] = 神ぽっち
  shan._fubaopai = ['z2'];     // 裏は手牌に無い牌で固定 [flaky 防止]
  shan.commitDoraReveal?.();
  shan._pai[shan._pai.length - 1] = pai;
  expect(game.zimo()).toBe(pai);
  // 神ぽっちは store 側 [resolvePreSettlementPochiChoices] が自動高め取りする。ここでは
  // 手牌に 2 枚ある s6 を明示指定して期待ドラ数を固定する
  expect(game.setKamiPochiDoraChoice(player, 'baopai:0', 's6')).toBe(true);
  return { game, player };
}

describe('でかぽっち × 表ドラ神ぽっち [2026-09-03]', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); vi.restoreAllMocks(); });

  it('一発 p2 ツモ [でかぽっち成立] でも選択済み神ぽっちのドラ 2 翻とラベルが残る', () => {
    const { game, player } = setupKamiPochiDraw('p2', { yifa: true });
    const res: any = game.hule(player);
    expect(res).toBeTruthy();
    expect(hupaiNames(res)).toContain('でかぽっち オールマイティ [p5] (黄)');
    expect(doraFanshu(res)).toBe(2);
    expect(hupaiNames(res)).toContain('神ぽっち [baopai:0→s6]');
  });

  it('対照: 一発切れ [でかぽっち非成立] の通常ツモは従来通り神ぽっちが乗る', () => {
    const { game, player } = setupKamiPochiDraw('p5', { yifa: false });
    const res: any = game.hule(player);
    expect(res).toBeTruthy();
    expect(hupaiNames(res).some((n) => n.includes('でかぽっち'))).toBe(false);
    expect(doraFanshu(res)).toBe(2);
    expect(hupaiNames(res)).toContain('神ぽっち [baopai:0→s6]');
  });
});
