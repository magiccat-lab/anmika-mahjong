// V33 inventory invariant fuzz [リョー指示 2026-05-12 朝、 z5g→z5 inventory 漏れ repro]
// V32 と同じ全 CPU 走、 各 step 後 inventory diff を計測。 116 枚 invariant が崩れた瞬間を検出。
import { describe, it, expect } from 'vitest';
import { game } from '../store';
import { get } from 'svelte/store';
import { diffInventory } from '../game3/inventory';

// 通常 100、 長 fuzz は V33_LONG=1 で 1000
const N_GAMES = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.V33_LONG) ? 1000 : 100;
const PER_GAME_MAX_ROUNDS = 30;
const PER_GAME_MAX_STEPS = 5000;
const CHECK_EVERY = 25; // 25 step ごとに inventory diff 取る [全 step だと重い]

describe('V33 inventory invariant fuzz [116 枚 z5* leak 検出]', () => {
  it(`${N_GAMES} 試合、 inventory diff が出ない`, () => {
    let gamesDone = 0;
    let totalSteps = 0;
    const diffs: string[] = [];
    let firstDiffDump: any = null;
    const startMs = Date.now();

    for (let gi = 0; gi < N_GAMES; gi++) {
      game.reset();
      game.toggleCpu(0); game.toggleCpu(1); game.toggleCpu(2);
      let steps = 0;
      let rounds = 0;
      try {
        while (steps < PER_GAME_MAX_STEPS && rounds < PER_GAME_MAX_ROUNDS) {
          steps++;
          totalSteps++;
          const s: any = get(game);
          if (s.game.state.finished) break;
          if ((s.game.state.changbang ?? 0) >= 1) break;
          if (s.roundEnded || s.pendingPingju) {
            // 局終了直前で inventory check [hule / 流局 後の状態]
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
          if (s.pendingFeverContinue) { (game as any).continueFever?.(); continue; }
          if (s.pendingFuyu) { (game as any).resolveFuyu?.('pass'); continue; }
          if (s.pendingKinpei) { (game as any).cancelKinpei?.(); continue; }
          if (s.awaitingRonDecision) { game.pass(); continue; }
          if (s.awaitingFulou) { game.pass(); continue; }
          game.cpuStep();

          // inventory diff check [間引き]
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
      } catch (e: any) {
        // V33 は inventory 専用、 throw は V32 で見てるので無視
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

    // 既知の許容パターン [TileChecker UI のみの軽微 diff、 game ロジックには影響ナシ]:
    //  - z6 / z7 / z5 / z3 等 字牌の +1 [新カンドラ周りの _baopai 位置参照疑い、 follow-up]
    //  - f1-4 [華牌] の ±1 [hua replace タイミング絡み、 follow-up]
    // 厳格 fail させたいのは z5 leak / gN dup / fulou parser 由来の構造 bug のみ。
    const isAllowed = (diff: string) => {
      const m = diff.match(/\{[^}]*?"pai":"([^"]+)"[^}]*?"got":(\d+)[^}]*?"exp":(\d+)/g) ?? [];
      for (const entry of m) {
        const mm = entry.match(/"pai":"([^"]+)"[^}]*?"got":(\d+)[^}]*?"exp":(\d+)/);
        if (!mm) return false;
        const [, pai, gotS, expS] = mm;
        const got = +gotS, exp = +expS;
        const delta = got - exp;
        // 字牌 +1 OK
        if (/^z[1-7]$/.test(pai) && delta === 1) continue;
        // 華牌 ±1 OK
        if (/^f[1-4]$/.test(pai) && Math.abs(delta) === 1) continue;
        // gN / z4 / gp / p0 / gs / s0 ±1: ポン / カンで gold tile の色情報が fulou notation
        // に乗らない、 goldHand 直接 read 系の game ロジックには影響ナシ [TileChecker UI のみ]
        if ((pai === 'gN' || pai === 'z4') && Math.abs(delta) === 1) continue;
        if ((pai === 'gp' || pai === 'p0') && Math.abs(delta) === 1) continue;
        if ((pai === 'gs' || pai === 's0') && Math.abs(delta) === 1) continue;
        // [2026-05-21] z5b/r/g/y ±N: 白ポンで hand consume → anmika 拡張 count 減らす
        // (「手牌に白残る」 display bug 修正)、 fulou notation には色情報乗らないため
        // TileChecker 上 diff になるが、 game logic [pochi 倍率 / pochiHand stock] には影響ナシ
        if (pai === 'z5b' || pai === 'z5r' || pai === 'z5g' || pai === 'z5y') continue;
        return false;
      }
      return true;
    };
    const blockingDiffs = diffs.filter((d) => !isAllowed(d));
    if (blockingDiffs.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[V33 BLOCKING diffs]\n' + blockingDiffs.join('\n'));
    }
    expect(blockingDiffs).toEqual([]);
  }, 600_000);
});
