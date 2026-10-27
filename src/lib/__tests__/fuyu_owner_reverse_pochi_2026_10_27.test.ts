// 2026-10-27 isg. 通報「ちょいちょいフィーバーの継続決定権がおかしい」[room 5YMV rev 358]。
// フィーバー中に逆ぽっちをツモると、冬の 使う / 保留 [= フィーバーをやめるか続けるか] を
// 同卓者が決めていた。ルール 5-5「冬を抜いている: 任意のアガリ時にフィーバーを終了して
// アリス・チューリップ発動可」は立直者の選択で、同卓者が選ぶのは逆ぽっちツモ時の金北の強化先だけ。
// リョー「秋の新ドラで正ぽっちがめくれて正転なくなったから冬使ってやめる」も立直者の判断。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

function armReverseFeverTsumo(): any {
  const s: any = get(game);
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  g.huapai[cur] = ['f4'];
  g.lizhi.add(cur);
  g.feverActive[cur] = true;
  g.feverDeclareTing[cur] = ['m5'];
  g.pochiMultiplier[cur] = { defen: -1, chip: -1 };
  g.pochiPaymentMode[cur] = true;
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
  sp.zimo('m5');
  g.shoupai.set(cur, sp);
  s.lastZimo = 'm5';
  (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  for (const p of [0, 1, 2]) s.cpu[p] = false;
  return { s, g, cur };
}

describe('フィーバー中の冬 [継続するか] は逆ぽっちでも立直者が決める', () => {
  beforeEach(() => { game.reset(); });

  it('逆ぽっち中のツモ: 冬の選択は和了者だけ', () => {
    const { g, cur } = armReverseFeverTsumo();
    expect(g.pochiPaymentMode[cur]).toBe(true);
    game.tsumo();
    const mid: any = get(game);
    expect(mid.pendingFuyu?.winner).toBe(cur);
    expect(mid.pendingFuyu.decisionOwners).toEqual([cur]);
  });

  it('逆ぽっち中でも待ち牌が山に無ければ聞かずに冬を使う [機能 11]', () => {
    const { g, cur } = armReverseFeverTsumo();
    for (const k of ['_pai', '_rinshan', '_fubaopai']) (g.shan as any)[k] = (((g.shan as any)[k] as string[]) ?? []).filter((p) => p !== 'm5' && p !== 'm0');
    game.tsumo();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.game.fuyuConsumed[cur]).toBe(true);
  });
});
