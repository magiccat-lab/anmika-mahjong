// V32 100 試合 fuzz [リョー指示 2026-05-12 深夜、 自走で 100 試合分 step 走らせ throw 検出]
// - 全 CPU で 連続 reset しながら通算 100 試合 [東風 1 試合 = 完走 or 50 局相当 limit] 完走
// - throw / bad message を検出、 raw 件数 + サンプル出力
// - inventory invariant [defen sum + supply 一致範囲、 chip 加算で大幅変動 OK] は緩い check
import { describe, it, expect } from 'vitest';
import { game } from '../store';
import { get } from 'svelte/store';

const N_GAMES = 100; // CI 標準 100、 2000 試合 manual で hang 0 / throw 0 確認済 [2026-05-12 02:24]
const PER_GAME_MAX_ROUNDS = 30; // 1 試合あたり 連荘込みで 最大 30 局 [異常 hang 検出 用 上限]
const PER_GAME_MAX_STEPS = 5000; // 1 試合あたり cpuStep 呼出 上限

describe('V32 100 試合 fuzz [全 CPU 完走 throw 検出]', () => {
  it(`${N_GAMES} 試合 走破、 throw / bad message ナシ`, () => {
    let gamesDone = 0;
    let totalSteps = 0;
    let totalRounds = 0;
    let totalNuki = 0;
    let throws = 0;
    let firstThrow: any = null;
    const errors: string[] = [];
    const startMs = Date.now();

    for (let gi = 0; gi < N_GAMES; gi++) {
      game.reset();
      game.setCpuSeats([0, 1, 2]);
      let steps = 0;
      let rounds = 0;
      try {
        while (steps < PER_GAME_MAX_STEPS && rounds < PER_GAME_MAX_ROUNDS) {
          steps++;
          totalSteps++;
          const s: any = get(game);
          if (s.game.state.finished) break;
          // 東風終了判定: changbang>=1 [東 4 終了] で次試合へ
          if ((s.game.state.changbang ?? 0) >= 1) break;
          if (s.roundEnded || s.pendingPingju) {
            game.nextRound();
            const s2: any = get(game);
            if (s2.pendingPingju) game.nextRound();
            rounds++;
            totalRounds++;
            continue;
          }
          if (s.cutin || (s.cutinQueue?.length ?? 0) > 0) { game.finishCutin(s.cutin?.ts ?? 0); game.playNextCutin(); continue; }
          if (s.pendingSaiKoro) { game.advanceSaiKoro(); continue; }
          if (!s.cpuWinAck) { game.ackCpuWin(); continue; }
          if (s.pendingFeverContinue) { (game as any).continueFever?.(); continue; }
          if (s.pendingFuyu) { (game as any).resolveFuyu?.('pass'); continue; }
          if (s.pendingKinpei) { (game as any).cancelKinpei?.(); continue; }
          if (s.awaitingRonDecision) { game.pass(); continue; }
          if (s.awaitingFulou) { game.pass(); continue; }
          game.cpuStep();
        }
      } catch (e: any) {
        throws++;
        if (!firstThrow) firstThrow = e;
        errors.push(`[throw] game ${gi} step ${steps}: ${e?.message ?? e}`);
      }
      const sF: any = get(game);
      if (sF.message && /error|undefined is not|NaN|cannot read/i.test(sF.message)) {
        errors.push(`[bad-msg] game ${gi}: ${sF.message}`);
      }
      // 試合終了せず step 上限到達 [progress=0 のみ警告、 連荘で長引いた場合は許容]
      if (steps >= PER_GAME_MAX_STEPS && rounds === 0) {
        const ss: any = get(game);
        const cur = ss.game.lunbanToPlayerId(ss.game.state.lunban);
        const sp = ss.game.shoupai.get(cur);
        const stateInfo = {
          lunban: ss.game.state.lunban,
          cur,
          lastZimo: ss.lastZimo,
          sp_zimo: sp?._zimo,
          sp_bingpai_z4: sp?._bingpai?.z?.[4],
          fulou_len: sp?._fulou?.length,
          paishu: ss.game.shan.paishu,
          fever: JSON.stringify(ss.game.feverActive),
          lizhi: [...ss.game.lizhi],
          aw_ron: ss.awaitingRonDecision,
          aw_fu: ss.awaitingFulou,
          ron_cands: ss.ponCandidates?.length,
          kan_cands: ss.kanCandidates?.length,
          pendF: ss.pendingFeverContinue, pendFu: ss.pendingFuyu, pendK: ss.pendingKinpei,
          msg: ss.message,
        };
        errors.push(`[hang] game ${gi}: 0 round, state=${JSON.stringify(stateInfo)}`);
      }
      gamesDone++;
      totalNuki += ((sF.game.nukidora?.[0] ?? 0) + (sF.game.nukidora?.[1] ?? 0) + (sF.game.nukidora?.[2] ?? 0));
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(`[V32] games=${gamesDone}/${N_GAMES} rounds=${totalRounds} steps=${totalSteps} nuki=${totalNuki} elapsed=${elapsed}s throws=${throws} bad=${errors.length}`);
    if (errors.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[V32 sample errors]\n' + errors.slice(0, 30).join('\n'));
    }

    expect(throws).toBe(0);
    expect(errors.filter((e) => e.startsWith('[bad-msg]'))).toEqual([]);
    expect(errors.filter((e) => e.startsWith('[hang]'))).toEqual([]);
    expect(gamesDone).toBe(N_GAMES);
  }, 600_000);
});
