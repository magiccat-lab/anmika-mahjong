// [2026-11-05 リョー「アガリ牌が見えない状態からにして」] 事故は起きるものさの印が server の投影で全席に届く事と、client に取り込まれる事
import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import { createGameStore } from '../store';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import { buildShoupai } from '../game3';

function armed(chip: { defen: number; chip: number } | null) {
  const authority = createRoomAuthority({ preShuffledPool: generateTilePool(defaultSanmaRule()).map(String), qijia: 0 });
  const s: any = authority.canonicalState();
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  for (const p of [0, 1, 2]) s.cpu[p] = false;
  if (chip) {
    g.lizhi.add(cur);
    g.feverActive[cur] = true;
    g.feverDeclareTing[cur] = ['m5'];
    g.pochiMultiplier[cur] = chip;
    g.pochiPaymentMode[cur] = true;
    g.huapai[cur] = []; g.nukidora[cur] = 0; g.nukidoraGold[cur] = 0;
    g.goldHand[cur] = { p: 0, s: 0, z: 0 }; g.fuyuConsumed[cur] = false;
    const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
    sp.zimo('m5');
    g.shoupai.set(cur, sp);
    s.lastZimo = 'm5';
  }
  return { authority, cur };
}

describe('jikoPre の投影', () => {
  it('当たりなら全席 ・ 観戦に同じ印が載り、ツモ牌は含まない', () => {
    const { authority, cur } = armed({ defen: -1, chip: -2 });
    const seen = [0, 1, 2, -1].map((seat) => (captureSeatProjection(authority, seat) as any).store.jikoPre);
    expect(seen[0]).toBeTruthy();
    expect(seen[0].player).toBe(cur);
    expect(seen[0].loss).toBeGreaterThanOrEqual(50);
    for (const x of seen) expect(x).toEqual(seen[0]);
    expect(Object.keys(seen[0]).sort()).toEqual(['loss', 'player', 'pochi']);
  });

  it('条件を満たさない時は印が無い [フィーバー無し ・ 逆の枚数が小さい]', () => {
    const plain = armed(null);
    expect((captureSeatProjection(plain.authority, 0) as any).store.jikoPre ?? null).toBeNull();
    const small = armed({ defen: -1, chip: -1 });
    expect((captureSeatProjection(small.authority, 0) as any).store.jikoPre ?? null).toBeNull();
  });

  it('投影を取っても権威側の状態は変わらない', () => {
    const { authority } = armed({ defen: -1, chip: -2 });
    const g = authority.canonicalState().game;
    const before = JSON.stringify([g.events.length, g.chipLedger, [...g.shoupai.get(0)._bingpai.m ?? []]]);
    captureSeatProjection(authority, 1);
    expect(JSON.stringify([g.events.length, g.chipLedger, [...g.shoupai.get(0)._bingpai.m ?? []]])).toBe(before);
  });

  it('client は投影の jikoPre を取り込む [不正な値は捨てる]', () => {
    const { authority, cur } = armed({ defen: -1, chip: -2 });
    const projection: any = captureSeatProjection(authority, 1);
    const store = createGameStore();
    store.initOnlineGame({ ws: { readyState: 1, send() {} } as unknown as WebSocket, qijia: 0, mySeat: 1,
      blindStart: { hands: { 0: [], 1: [], 2: [] }, firstZimo: '', paishu: projection.shan.paishu, baopai: projection.shan.baopai, fubaopai: null } });
    store.hydrateOnlineProjection(projection);
    expect((get(store) as any).jikoPre?.player).toBe(cur);
    projection.store.jikoPre = { player: 9, loss: 'x' };
    store.hydrateOnlineProjection(projection);
    expect((get(store) as any).jikoPre ?? null).toBeNull();
  });
});
