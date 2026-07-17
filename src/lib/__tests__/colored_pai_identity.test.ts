import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';
// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';

function forceTurn(g: Game3, player: PlayerId): void {
  g.state.lunban = (((g.currentOya - player) % 3 + 3) % 3) as any;
}

describe('colored/gold pai identity', () => {
  it('normalizes every expanded discard before majiang-core pon/kan candidate lookup', () => {
    const from = 0 as PlayerId;
    const player = 1 as PlayerId;
    const cases = [
      { discard: 'z5b', own: ['z5r', 'z5g', 'z5y'] },
      { discard: 'gp', own: ['p5', 'p5', 'p5'] },
      { discard: 'np3', own: ['p3', 'p3', 'p3'] },
    ] as const;

    for (const entry of cases) {
      const g = new Game3({ qijia: 0 });
      const filler = ['s1', 's2', 's3', 's4', 's5', 's6', 'z1', 'z2', 'm7', 'm9'];
      g.shoupai.set(player, buildShoupai([...entry.own, ...filler].slice(0, 13)));
      expect(g.getPonCandidates(player, from, entry.discard as any).length).toBeGreaterThan(0);
      expect(g.getDamingangCandidates(player, from, entry.discard as any).length).toBeGreaterThan(0);
    }
  });

  it('z5b is kept in hand and discardLog from hand to dapai', () => {
    const g = new Game3({ qijia: 0 });
    const player = 0 as PlayerId;
    const sp = buildShoupai(['z5b', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's3', 'm7', 'm9', 'z1', 'z2']);
    sp._zimo = 'z2';
    g.shoupai.set(player, sp);
    g.he.set(player, new Majiang.He());
    forceTurn(g, player);

    expect(sp._bingpai.z5b).toBe(1);
    g.dapai('z5b');

    expect(sp._bingpai.z5b).toBe(0);
    expect(g.discardLog[player].at(-1)).toMatchObject({ pai: 'z5b', pochi: 'blue' });
    expect(g.events.at(-1)).toMatchObject({ type: 'dapai', player, pai: 'z5b' });
  });

  it('z5r zimo remains a raw tile in hand until discard', () => {
    const g = new Game3({ qijia: 0 });
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's3', 'm7', 'm9', 'z1', 'z2']));
    g.he.set(player, new Majiang.He());
    (g.shan as any)._pai = ['z5r'];
    forceTurn(g, player);

    expect(g.zimo()).toBe('z5r');
    const sp = g.shoupai.get(player)!;
    expect(sp._bingpai.z5r).toBe(1);
    expect((g as any).lastZimoInfo).toMatchObject({ player, pai: 'z5r', pochi: 'red' });

    g.dapai('z5r');
    expect(sp._bingpai.z5r).toBe(0);
    expect(g.discardLog[player].at(-1)).toMatchObject({ pai: 'z5r', pochi: 'red', tsumogiri: true });
  });

  it('z5r called by pon is retained in fulou metadata and event', () => {
    const g = new Game3({ qijia: 0 });
    const ponPlayer = 1 as PlayerId;
    const fromPlayer = 0 as PlayerId;
    g.shoupai.set(ponPlayer, buildShoupai(['z5b', 'z5g', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'm7', 'm9', 'z1', 'z2', 'z3']));
    g.discardLog[fromPlayer].push({ pai: 'z5r', pochi: 'red' });

    expect(g.declarePon(ponPlayer, 'z555+', fromPlayer)).toBe(true);
    const sp = g.shoupai.get(ponPlayer)!;
    expect(sp._anmikaFulou.at(-1)).toMatchObject({ mianzi: 'z555+', taken: 'z5r' });
    expect(sp._anmikaFulouPhysical.at(-1)).toMatchObject({ mianzi: 'z555+', consumed: ['z5b', 'z5g'] });
    expect(sp._bingpai.__anmika.z5b).toBe(0);
    expect(sp._bingpai.__anmika.z5g).toBe(0);
    expect(g.events.at(-1)).toMatchObject({ type: 'fulou', player: ponPlayer, from: fromPlayer, pai: 'z5r' });
  });

  it('failed z5 damingang rolls back colored fulou metadata', () => {
    const g = new Game3({ qijia: 0 });
    const kanPlayer = 1 as PlayerId;
    const fromPlayer = 0 as PlayerId;
    g.shoupai.set(kanPlayer, buildShoupai(['z5b', 'z5g', 'z5y', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'm7', 'm9', 'z1', 'z2']));
    g.he.set(fromPlayer, new Majiang.He());
    g.discardLog[fromPlayer].push({ pai: 'z5r', pochi: 'red' });
    (g.shan as any)._pai = ['p1'];
    (g.shan as any)._rinshan = [];

    const sp = g.shoupai.get(kanPlayer)!;
    expect(g.declareDamingang(kanPlayer, 'z5555+', fromPlayer)).toBeNull();

    expect(sp._fulou).toEqual([]);
    expect(sp._anmikaFulou ?? []).toEqual([]);
    expect(sp._anmikaFulouPhysical ?? []).toEqual([]);
    expect(sp._bingpai.__anmika.z5b).toBe(1);
    expect(sp._bingpai.__anmika.z5g).toBe(1);
    expect(sp._bingpai.__anmika.z5y).toBe(1);
  });

  it('all z5 colors can be drawn and discarded without becoming plain z5', () => {
    const g = new Game3({ qijia: 0 });
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's3', 'm7', 'm9', 'z1', 'z2']));
    g.he.set(player, new Majiang.He());
    forceTurn(g, player);
    for (const pai of ['z5b', 'z5r', 'z5g', 'z5y'] as const) {
      (g.shan as any)._pai = [pai];
      expect(g.zimo()).toBe(pai);
      expect(g.shoupai.get(player)!._bingpai[pai]).toBe(1);
      g.dapai(pai);
      expect(g.discardLog[player].at(-1)?.pai).toBe(pai);
      expect(g.discardLog[player].at(-1)?.pai).not.toBe('z5');
      forceTurn(g, player);
    }
  });

  it('counts a called gold/rainbow physical tile with its own chip value', () => {
    const makeGame = () => {
      const g = new Game3({ qijia: 0 });
      const player = 0 as PlayerId;
      const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's3', 'm7', 'm9', 'z1', 'z2']);
      g.shoupai.set(player, sp);
      g.huapai[player] = [];
      (g.shan as any)._baopai = [];
      (g.shan as any)._fubaopai = [];
      return { g, player, sp };
    };

    const gold = makeGame();
    gold.sp._fulou = ['p550+'];
    gold.sp._anmikaFulou = [{ mianzi: 'p550+', from: 1, taken: 'gp' }];
    gold.g.applyChipsOnHule({ hupai: [], fanshu: 1, fu: 30, damanguan: 0 }, gold.player, null);
    expect(gold.g.chipBreakdown.some((entry: any) => entry.label === '金 5 ×1' && entry.base === 4)).toBe(true);
    expect(gold.g.chipBreakdown.some((entry: any) => String(entry.label).startsWith('赤 5'))).toBe(false);

    const rainbow = makeGame();
    rainbow.sp._fulou = ['p333+'];
    rainbow.sp._anmikaFulou = [{ mianzi: 'p333+', from: 1, taken: 'np3' }];
    rainbow.g.applyChipsOnHule({ hupai: [], fanshu: 1, fu: 30, damanguan: 0 }, rainbow.player, null);
    expect(rainbow.g.chipBreakdown.some((entry: any) => entry.label === '虹 ×1' && entry.base === 7)).toBe(true);
  });
});
