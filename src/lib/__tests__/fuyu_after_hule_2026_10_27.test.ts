// 2026-10-27 リョー「フィーバー中に冬でやめるかどうかは他の処理が終わってから決めたいな。
// 秋の新ドラで正ぽっちがめくれて正転なくなったから冬使ってやめるとかあるし」。
// 冬の 使う / 保留 は和了処理 [秋のめくり ・ ぽっちの選択] の後に聞き、その時の暫定和了と
// ドラ表を pendingFuyu に持たせる。表示は上がり確定まで増やさない [2026-07-21 秋ドラ根治] のまま。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

function armFeverTsumo(huapai: string[]): any {
  const s: any = get(game);
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  g.huapai[cur] = huapai;
  g.lizhi.add(cur);
  g.feverActive[cur] = true;
  g.feverDeclareTing[cur] = ['m5'];
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
  sp.zimo('m5');
  g.shoupai.set(cur, sp);
  s.lastZimo = 'm5';
  (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  return { s, g, cur };
}

describe('フィーバー中の冬は和了処理の後に聞く', () => {
  beforeEach(() => { game.reset(); });

  it('秋 + 冬: 秋のめくりを見せてから冬を聞き、表示と山は和了前に戻す', () => {
    const { g, cur } = armFeverTsumo(['f3', 'f4']);
    const baopaiBefore = [...g.shan.baopai];
    const dispBefore = g.shan.displayBaopai.length;
    game.tsumo();
    const mid: any = get(game);
    expect(mid.pendingFuyu?.winner).toBe(cur);
    expect(mid.pendingFuyu.preview?.hupai?.length).toBeGreaterThan(0);
    expect(mid.pendingFuyu.previewShownBaopai).toBe(dispBefore);
    expect(mid.pendingFuyu.previewBaopai.length).toBeGreaterThan(dispBefore);
    expect([...mid.game.shan.baopai]).toEqual(baopaiBefore);
    expect(mid.game.shan.displayBaopai.length).toBe(dispBefore);
    expect(mid.roundEnded).toBe(false);
    // 保留で同じ和了を再計算し、秋のめくりは同じ並びで出る [store は同じ object を書き換えるので先に写す]
    const shown = [...mid.pendingFuyu.previewBaopai];
    game.selectFuyu(false);
    const done: any = get(game);
    expect(done.pendingFuyu).toBeNull();
    expect([...done.game.shan.baopai].slice(0, shown.length)).toEqual(shown);
  });

  it('冬だけ: めくれた分は無く、暫定和了は持つ', () => {
    const { cur } = armFeverTsumo(['f4']);
    game.tsumo();
    const mid: any = get(game);
    expect(mid.pendingFuyu?.winner).toBe(cur);
    expect(mid.pendingFuyu.preview).not.toBeNull();
    expect(mid.pendingFuyu.previewBaopai.length).toBe(mid.pendingFuyu.previewShownBaopai);
  });

  it('待ち牌が山に無ければ聞かずに冬を使う [機能 11]', () => {
    const { g, cur } = armFeverTsumo(['f4']);
    for (const k of ['_pai', '_rinshan', '_fubaopai']) (g.shan as any)[k] = (((g.shan as any)[k] as string[]) ?? []).filter((p) => p !== 'm5' && p !== 'm0');
    game.tsumo();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.game.fuyuConsumed[cur]).toBe(true);
  });
});
