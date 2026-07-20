// CPU 品質の計測台 [2026-07-20 リョー指示: 「全部改善しよう」の土台]
//
// 既存の fuzz [v32_full_games_fuzz] はクラッシュ検出用で、強さは測っていない。
// 打ち筋を変えた時に良くなったか判定できないと改善が積めないので、
// CPU 3 人で試合を回して和了率 / 放銃率 / 流局率 / 平均順位を出す。
//
// 通常のテスト実行では回さない [時間がかかるため]。測る時だけ:
//   CPU_BENCH=1 npx vitest run src/lib/__tests__/cpu_bench.test.ts
//   CPU_BENCH=1 CPU_BENCH_GAMES=50 npx vitest run src/lib/__tests__/cpu_bench.test.ts
import { describe, it, expect } from 'vitest';
import { game } from '../store';
import { get } from 'svelte/store';

const RUN = !!process.env.CPU_BENCH;
const N_GAMES = Number(process.env.CPU_BENCH_GAMES ?? 30);
const PER_GAME_MAX_ROUNDS = 30;
const PER_GAME_MAX_STEPS = 5000;

interface SeatStats {
  hule: number;
  tsumo: number;
  ron: number;
  dealIn: number;
  rankSum: number;
  defenSum: number;
}

const emptySeat = (): SeatStats => ({
  hule: 0, tsumo: 0, ron: 0, dealIn: 0, rankSum: 0, defenSum: 0,
});

/** 1 試合を CPU だけで回しきる */
function driveOneGame(): void {
  game.reset();
  game.setCpuSeats([0, 1, 2]);
  let steps = 0;
  let rounds = 0;
  while (steps < PER_GAME_MAX_STEPS && rounds < PER_GAME_MAX_ROUNDS) {
    steps++;
    const s: any = get(game);
    if (s.game.state.finished) break;
    if ((s.game.state.changbang ?? 0) >= 1) break;
    if (s.roundEnded || s.pendingPingju) {
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

/** 試合終了後の events から局単位の結果を集計する [events は試合中クリアされない] */
function collectGame(stats: Record<number, SeatStats>): { rounds: number; pingju: number } {
  const s: any = get(game);
  let rounds = 0;
  let pingju = 0;
  for (const ev of (s.game.events ?? []) as any[]) {
    if (ev?.type === 'hule') {
      rounds++;
      const w = ev.player as number;
      if (stats[w]) {
        stats[w].hule++;
        if (ev.isRon) stats[w].ron++;
        else stats[w].tsumo++;
      }
      if (ev.isRon && ev.delta) {
        // ロンは放銃者だけが失点する。負の delta が 1 人ならそれが放銃者
        const losers = [0, 1, 2].filter((p) => Number(ev.delta[p] ?? 0) < 0);
        if (losers.length === 1 && stats[losers[0]]) stats[losers[0]].dealIn++;
      }
    } else if (ev?.type === 'pingju') {
      rounds++;
      pingju++;
    }
  }
  // 最終素点と順位
  const defen = s.game.state.defen ?? {};
  const order = [0, 1, 2].slice().sort((a, b) => Number(defen[b] ?? 0) - Number(defen[a] ?? 0));
  order.forEach((seat, idx) => {
    if (!stats[seat]) return;
    stats[seat].rankSum += idx + 1;
    stats[seat].defenSum += Number(defen[seat] ?? 0);
  });
  return { rounds, pingju };
}

describe.skipIf(!RUN)('CPU bench [CPU_BENCH=1 の時だけ実行]', () => {
  it(`${N_GAMES} 試合の和了率 / 放銃率 / 平均順位`, () => {
    const stats: Record<number, SeatStats> = { 0: emptySeat(), 1: emptySeat(), 2: emptySeat() };
    let totalRounds = 0;
    let totalPingju = 0;
    const startMs = Date.now();

    for (let gi = 0; gi < N_GAMES; gi++) {
      driveOneGame();
      const r = collectGame(stats);
      totalRounds += r.rounds;
      totalPingju += r.pingju;
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    const pct = (n: number) => totalRounds > 0 ? ((n / totalRounds) * 100).toFixed(1) : '0.0';
    const lines: string[] = [];
    lines.push(`[cpu-bench] games=${N_GAMES} rounds=${totalRounds} elapsed=${elapsed}s`);
    lines.push(`[cpu-bench] 流局率=${pct(totalPingju)}%`);
    let hules = 0;
    let dealIns = 0;
    for (const seat of [0, 1, 2]) {
      const st = stats[seat];
      hules += st.hule;
      dealIns += st.dealIn;
      lines.push(
        `[cpu-bench] p${seat} 和了=${pct(st.hule)}% [ツモ ${st.tsumo} / ロン ${st.ron}] `
        + `放銃=${pct(st.dealIn)}% 平均順位=${(st.rankSum / N_GAMES).toFixed(2)} `
        + `平均素点=${Math.round(st.defenSum / N_GAMES)}`,
      );
    }
    lines.push(`[cpu-bench] 全体 和了=${pct(hules)}% 放銃=${pct(dealIns)}%`);
    // vitest の console intercept を避けて直接書く
    process.stdout.write(lines.join('\n') + '\n');

    // 台自体の健全性だけ担保する [強さの良し悪しは数値を見て人が判断する]
    expect(totalRounds).toBeGreaterThan(0);
    expect(hules + totalPingju).toBe(totalRounds);
  }, 900_000);
});
