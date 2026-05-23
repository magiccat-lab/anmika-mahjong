import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game3, buildShoupai, toCorePai } from '../game3';
import type { PlayerId } from '../types';

// fixture は public repo に含めない [サイズ + 個人 chat log 由来]。
// ローカル regression 用、 fixture が無ければ test を skip する。
const PAIFU_PATH = resolve(__dirname, '__fixtures__/bug_2026_05_21_south_round_fanpai.paifu.json');

function removeOne(tiles: string[], pai: string): void {
  const target = toCorePai(pai);
  const idx = tiles.findIndex((t) => toCorePai(t) === target);
  if (idx < 0) throw new Error(`missing tile ${pai} in ${tiles.join(' ')}`);
  tiles.splice(idx, 1);
}

function replayLastRoundBeforeFinalHule(paifu: any): Game3 {
  const roundStart = 119;
  const targetHule = 207;
  const g = new Game3({ qijia: paifu.state.qijia, changshu: 1 });
  g.state = {
    ...paifu.state,
    changbang: 0,
    jushu: 2,
    benbang: 0,
    lizhibang: 0,
    defen: { 0: 27000, 1: 60200, 2: 15800 },
    finished: false,
  };

  const concealed: Record<PlayerId, string[]> = { 0: [], 1: [], 2: [] };
  const fulou: Record<PlayerId, string[]> = { 0: [], 1: [], 2: [] };

  for (let i = roundStart; i < targetHule; i++) {
    const ev = paifu.events[i];
    if (ev.type === 'qipai') {
      concealed[ev.player as PlayerId] = [...ev.tiles];
    } else if (ev.type === 'zimo') {
      concealed[ev.player as PlayerId].push(ev.pai);
    } else if (ev.type === 'dapai') {
      removeOne(concealed[ev.player as PlayerId], ev.pai);
    } else if (ev.type === 'gang') {
      const player = ev.player as PlayerId;
      const tile = ev.mianzi.slice(0, 2);
      for (let n = 0; n < 4; n++) removeOne(concealed[player], tile);
      fulou[player].push(ev.mianzi);
    } else if (ev.type === 'fulou') {
      const player = ev.player as PlayerId;
      for (let n = 0; n < 2; n++) removeOne(concealed[player], ev.pai);
      fulou[player].push(ev.mianzi);
    } else if (ev.type === 'lizhi') {
      const player = ev.player as PlayerId;
      g.lizhi.add(player);
      g.yifaActive[player] = false;
      if (ev.open) g.openLizhi.add(player);
      if (ev.fever) g.feverActive[player] = true;
      if (ev.shuvari) g.shuvariActive[player] = true;
    }
  }

  for (const p of [0, 1, 2] as PlayerId[]) {
    const sp = buildShoupai(concealed[p]);
    sp._fulou = [...fulou[p]];
    g.shoupai.set(p, sp);
  }
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());

  (g.shan as any)._pai = [...(paifu.shan.currentPai ?? [])];
  (g.shan as any)._baopai = [...(paifu.shan.baopai ?? [])];
  (g.shan as any)._fubaopai = [...(paifu.shan.fubaopai ?? [])];

  return g;
}

const HAS_PAIFU = existsSync(PAIFU_PATH);
const d = HAS_PAIFU ? describe : describe.skip;

d('south round fanpai regression 2026-05-21', () => {
  it('paifu event 207 is evaluated before nextRound, so top-level changbang=1 must not be used for hule-time yaku', () => {
    const paifu = JSON.parse(readFileSync(PAIFU_PATH, 'utf8'));
    expect(paifu.state.changbang).toBe(1);
    expect(paifu.state.jushu).toBe(0);
    expect(paifu.events[207]).toMatchObject({ type: 'hule', player: 0, isRon: true, isOya: false });

    const g = replayLastRoundBeforeFinalHule(paifu);
    expect(g.state.changbang).toBe(0);
    expect(g.state.jushu).toBe(2);
    expect(g.changfengZ).toBe(1);
    expect(g.zifengZ(0)).toBe(3);
    expect(g.shoupai.get(0)?._fulou).toContain('z2222');

    const result = g.hule(0, 'p3', 1);
    expect(result).not.toBeNull();
    expect(result.hupai.map((h: any) => h.name)).not.toContain('場風 南');
  });

  it('actual changbang=1 hule with z2222 ankan includes 場風 南', () => {
    const paifu = JSON.parse(readFileSync(PAIFU_PATH, 'utf8'));
    const g = replayLastRoundBeforeFinalHule(paifu);
    g.state.changbang = 1;
    g.state.jushu = 2;

    const result = g.hule(0, 'p3', 1);
    expect(result).not.toBeNull();
    expect(result.hupai.map((h: any) => h.name)).toContain('場風 南');
  });

  it('hule event records hule-time round state and hupai before top-level state can advance', () => {
    const paifu = JSON.parse(readFileSync(PAIFU_PATH, 'utf8'));
    const g = replayLastRoundBeforeFinalHule(paifu);

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
      menfeng: 2,
    });
    expect(ev.hupai.map((h: any) => h.name)).not.toContain('場風 南');
  });
});
