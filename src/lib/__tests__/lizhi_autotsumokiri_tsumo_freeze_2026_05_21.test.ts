import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get } from 'svelte/store';
import { game } from '../store';
import { Game3, buildShoupai } from '../game3';
import { toCorePai } from '../helpers';
import type { PlayerId } from '../types';

// fixture は public repo に含めない [個人 chat log 由来]。
// ローカル regression 用、 fixture が無ければ test を skip する。
const LOG_PATH = resolve(__dirname, '__fixtures__/lizhi_autotsumokiri_tsumo_freeze_2026_05_21.paifu.json');

function loadFreezeLog(): any {
  return JSON.parse(readFileSync(LOG_PATH, 'utf8'));
}

function setLunbanToPlayer(g: Game3, player: PlayerId): void {
  g.state.lunban = (((g.currentOya - player) % 3 + 3) % 3) as any;
}

function initReplayRound(paifu: any, roundStart: number): Game3 {
  const g = new Game3({ qijia: paifu.state.qijia, changshu: 1 });
  g.state = {
    ...paifu.state,
    defen: { 0: 62800, 1: 21200, 2: 21000 },
    lizhibang: 0,
    lunban: 0,
  };
  g.events = [];
  for (let i = 0; i < 3; i++) {
    const ev = paifu.events[roundStart + i];
    g.shoupai.set(ev.player, buildShoupai(ev.tiles));
    g.events.push(ev);
  }
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as const) g.he.set(p, new HeCtor());
  const zimoEvents = paifu.events.slice(roundStart + 3).filter((e: any) => e.type === 'zimo').map((e: any) => e.pai);
  (g.shan as any)._pai = [...zimoEvents].reverse();
  (g.shan as any)._baopai = [...(paifu.shan.baopai ?? [])];
  (g.shan as any)._fubaopai = [...(paifu.shan.fubaopai ?? [])];
  return g;
}

function replayRoundToEvent(paifu: any, targetIdx: number): Game3 {
  const roundStart = 330;
  const g = initReplayRound(paifu, roundStart);
  for (let i = roundStart + 3; i <= targetIdx; i++) {
    const ev = paifu.events[i];
    if (ev.type === 'zimo') {
      setLunbanToPlayer(g, ev.player);
      const z = g.zimo();
      expect(z).toBe(ev.pai);
      const next = paifu.events[i + 1];
      if (next?.type === 'zimo' && next.player === ev.player && toCorePai(ev.pai) === 'z4') {
        const replacement = g.declareNukiBei(ev.player, { gold: ev.pai === 'gN' });
        expect(replacement).toBe(next.pai);
        i += 1;
      }
    } else if (ev.type === 'dapai') {
      setLunbanToPlayer(g, ev.player);
      g.dapai(ev.pai);
    } else if (ev.type === 'lizhi') {
      setLunbanToPlayer(g, ev.player);
      const ok = g.declareLizhi({ open: ev.open, fever: ev.fever, shuvari: ev.shuvari });
      if (!ok) g.lizhi.add(ev.player);
    }
  }
  return g;
}

const HAS_LOG = existsSync(LOG_PATH);
const d = HAS_LOG ? describe : describe.skip;

d('lizhi auto-tsumokiri winning zimo freeze 2026-05-21', () => {
  it('replays the supplied event-423 state and allows P0 tsumo on s4', () => {
    const paifu = loadFreezeLog();
    expect(paifu.events).toHaveLength(424);
    expect(paifu.events[392]).toMatchObject({ type: 'lizhi', player: 0 });
    expect(paifu.events[423]).toMatchObject({ type: 'zimo', player: 0, pai: 's4' });

    const replayed = replayRoundToEvent(paifu, 423);
    expect(replayed.lunbanToPlayerId(replayed.state.lunban)).toBe(0);
    expect(replayed.shoupai.get(0)?._zimo).toBe('s4');
    expect(replayed.lizhi.has(0)).toBe(true);
    expect(replayed.canTsumo(0)).toBe(true);

    game.loadFromPaifu(paifu);
    const before: any = get(game);
    const player = before.game.lunbanToPlayerId(before.game.state.lunban);

    expect(player).toBe(0);
    expect(before.lastZimo).toBe('s4');
    expect(before.lastWinner).toBeNull();
    expect(before.pendingKinpei).toBeNull();
    expect(before.pendingFuyu).toBeNull();
    expect(before.game.lizhi.has(0)).toBe(true);
    expect(before.game.shoupai.get(0)?._zimo).toBe('s4');
    expect(before.game.canTsumo(0)).toBe(true);

    game.tsumokiri();
    const afterAutoTsumokiri: any = get(game);
    expect(afterAutoTsumokiri.game.lunbanToPlayerId(afterAutoTsumokiri.game.state.lunban)).toBe(0);
    expect(afterAutoTsumokiri.game.shoupai.get(0)?._zimo).toBe('s4');
    expect(afterAutoTsumokiri.game.canTsumo(0)).toBe(true);
    expect(afterAutoTsumokiri.game.he.get(0)?._pai).not.toContain('s4');

    game.tsumo();

    const pending: any = get(game);
    expect(pending.pendingKinpei).toMatchObject({ winner: 0, isRon: false, ronfrom: null });
    expect(pending.lastWinner).toBeNull();

    game.selectKinpei('aki');

    const after: any = get(game);
    expect(after.pendingKinpei).toBeNull();
    expect(after.lastWinner).toBe(0);
    expect(after.lastHuleResult).toBeTruthy();
    expect(after.roundEnded || after.pendingSaiKoro || after.pendingFuyu).toBeTruthy();
  });
});
