// [2026-11-05 リョー「アガリ牌が見えない状態からにして」] ツモった瞬間に事故は起きるものさを知るための試し打ち [store.jikoPreCheck]
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game, jikoPreCheck } from '../store';
import { buildShoupai } from '../game3';

function arm(opts: { reverse?: boolean; fever?: boolean; chip?: { defen: number; chip: number } } = {}): any {
  const { reverse = true, fever = true, chip } = opts;
  const s: any = get(game);
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  g.lizhi.add(cur);
  g.feverActive[cur] = fever;
  g.feverDeclareTing[cur] = fever ? ['m5'] : [];
  g.pochiMultiplier[cur] = chip ?? (reverse ? { defen: -1, chip: -1 } : { defen: 1, chip: 1 });
  g.pochiPaymentMode[cur] = reverse;
  // 配牌の乱数で冬 ・ 金北が混ざると人に聞く和了になるので、勝者の華と金を空にして決め打ちにする
  g.huapai[cur] = [];
  g.nukidora[cur] = 0;
  g.nukidoraGold[cur] = 0;
  g.goldHand[cur] = { p: 0, s: 0, z: 0 };
  g.fuyuConsumed[cur] = false;
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
  sp.zimo('m5');
  g.shoupai.set(cur, sp);
  s.lastZimo = 'm5';
  (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  for (const p of [0, 1, 2]) s.cpu[p] = false;
  return { s, g, cur };
}

/** 局の持ち物を丸ごと JSON にして前後比較する [関数 ・ Map ・ Set は中身を並べる] */
function dump(g: any): string {
  const canon = (v: any): any => {
    if (v instanceof Map) return canon([...v.entries()]);
    if (v instanceof Set) return canon([...v]);
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => typeof v[k] !== 'function').map((k) => [k, canon(v[k])]));
    return v;
  };
  return JSON.stringify(canon(g));
}

describe('jikoPreCheck: ツモった瞬間の試し打ち', () => {
  beforeEach(() => { game.reset(); });

  it('フィーバー中の逆のツモで 50 枚以上減るなら当たりを返し、本物の和了と同じ枚数 ・ 色になる', () => {
    const { s, g, cur } = arm({ chip: { defen: -1, chip: -2 } });
    const pre = jikoPreCheck(s);
    // 本物のツモの結果と一致する [偽の暗転を出さない]
    game.tsumo();
    const real: any = (get(game) as any).lastHuleResult;
    const realLoss = -real.chipTransfer.delta[cur];
    if (realLoss >= 50) {
      expect(pre).toEqual({ player: cur, loss: realLoss, pochi: 'red' });
    } else {
      expect(pre).toBeNull();
    }
    void g;
  });

  it('50 枚以上減る場面を作って当たりが返る', () => {
    // チップ倍率を大きくして確実に 50 枚以上にする
    const { s, cur, g } = arm({ chip: { defen: -1, chip: -40 } });
    const pre = jikoPreCheck(s);
    expect(pre).not.toBeNull();
    expect(pre!.player).toBe(cur);
    expect(pre!.loss).toBeGreaterThanOrEqual(50);
    game.tsumo();
    const real: any = (get(game) as any).lastHuleResult;
    expect(-real.chipTransfer.delta[cur]).toBe(pre!.loss);
    void g;
  });

  it('50 枚に届かなければ null [倍率 -1 の逆は本物の和了でも 50 枚未満]', () => {
    const { s, cur } = arm({ chip: { defen: -1, chip: -1 } });
    const pre = jikoPreCheck(s);
    game.tsumo();
    const real: any = (get(game) as any).lastHuleResult;
    expect(-real.chipTransfer.delta[cur]).toBeLessThan(50);
    expect(pre).toBeNull();
  });

  it('フィーバーでない逆 ・ 逆でない正 ・ リーチしていない人は null', () => {
    expect(jikoPreCheck(arm({ chip: { defen: -1, chip: -40 }, fever: false }).s)).toBeNull();
    game.reset();
    expect(jikoPreCheck(arm({ reverse: false, chip: { defen: 1, chip: 40 } }).s)).toBeNull();
    game.reset();
    const { s, g, cur } = arm({ chip: { defen: -1, chip: -40 } });
    g.lizhi.delete(cur);
    expect(jikoPreCheck(s)).toBeNull();
  });

  it('CPU の手番は null [今まで通り和了の結果が来てから]', () => {
    const { s, cur } = arm({ chip: { defen: -1, chip: -40 } });
    s.cpu[cur] = true;
    expect(jikoPreCheck(s)).toBeNull();
  });

  it('試し打ちの前後で局の状態が変わらない [丸ごと比較 ・ イベント数 ・ 山 ・ 乱数]', () => {
    const { s, g } = arm({ chip: { defen: -1, chip: -40 } });
    const before = dump(g);
    const ev = g.events.length;
    const wall = JSON.stringify((g.shan as any)._pai);
    const dora = JSON.stringify([...g.shan.baopai]);
    const fubao = JSON.stringify(g.shan.fubaopai ?? null);
    const stBefore = JSON.stringify({ w: s.lastWinner, h: s.lastHuleResult, r: s.roundEnded, c: s.cutinQueue, m: s.message });
    expect(jikoPreCheck(s)).not.toBeNull();
    expect(jikoPreCheck(s)).not.toBeNull(); // 2 回目も同じ
    const after = dump(g);
    expect(after).toBe(before);
    expect(g.events.length).toBe(ev);
    expect(JSON.stringify((g.shan as any)._pai)).toBe(wall);
    expect(JSON.stringify([...g.shan.baopai])).toBe(dora);
    expect(JSON.stringify(g.shan.fubaopai ?? null)).toBe(fubao);
    expect(JSON.stringify({ w: s.lastWinner, h: s.lastHuleResult, r: s.roundEnded, c: s.cutinQueue, m: s.message })).toBe(stBefore);
    // 試し打ちの後でも本物のツモが普通に通る
    game.tsumo();
    expect((get(game) as any).lastWinner).not.toBeNull();
  });
});
