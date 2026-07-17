import { describe, expect, it } from 'vitest';
// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { Game3, buildShoupai } from '../game3';
import { computeTileInventory, diffInventory, expectedInventory } from '../game3/inventory';

function fillWallToExpectedInventory(g: Game3): void {
  const shan = g.shan as any;
  shan._pai = [];
  shan._rinshan = [];
  shan._baopai = [];
  shan._fubaopai = [];
  shan._fuyuRevealed = [];

  const got = computeTileInventory(g);
  const exp = expectedInventory();
  const wall: string[] = [];
  for (const pai of Object.keys(exp).sort()) {
    const missing = exp[pai] - (got[pai] ?? 0);
    if (missing < 0) throw new Error(`synthetic fixture overuses ${pai}: got=${got[pai]} exp=${exp[pai]}`);
    for (let i = 0; i < missing; i++) wall.push(pai);
  }
  shan._pai = wall;
}

function buildSouthAnkanRonState(changbang: number): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  g.state = {
    changbang,
    jushu: 2,
    benbang: 0,
    lizhibang: 0,
    qijia: 0,
    defen: { 0: 27000, 1: 60200, 2: 15800 },
    lunban: 0,
    finished: false,
  };
  g.huapai = { 0: [], 1: [], 2: [] };
  g.lizhi.add(0);
  g.diyizimo = false;

  const winner = buildShoupai(['p1', 'p2', 'p4', 'p5', 'p6', 's1', 's2', 's3', 'z3', 'z3']);
  winner._fulou = ['z2222'];
  g.shoupai.set(0, winner);
  g.shoupai.set(1, buildShoupai([]));
  g.shoupai.set(2, buildShoupai([]));

  for (const p of [0, 1, 2] as const) g.he.set(p, new Majiang.He());
  g.he.get(1)._pai = ['p3'];
  g.discardLog = { 0: [], 1: [{ pai: 'p3', tsumogiri: false } as any], 2: [] };

  fillWallToExpectedInventory(g);
  expect(diffInventory(g)).toEqual([]);
  return g;
}

describe('south round fanpai regression 2026-05-21', () => {
  it('hule uses the hule-time changbang, not a later top-level paifu state', () => {
    const g = buildSouthAnkanRonState(0);
    expect(g.changfengZ).toBe(1);
    expect(g.zifengZ(0)).toBe(2); // 風回転修正 2026-07-17: oya=1 で P0 は南家
    expect(g.shoupai.get(0)?._fulou).toContain('z2222');

    const result = g.hule(0, 'p3', 1);
    expect(result).not.toBeNull();
    expect(result.hupai.map((h: any) => h.name)).not.toContain('場風 南');
  });

  it('actual changbang=1 hule with z2222 ankan includes 場風 南', () => {
    const g = buildSouthAnkanRonState(1);
    expect(g.changfengZ).toBe(2);

    const result = g.hule(0, 'p3', 1);
    expect(result).not.toBeNull();
    expect(result.hupai.map((h: any) => h.name)).toContain('場風 南');
  });

  it('hule event records hule-time round state and hupai before top-level state can advance', () => {
    const g = buildSouthAnkanRonState(0);

    const result = g.hule(0, 'p3', 1);
    g.applyHule(result, 0, 1);
    const ev = g.events.at(-1) as any;

    expect(ev).toMatchObject({
      type: 'hule',
      player: 0,
      isRon: true,
      isOya: false,
      changbang: 0,
      jushu: 2,
      zhuangfeng: 0,
      menfeng: 1, // 風回転修正 2026-07-17: oya=1 で P0 は南家 [0-indexed 1]
    });
    expect(ev.hupai.map((h: any) => h.name)).not.toContain('場風 南');
  });
});
