// クラウドレビュー 11-02 #2: CPU の和了者の金北の自動選択 [autoResolveKinpei] が、逆の下家 CPU の
// 冬の判定より先に冬を含めて走っていた。下家 CPU が保留すると kinpeiTarget='fuyu' のまま
// fuyuConsumed=false になり、金北が無駄になっていた [CPU ツモ cpuActions / CPU ロンの各経路]。
// 期待: 保留なら金北の自動の強化先に冬を選ばない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { game, cpuShimochaFuyuPending } from '../store';
import { buildShoupai } from '../game3';

function arm(opts: { hua: string[]; fixDora?: boolean }): any {
  const s: any = get(game);
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  g.huapai[cur] = opts.hua;
  g.lizhi.add(cur);
  g.feverActive[cur] = true;
  g.feverDeclareTing[cur] = ['m5'];
  g.pochiMultiplier[cur] = { defen: -1, chip: -1 };
  g.pochiPaymentMode[cur] = true;
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
  sp.zimo('m5');
  g.shoupai.set(cur, sp);
  s.lastZimo = 'm5';
  const wall = g.shan as any;
  if (opts.fixDora) {
    // 乱数のドラ表示の華を消して決定的にする
    wall._baopai = ['m1']; wall._fubaopai = ['m2']; wall._committedBaopaiLen = 1; wall._committedFubaopaiLen = 1;
  }
  wall._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  for (let i = 0; i < 4; i++) wall._pai.push('m5');
  wall._pai.unshift('z1', 'z2');
  g.nukidoraGold[cur] = 1;
  for (const p of [0, 1, 2]) s.cpu[p] = true;
  return { s, g, cur };
}

describe('review 11-02 #2: CPU の和了者 + 下家 CPU が冬を保留 → 金北の自動選択は冬を外す', () => {
  beforeEach(() => {
    // 山 [待ちの残り] で下家 CPU の判定が変わるので乱数を固定する
    let x = 12345;
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockImplementation(() => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; });
    game.reset();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('CPU ツモ [ドラ表示の華なし、冬 + 夏]: 保留して金北は夏へ', () => {
    const { s, cur } = arm({ hua: ['f4', 'f2'], fixDora: true });
    expect(cpuShimochaFuyuPending(s, cur)).toBe(true);
    game.cpuStep();
    const after: any = get(game);
    expect(after.lastWinner).toBe(cur);
    expect(String(after.message)).toContain('保留');
    expect(after.game.fuyuConsumed[cur]).toBe(false);
    expect(after.game.kinpeiTarget[cur]).not.toBe('fuyu');
  });

  it('CPU ツモ [冬 + 秋]: 冬を使わないのに金北が冬に付かない', () => {
    const { s, cur } = arm({ hua: ['f4', 'f3'] });
    expect(cpuShimochaFuyuPending(s, cur)).toBe(true);
    game.cpuStep();
    const after: any = get(game);
    expect(String(after.message)).toContain('保留');
    expect(after.game.fuyuConsumed[cur]).toBe(false);
    expect(after.game.kinpeiTarget[cur]).not.toBe('fuyu');
  });

  it('CPU ロン [人間の打牌を逆フィーバーの CPU がロン、下家も CPU]: 金北が冬なら冬は使われている', () => {
    const s: any = get(game);
    const g = s.game;
    const h = g.lunbanToPlayerId(g.state.lunban);
    const F = (h + 2) % 3; // F の下家 = (F + 2) % 3 = (h + 1) % 3 = CPU
    s.cpu = { 0: true, 1: true, 2: true };
    s.cpu[h] = false;
    g.diyizimo = false;
    for (const p of [0, 1, 2]) { g.huapai[p] = []; g.nukidoraGold[p] = 0; g.goldHand[p] = { p: 0, s: 0, z: 0 }; g.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 }; g.nukidora[p] = 0; }
    g.huapai[F] = ['f4', 'f2'];
    g.nukidoraGold[F] = 1;
    g.lizhi.add(F);
    g.feverActive[F] = true;
    g.feverDeclareTing[F] = ['s2'];
    g.pochiMultiplier[F] = { defen: -1, chip: -1 };
    g.pochiPaymentMode[F] = true;
    g.shoupai.set(F, buildShoupai(['m1', 'm1', 'm1', 'p9', 'p9', 'p9', 's1', 's1', 's1', 'z1', 'z1', 'z1', 's2']));
    const hsp = buildShoupai(['m9', 'm9', 'p1', 'p1', 's9', 's9', 'z2', 'z3', 'z6', 'z7', 'm9', 'p1', 'p8']);
    hsp.zimo('s2');
    g.shoupai.set(h, hsp);
    (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2', 's2', 's2');
    s.lastZimo = 's2';
    s.lastDapai = null;
    expect(cpuShimochaFuyuPending(s, F)).toBe(true);
    game.discard('s2');
    const after: any = get(game);
    expect(after.lastWinner).toBe(F);
    expect(after.game.kinpeiTarget[F]).not.toBeNull();
    if (after.game.kinpeiTarget[F] === 'fuyu') expect(after.game.fuyuConsumed[F]).toBe(true);
    if (!after.game.fuyuConsumed[F]) expect(after.game.kinpeiTarget[F]).toBe('natsu');
  });
});
