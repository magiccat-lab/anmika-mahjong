// クラウドレビュー 11-02 #4 [28da56c: CPU 和了者でも、やめ権を持つ下家が人間なら冬の 使う / 保留 を聞く]
// ・CPU だけの槍槓 [processKakanQianggangWindow] は fuyuQuestionNeeded を見ておらず、人間の下家に聞かなかった
// ・CPU 2 人のダブロン [innerDiscard] は先頭の CPU にしか聞かず、席順で人間の下家に聞くかが変わっていた
// 期待: どちらも人間の下家に pendingFuyu [decisionOwners = 下家] を出す
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { game, processKakanQianggangWindow, fuyuQuestionNeeded } from '../store';
import { buildShoupai } from '../game3';
import { fuyuDecisionOwner } from '../store/winPipeline';

// 配牌 [山の待ちの残り ・ ドラ] で下家 CPU の冬の判定が変わり、全件の中で時々落ちたので乱数を固定する (review1102_02 と同じ)
beforeEach(() => {
  let x = 12345;
  vi.restoreAllMocks();
  vi.spyOn(Math, 'random').mockImplementation(() => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; });
});
afterEach(() => { vi.restoreAllMocks(); });

function armReverseFever(g: any, F: number, tile: string) {
  g.huapai[F] = ['f4'];
  g.lizhi.add(F);
  g.feverActive[F] = true;
  g.feverDeclareTing[F] = [tile];
  g.pochiMultiplier[F] = { defen: -1, chip: -1 };
  g.pochiPaymentMode[F] = true;
}

describe('review 11-02 #4: CPU 槍槓ロン [逆ぽっちフィーバー] は、やめ権を持つ人間の下家に冬を聞く', () => {
  it('人間 h の加槓を CPU F が槍槓 [F の下家 = h] → h に冬の問いが出る', () => {
    game.reset();
    const s: any = get(game);
    const g = s.game;
    const h = g.lunbanToPlayerId(g.state.lunban);
    const F = (h + 1) % 3;
    const O = (h + 2) % 3;
    s.cpu = { 0: true, 1: true, 2: true };
    s.cpu[h] = false;
    for (const p of [0, 1, 2]) { g.huapai[p] = []; g.nukidoraGold[p] = 0; g.goldHand[p] = { p: 0, s: 0, z: 0 }; }
    g.diyizimo = false;
    armReverseFever(g, F, 's2');
    g.shoupai.set(F, buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 's2']));
    g.shoupai.set(O, buildShoupai(['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z2', 'z3', 'z6', 'z7', 'p9', 's9', 'z2']));
    const hsp = buildShoupai(['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z2', 'z3', 'z6', 'z7']);
    hsp._fulou.push('s222=');
    hsp.zimo('s2');
    g.shoupai.set(h, hsp);
    (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2');
    s.lastZimo = 's2';
    s.lastDapai = null;
    expect(fuyuDecisionOwner(g, F)).toBe(h);
    expect(fuyuQuestionNeeded(s, F)).toBe(true);
    const out = processKakanQianggangWindow(s, 's222=2');
    const r: any = out.s;
    expect(out.handled).toBe(true);
    expect(r.pendingFuyu?.winner).toBe(F);
    expect(r.pendingFuyu?.decisionOwners).toEqual([h]);
    // 保留を選ぶと槍槓ロンとして精算される
    game.selectFuyu(false);
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.lastWinner).toBe(F);
    expect(after.game.fuyuConsumed[F]).toBe(false);
    expect((after.lastHuleResult?.hupai ?? []).map((y: any) => y.name)).toContain('槍槓');
  });
});

function setupDoubleRon(h: number) {
  game.reset();
  const s: any = get(game);
  const g = s.game;
  for (const lb of [0, 1, 2]) if (g.lunbanToPlayerId(lb) === h) { g.state.lunban = lb; break; }
  const F = (h + 1) % 3;
  const O = (h + 2) % 3;
  s.cpu = { 0: true, 1: true, 2: true };
  s.cpu[h] = false;
  g.diyizimo = false;
  for (const p of [0, 1, 2]) { g.huapai[p] = []; g.nukidoraGold[p] = 0; g.goldHand[p] = { p: 0, s: 0, z: 0 }; g.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 }; g.nukidora[p] = 0; }
  armReverseFever(g, F, 's2');
  g.shoupai.set(F, buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 's2']));
  g.shoupai.set(O, buildShoupai(['p2', 'p3', 'p4', 'p6', 'p7', 'p8', 's3', 's4', 's5', 's6', 's7', 's8', 's2']));
  g.lizhi.add(O); g.feverActive[O] = true; g.feverDeclareTing[O] = ['s2'];
  const hsp = buildShoupai(['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z2', 'z3', 'z6', 'z7', 'm1', 'm9', 'p9']);
  hsp.zimo('s2');
  g.shoupai.set(h, hsp);
  (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  s.lastZimo = 's2';
  s.lastDapai = null;
  return { s, g, F, O };
}

describe('review 11-02 #4: CPU 2 人のダブロンで、逆フィーバーの CPU の下家 [人間の放銃者] に席順によらず冬を聞く', () => {
  for (const h of [0, 1, 2]) {
    it(`放銃者 h=${h}`, () => {
      const { g, F, O } = setupDoubleRon(h);
      expect(fuyuDecisionOwner(g, F)).toBe(h);
      expect(g.canRon(F, 's2', h)).toBe(true);
      expect(g.canRon(O, 's2', h)).toBe(true);
      game.discard('s2');
      const r: any = get(game);
      expect(r.pendingFuyu?.winner).toBe(F);
      expect(r.pendingFuyu?.decisionOwners).toEqual([h]);
      // 保留を選ぶと両者のロンとして精算される [2 人目は冬の段の再計算が拾う]
      game.selectFuyu(false);
      const after: any = get(game);
      expect(after.pendingFuyu).toBeNull();
      expect((after.ronResults ?? []).map((x: any) => x.player).sort()).toEqual([F, O].sort());
    });
  }
});
