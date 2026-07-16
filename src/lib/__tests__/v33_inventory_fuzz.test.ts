import { describe, it, expect } from 'vitest';
import { game } from '../store';
import { get } from 'svelte/store';
import { diffInventory } from '../game3/inventory';

const N_GAMES = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.V33_LONG) ? 1000 : 100;
const PER_GAME_MAX_ROUNDS = 30;
const PER_GAME_MAX_STEPS = 5000;
const CHECK_EVERY = 25;

describe('V33 inventory invariant fuzz [116 tiles, z5* leak detector]', () => {
  it(`${N_GAMES} CPU games keep inventory diff empty`, () => {
    let gamesDone = 0;
    let totalSteps = 0;
    const diffs: string[] = [];
    let firstDiffDump: any = null;
    const startMs = Date.now();

    for (let gi = 0; gi < N_GAMES; gi++) {
      game.reset();
      game.toggleCpu(0);
      game.toggleCpu(1);
      game.toggleCpu(2);
      let steps = 0;
      let rounds = 0;

      while (steps < PER_GAME_MAX_STEPS && rounds < PER_GAME_MAX_ROUNDS) {
        steps++;
        totalSteps++;
        const s: any = get(game);
        if (s.game.state.finished) break;
        if ((s.game.state.changbang ?? 0) >= 1) break;

        if (s.roundEnded || s.pendingPingju) {
          const d = diffInventory(s.game);
          if (d.length > 0 && diffs.length < 20) {
            const dumpKey = `g${gi}_r${rounds}_pre_next`;
            diffs.push(`[diff @ ${dumpKey}] ${JSON.stringify(d)}`);
            if (!firstDiffDump) firstDiffDump = { game: gi, round: rounds, steps, diff: d };
          }
          game.nextRound();
          const s2: any = get(game);
          if (s2.pendingPingju) game.nextRound();
          rounds++;
          continue;
        }

        if (s.cutin || (s.cutinQueue?.length ?? 0) > 0) {
          game.finishCutin(s.cutin?.ts ?? 0);
          game.playNextCutin();
          continue;
        }
        if (!s.cpuWinAck) { game.ackCpuWin(); continue; }
        if (s.pendingSaiKoro) {
          if (!s.pendingSaiKoro.selectedCombo) game.selectSaiKoroCombo(1, 6);
          else if (!s.pendingSaiKoro.finalized) game.rollSaiKoroDice([1, 2]);
          else game.advanceSaiKoro();
          continue;
        }
        if (s.pendingFeverContinue) { (game as any).continueFever?.(); continue; }
        if (s.pendingFuyu) { (game as any).resolveFuyu?.('pass'); continue; }
        if (s.pendingKinpei) { (game as any).cancelKinpei?.(); continue; }
        if (s.awaitingRonDecision) { game.pass(); continue; }
        if (s.awaitingFulou) { game.pass(); continue; }

        game.cpuStep();

        if (steps % CHECK_EVERY === 0) {
          const sa: any = get(game);
          const d = diffInventory(sa.game);
          if (d.length > 0 && diffs.length < 20) {
            const dumpKey = `g${gi}_step${steps}`;
            diffs.push(`[diff @ ${dumpKey}] ${JSON.stringify(d)}`);
            if (!firstDiffDump) firstDiffDump = { game: gi, round: rounds, steps, diff: d };
          }
        }
      }
      gamesDone++;
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(`[V33] games=${gamesDone}/${N_GAMES} steps=${totalSteps} elapsed=${elapsed}s diff_events=${diffs.length}`);
    if (diffs.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[V33 inventory diff samples]\n' + diffs.slice(0, 10).join('\n'));
      // eslint-disable-next-line no-console
      console.log('[V33 first diff dump]\n' + JSON.stringify(firstDiffDump, null, 2));
    }

    expect(diffs).toEqual([]);
  }, 600_000);
});
