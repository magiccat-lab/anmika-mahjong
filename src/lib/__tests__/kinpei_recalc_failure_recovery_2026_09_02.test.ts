// 2026-09-02 リョー報告「ツモ和了／打牌を選択」表示のまま何を押しても反応しない件の回帰固定。
//
// 経路: ツモ → 金北 modal [lastWinner を立てて待つ] → selectKinpei の再 hule が null で抜ける。
// 旧実装は再計算失敗時に lastWinner を残したまま return していたので、以後の tsumo()/ron() が
// 連打防止ガード [`s.lastWinner !== null`] で無言 no-op になり、局が二度と進まなかった。
// 修正後は失敗時に lastWinner / lastHuleResult / kinpeiTarget を宣言前へ戻し、再度ツモできる。
//
// 併せて、加槓の CPU 槍槓窓 [candidates あり・全員 hule null] で評価用に立てた lastDapai が
// 残って App のツモボタン [`!lastDapai` ゲート] が消える件も同じ日に硬化したので固定する。
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

type Store = ReturnType<typeof createGameStore>;

/** store action は毎回 `{ ...s }` で state object を作り直すので、読む度に get する */
const read = (store: Store): any => get(store as any);

/** 現手番を人間、他 2 家を CPU にし、乱数配牌由来の華 / 金 / ぽっちを全て消して決定論化する */
function prepareHumanTurn(): { store: Store; game: Game3; player: PlayerId; others: PlayerId[] } {
  const store = createGameStore();
  const game: Game3 = read(store).game;
  const player = game.lunbanToPlayerId(game.state.lunban);
  const others = ([0, 1, 2] as PlayerId[]).filter((p) => p !== player);
  store.setCpuSeats(others);
  game.diyizimo = false;
  for (const p of [0, 1, 2] as PlayerId[]) {
    game.huapai[p] = [];
    game.goldHand[p] = { p: 0, s: 0, z: 0 };
    game.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 };
    game.nukidora[p] = 0;
    game.nukidoraGold[p] = 0;
    game.kinpeiTarget[p] = null;
  }
  return { store, game, player, others };
}

/** 表 / 裏ドラ表示を華・ぽっち無しに固定 [2026-07-15 裁定で表示華も金北候補になるため] */
function pinDora(game: Game3, baopai: string[], fubaopai: string[] = ['z2', 'z2']): void {
  const shan: any = game.shan;
  shan._baopai = [...baopai];
  shan._fubaopai = [...fubaopai];
  shan.commitDoraReveal?.();
}

/**
 * 立直門前のツモ和了形 + 金北抜き + 夏 [f2] 1 枚。
 * canTsumo はダマ禁止 [門前・非立直は役満のみ] なので立直で満たす。
 */
function setupRiichiTsumoWithKinpei(baopai: string[] = ['z2', 'z2']) {
  const ctx = prepareHumanTurn();
  const { store, game, player } = ctx;
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's3', 's7', 's8', 'z1', 'z1']);
  sp.zimo('s9');
  game.shoupai.set(player, sp);
  game.lizhi.add(player);
  game.huapai[player] = ['f2'];
  game.nukidoraGold[player] = 1;
  game.lastZimoInfo = { player, pai: 's9', pochi: null, gold: false };
  read(store).lastZimo = 's9';
  pinDora(game, baopai);
  expect(game.canTsumo(player)).toBe(true);
  return ctx;
}

function expectKinpeiModalOpen(s: any, player: PlayerId): void {
  expect(s.pendingKinpei).not.toBeNull();
  expect(s.pendingKinpei.winner).toBe(player);
  expect(s.pendingKinpei.availableHuapai).toContain('f2');
  expect(s.lastWinner).toBe(player);
  expect(s.roundEnded).toBe(false);
  expect(s.message).toContain('金北');
}

function expectBackToPreDeclaration(s: any, game: Game3, player: PlayerId): void {
  expect(s.message).toContain('再計算失敗');
  expect(s.lastWinner).toBeNull();
  expect(s.lastHuleResult).toBeNull();
  expect(s.pendingKinpei).toBeNull();
  expect(s.roundEnded).toBe(false);
  expect(game.kinpeiTarget[player]).toBeNull();
}

function expectTsumoSettled(s: any, game: Game3, player: PlayerId, defenBefore: number): void {
  expect(s.lastHuleResult).not.toBeNull();
  expect(s.lastWinner).toBe(player);
  expect(s.pendingKinpei).toBeNull();
  expect(s.message).toContain('ツモ和了');
  expect(s.message).toContain('[金北→natsu]');
  expect(game.kinpeiTarget[player]).toBe('natsu');
  expect(game.state.defen[player]).toBeGreaterThan(defenBefore);
  expect(s.roundEnded || !!s.pendingSaiKoro).toBe(true);
}

describe('金北 modal の再計算失敗から復帰できる [2026-09-02]', () => {
  it('再 hule が null でも lastWinner を戻し、次の tsumo() が連打防止ガードで死なない', () => {
    const { store, game, player } = setupRiichiTsumoWithKinpei();
    const defenBefore = game.state.defen[player];

    store.tsumo();
    expectKinpeiModalOpen(read(store), player);

    // 再計算失敗を再現: 金北選択後の hule だけ null を返す
    (game as any).hule = () => null;
    store.selectKinpei('natsu');
    const failed = read(store);
    expect(failed.message).toBe(`player ${player} 再計算失敗`);
    expectBackToPreDeclaration(failed, game, player);
    expect(game.state.defen[player]).toBe(defenBefore);

    // 旧実装の症状: ここで tsumo() が無言 no-op になり局が止まっていた
    delete (game as any).hule;
    expect(game.canTsumo(player)).toBe(true);
    store.tsumo();
    expectKinpeiModalOpen(read(store), player);

    store.selectKinpei('natsu');
    expectTsumoSettled(read(store), game, player, defenBefore);
  });

  it('神ぽっち再計算 [金北・神ぽっち選択後] が null でも同じく宣言前へ戻る', () => {
    // 表ドラ表示に正ぽっち [z5b] を置くと selectKinpei は 1 回目の hule 後に神ぽっち高め取りで
    // もう一度 hule する。その 2 回目だけ null にして後段の失敗分岐を踏む
    const { store, game, player } = setupRiichiTsumoWithKinpei(['z5b', 'z2']);
    const defenBefore = game.state.defen[player];

    store.tsumo();
    expectKinpeiModalOpen(read(store), player);

    const orig = game.hule.bind(game);
    let calls = 0;
    (game as any).hule = (...args: any[]) => (calls++ === 0 ? orig(...args) : null);
    store.selectKinpei('natsu');
    const failed = read(store);
    expect(calls).toBe(2);
    expect(failed.message).toBe(`player ${player} 金北・神ぽっち選択後の再計算失敗`);
    expectBackToPreDeclaration(failed, game, player);

    delete (game as any).hule;
    store.tsumo();
    expectKinpeiModalOpen(read(store), player);

    store.selectKinpei('natsu');
    expectTsumoSettled(read(store), game, player, defenBefore);
  });
});

describe('加槓の CPU 槍槓窓で全員 hule null なら lastDapai を残さない [2026-09-02]', () => {
  it('窓を抜けた後に嶺上ツモ和了へ進める [ツモボタンの !lastDapai ゲート]', () => {
    const { store, game, player, others } = prepareHumanTurn();
    const [riichiCpu, junkCpu] = others;

    // 人間: 東ポン + 3p ポン + p2 p5 p6 p6 p7 p7 p8、ツモ p3 で加槓できる形
    const sp = buildShoupai(['p2', 'p5', 'p6', 'p6', 'p7', 'p7', 'p8', 'z1', 'z1', 'p3', 'p3']);
    game.shoupai.set(player, sp);
    sp.fulou('z111+'); sp._zimo = null; sp._anmikaFulou = [{ mianzi: 'z111+', from: junkCpu, taken: 'z1' }];
    sp.fulou('p333-'); sp._zimo = null; sp._anmikaFulou.push({ mianzi: 'p333-', from: riichiCpu, taken: 'p3' });
    sp.zimo('p3');
    game.lastZimoInfo = { player, pai: 'p3', pochi: null, gold: false };
    read(store).lastZimo = 'p3';
    // CPU 1: 立直で p3 待ち [槍槓候補になる]。 CPU 2: 無関係の手
    game.shoupai.set(riichiCpu, buildShoupai(['m7', 'm7', 'p1', 'p2', 's2', 's3', 's4', 's6', 's7', 's8', 'z2', 'z2', 'z2']));
    game.lizhi.add(riichiCpu);
    game.shoupai.set(junkCpu, buildShoupai(['m9', 'm9', 'p1', 'p4', 'p9', 's1', 's9', 'z1', 'z3', 'z5', 'z6', 'z7', 'z7']));
    // 金北 + 夏で嶺上ツモ後に金北 modal が開く
    game.huapai[player] = ['f2'];
    game.nukidoraGold[player] = 1;
    pinDora(game, ['z2', 'z2']);
    const shan: any = game.shan;
    shan._rinshan[0] = 'p2';          // 嶺上牌で p22 + p567 + p678 が完成
    shan._pai[0] = 'z2'; shan._pai[1] = 'z2'; // カンドラ / 裏 [華・ぽっち混入を避ける]

    expect(game.getKanCandidates(player)).toContain('p333-3');
    expect(game.canRon(riichiCpu, 'p3', player)).toBe(true);

    // 槍槓窓 [qianggangPending 中] の hule だけ null = 候補は居るが誰も和了できない
    const orig = game.hule.bind(game);
    let windowHuleCalls = 0;
    (game as any).hule = (...args: any[]) => {
      if (game.qianggangPending) { windowHuleCalls += 1; return null; }
      return orig(...args);
    };
    store.declareKan('p333-3');
    delete (game as any).hule;

    const afterKan = read(store);
    expect(windowHuleCalls).toBe(1);
    expect(afterKan.message).toContain(`player ${player} カン [p333-3]`);
    expect(afterKan.lastZimo).toBe('p2');
    expect(afterKan.lastDapai).toBeNull();
    expect(afterKan.awaitingRonDecision).toBe(false);
    expect(afterKan.pendingQianggang).toBeNull();
    expect(afterKan.lastWinner).toBeNull();
    expect(game.qianggangPending).toBe(false);
    expect(game.canTsumo(player)).toBe(true);

    const defenBefore = game.state.defen[player];
    store.tsumo();
    expectKinpeiModalOpen(read(store), player);
    store.selectKinpei('natsu');
    const settled = read(store);
    expectTsumoSettled(settled, game, player, defenBefore);
    expect((settled.lastHuleResult.hupai ?? []).some((h: any) => String(h.name).includes('嶺上開花'))).toBe(true);
  });
});
