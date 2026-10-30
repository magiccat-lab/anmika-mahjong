// 冬のやめ権 [使う / 保留] の持ち主。
// 2026-10-27 isg. 通報では「逆ぽっちでも立直者が決める」にしたが、
// 2026-10-30 リョー「冬が1枚でもあればやめ権が存在し、正状態ではリーチ者に、逆状態では下家にやめ権がある」
// で改めた。正は立直者、逆は下家 [(winner + 2) % 3 = 次に打牌する人]。
// 聞く相手が CPU なら聞かない: 立直者 CPU は今まで通り保留、下家 CPU も保留 [待ち残山 0 だけ自動で使う]。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

function armFeverTsumo(reverse: boolean): any {
  const s: any = get(game);
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  g.huapai[cur] = ['f4'];
  g.lizhi.add(cur);
  g.feverActive[cur] = true;
  g.feverDeclareTing[cur] = ['m5'];
  g.pochiMultiplier[cur] = reverse ? { defen: -1, chip: -1 } : { defen: 1, chip: 1 };
  g.pochiPaymentMode[cur] = reverse;
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
  sp.zimo('m5');
  g.shoupai.set(cur, sp);
  s.lastZimo = 'm5';
  (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  for (const p of [0, 1, 2]) s.cpu[p] = false;
  return { s, g, cur, shimocha: (cur + 2) % 3 };
}

function removeWaitTilesFromWall(g: any): void {
  for (const k of ['_pai', '_rinshan', '_fubaopai']) (g.shan as any)[k] = (((g.shan as any)[k] as string[]) ?? []).filter((p) => p !== 'm5' && p !== 'm0');
}

describe('フィーバー中の冬のやめ権: 正は立直者、逆は下家', () => {
  beforeEach(() => { game.reset(); });

  it('下家は次に打牌する人 [(p + 2) % 3]', () => {
    const { g, cur, shimocha } = armFeverTsumo(true);
    g.state.lunban = ((g.state.lunban + 1) % 3) as any;
    expect(g.lunbanToPlayerId(g.state.lunban)).toBe(shimocha);
    expect(shimocha).toBe((cur + 2) % 3);
  });

  it('逆ぽっち中のツモ [全員人間]: 冬の選択は下家、和了者には聞かない', () => {
    const { g, cur, shimocha } = armFeverTsumo(true);
    expect(g.pochiPaymentMode[cur]).toBe(true);
    game.tsumo();
    const mid: any = get(game);
    expect(mid.pendingFuyu?.winner).toBe(cur);
    expect(mid.pendingFuyu.decisionOwners).toEqual([shimocha]);
  });

  it('対照: 正ぽっち中のツモは今まで通り立直者本人', () => {
    const { g, cur } = armFeverTsumo(false);
    expect(g.pochiPaymentMode[cur]).toBe(false);
    game.tsumo();
    const mid: any = get(game);
    expect(mid.pendingFuyu?.winner).toBe(cur);
    expect(mid.pendingFuyu.decisionOwners).toEqual([cur]);
  });

  it('逆ぽっち: 人間の和了者・下家が CPU なら聞かずに保留 [フィーバー継続]', () => {
    const { s, g, cur, shimocha } = armFeverTsumo(true);
    s.cpu[shimocha] = true;
    game.tsumo();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.game.fuyuConsumed[cur]).toBe(false);
    expect(after.lastWinner).toBe(cur);
    expect(g.feverActive[cur]).toBe(true);
  });

  it('逆ぽっち: 待ち牌が山に無ければ [機能 11] 持ち主が CPU でも人間でも聞かずに冬を使う', () => {
    for (const shimochaIsCpu of [false, true]) {
      game.reset();
      const { s, g, cur, shimocha } = armFeverTsumo(true);
      s.cpu[shimocha] = shimochaIsCpu;
      removeWaitTilesFromWall(g);
      game.tsumo();
      const after: any = get(game);
      expect(after.pendingFuyu).toBeNull();
      expect(after.game.fuyuConsumed[cur]).toBe(true);
    }
  });

  it('逆ぽっち: 下家の人間が selectFuyu で保留を選べる [和了者の CPU ツモ]', () => {
    const { s, g, cur, shimocha } = armFeverTsumo(true);
    for (const p of [0, 1, 2]) s.cpu[p] = p === cur;
    game.cpuStep();
    const mid: any = get(game);
    expect(mid.pendingFuyu?.winner).toBe(cur);
    expect(mid.pendingFuyu.decisionOwners).toEqual([shimocha]);
    expect(mid.lastWinner).toBeNull();
    game.selectFuyu(false);
    const done: any = get(game);
    expect(done.pendingFuyu).toBeNull();
    expect(done.game.fuyuConsumed[cur]).toBe(false);
    expect(done.lastWinner).toBe(cur);
    expect(g.feverActive[cur]).toBe(true);
  });

  it('CPU の和了者 [正]: 持ち主が CPU なので今まで通り聞かない', () => {
    const { s, cur } = armFeverTsumo(false);
    for (const p of [0, 1, 2]) s.cpu[p] = p === cur;
    game.cpuStep();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.lastWinner).toBe(cur);
    expect(after.game.fuyuConsumed[cur]).toBe(false);
  });

  it('CPU の和了者 [逆] と CPU の下家: 聞かずに保留', () => {
    const { s, cur, shimocha } = armFeverTsumo(true);
    for (const p of [0, 1, 2]) s.cpu[p] = p === cur || p === shimocha;
    game.cpuStep();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.lastWinner).toBe(cur);
    expect(after.game.fuyuConsumed[cur]).toBe(false);
  });
});
