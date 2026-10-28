// CPU テンパイ価値の計測 [CPU_VALUE_MEASURE=1 の時だけ走る]。価値あり / 無しの選択の差と、足した時間を数える。
import { describe, it, expect } from 'vitest';
import { game } from '../store';
import { get } from 'svelte/store';
import { Game3 } from '../game3';

const RUN = process.env.CPU_VALUE_MEASURE === '1';
const TARGET = Number(process.env.CPU_VALUE_DECISIONS ?? 2000);

describe.skipIf(!RUN)('CPU テンパイ価値: 選択が変わる割合と時間', () => {
  it('全 CPU で回して、従来との差を数える', () => {
    const proto: any = Game3.prototype;
    const orig = proto.selectBestFromRows_;
    let decisions = 0, tenpai = 0, changed = 0, changedAmongTenpai = 0, valueCalls = 0;
    const tenpaiMs: number[] = [];
    proto.selectBestFromRows_ = function (rows: any[], fold: boolean, valueOf?: (r: any) => number) {
      const t0 = performance.now();
      const withV = orig.call(this, rows, fold, valueOf);
      const dt = performance.now() - t0;
      const base = orig.call(this, rows, fold, undefined);
      decisions++;
      const hasTenpai = !fold && rows.some((r) => r.xiangting === 0);
      if (hasTenpai) { tenpai++; tenpaiMs.push(dt); }
      if (withV !== base) { changed++; if (hasTenpai) changedAmongTenpai++; }
      if (valueOf) valueCalls++;
      return withV;
    };
    try {
      for (let gi = 0; gi < 5000 && decisions < TARGET; gi++) {
        game.reset();
        game.setCpuSeats([0, 1, 2]);
        let steps = 0, rounds = 0;
        while (steps < 5000 && rounds < 30 && decisions < TARGET) {
          steps++;
          const s: any = get(game);
          if (s.game.state.finished) break;
          // 東風終了判定: changbang>=1 [東 4 終了] で次試合へ
          if ((s.game.state.changbang ?? 0) >= 1) break;
          if (s.roundEnded || s.pendingPingju) {
            game.nextRound();
            const s2: any = get(game);
            if (s2.pendingPingju) game.nextRound();
            rounds++;
            
            continue;
          }
          if (s.cutin || (s.cutinQueue?.length ?? 0) > 0) { game.finishCutin(s.cutin?.ts ?? 0); game.playNextCutin(); continue; }
          if (s.pendingSaiKoro) {
            if (!s.pendingSaiKoro.selectedCombo) game.selectSaiKoroCombo(1, 6);
            else if (!s.pendingSaiKoro.finalized) game.rollSaiKoroDice([1, 2]);
            else game.advanceSaiKoro();
            continue;
          }
          if (!s.cpuWinAck) { game.ackCpuWin(); continue; }
          if (s.pendingFeverContinue) { (game as any).continueFever?.(); continue; }
          if (s.pendingFuyu) { (game as any).resolveFuyu?.('pass'); continue; }
          if (s.pendingKinpei) { (game as any).cancelKinpei?.(); continue; }
          if (s.awaitingRonDecision) { game.pass(); continue; }
          if (s.awaitingFulou) { game.pass(); continue; }
          game.cpuStep();
        }
      }
    } finally {
      proto.selectBestFromRows_ = orig;
    }
    tenpaiMs.sort((a, b) => a - b);
    const q = (p: number) => tenpaiMs[Math.min(tenpaiMs.length - 1, Math.floor(tenpaiMs.length * p))] ?? 0;
    const mean = tenpaiMs.reduce((a, b) => a + b, 0) / Math.max(1, tenpaiMs.length);
    console.log(`[CPU_VALUE_MEASURE] decisions=${decisions} tenpai=${tenpai} changed=${changed} (${(100 * changed / decisions).toFixed(2)}% of all, ${(100 * changedAmongTenpai / Math.max(1, tenpai)).toFixed(2)}% of tenpai) mean=${mean.toFixed(3)}ms p50=${q(0.5).toFixed(3)}ms p95=${q(0.95).toFixed(3)}ms max=${(tenpaiMs[tenpaiMs.length - 1] ?? 0).toFixed(3)}ms valueCalls=${valueCalls}`);
    expect(decisions).toBeGreaterThan(0);
  }, 600000);
});
