
<script lang="ts">
  export let ranking: { rank: number; player: number; defen: number }[];
  /** 席表示名 [オンラインはユーザー名] */
  export let names: string[] = ['P0', 'P1', 'P2'];
  export let zifengZ: (p: number) => number;
  /** 半荘 chip 収支 [P0/P1/P2 = 累計 chip ledger]、 final score 表示用 fallback */
  export let chipLedger: number[] | null = null;
  /** game.getFinalScore() の出力 [uma + chip 込みの最終 total + 内訳] */
  export let finalScore: Array<{ player: number; defen: number; rank: number; chipBase?: number; uma: number; topNBonus?: number; tobiBonus?: number; tontonbuBonus?: number; chip: number; total: number }> | null = null;
  /** [2026-10-13 リョー「東風終わりにその東風での勝ち負けを出してほしい」] 試合開始時の chip [前の試合からの持越し]。
   *  合計 [total] は持越し込みの通算なので、この試合だけの勝ち負け = total - matchStart[player] */
  export let matchStart: number[] | null = null;
  /** 東風 / 半荘 / 一局 [Game3.changshu から] */
  export let matchLabel = '半荘';
  const signed = (v: number) => `${v > 0 ? '+' : ''}${v}`;
  $: carried = !!matchStart && matchStart.some((v) => v !== 0);
</script>

<section class="game-end-panel">
  <h2>{matchLabel}終了</h2>
  {#if finalScore}
    <div class="rule-note">
      ウマ: 2着 40,000+ → +50 / 0 / -50 [2着クビ]、 未達 → +75 / -25 / -50 [2着クビなし]<br>
      含む chip: アガリ祝儀 / 抜きドラ / 8万点+トップ (2n-10) / トビ賞 +5 [or 倍 +10] / トントンブー +6
    </div>
  {/if}
  <table class="ranking">
    <thead>
      <tr><th>順位</th><th>player</th><th>点数</th><th>チップ収支</th><th>順位チップ</th><th>N万点トップ賞</th><th>トビ賞</th><th>トントンブー</th><th>この{matchLabel}</th>{#if carried}<th>通算</th>{/if}</tr>
    </thead>
    <tbody>
      {#each (finalScore ?? ranking.map(r => ({ ...r, chipBase: chipLedger?.[r.player] ?? 0, uma: 0, topNBonus: 0, tobiBonus: 0, tontonbuBonus: 0, chip: chipLedger?.[r.player] ?? 0, total: chipLedger?.[r.player] ?? 0 }))) as r}
        {@const carry = matchStart?.[r.player] ?? 0}
        {@const thisMatch = r.total - carry}
        <tr class="rank-{r.rank}">
          <td class="pos">{r.rank}位</td>
          <td class="who">{names[r.player] ?? `P${r.player}`} [{['東','南','西'][zifengZ(r.player) - 1]}家]</td>
          <td class="raw-defen">{r.defen.toLocaleString()}</td>
          <td class="ledger">{signed((r.chipBase ?? 0) - carry)}</td>
          <td class="uma">{r.uma > 0 ? '+' : ''}{r.uma}</td>
          <td class="topn">{(r.topNBonus ?? 0) > 0 ? '+' : ''}{r.topNBonus ?? 0}</td>
          <td class="tobi">{(r.tobiBonus ?? 0) > 0 ? '+' : ''}{r.tobiBonus ?? 0}</td>
          <td class="tonton">{(r.tontonbuBonus ?? 0) > 0 ? '+' : ''}{r.tontonbuBonus ?? 0}</td>
          <td class="final this-match" class:win={thisMatch > 0} class:lose={thisMatch < 0}><strong>{signed(thisMatch)}</strong></td>
          {#if carried}<td class="cumulative">{signed(r.total)}</td>{/if}
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  section.game-end-panel {
    border: 1px solid var(--cy-line);
    background: var(--cy-panel-solid);
    padding: 10px 14px;
    border-radius: 0;
    margin: 12px 0;
    color: var(--cy-ink);
  }
  h2 { font-size: 14px; margin: 0 0 8px; color: var(--cy-line); font-family: var(--cy-font-label); letter-spacing: 0.12em; white-space: nowrap; }
  .rule-note { font-size: 12px; color: var(--cy-sub-ink); margin: 8px 0; line-height: 1.5; }
  .ranking { width: 100%; border-collapse: collapse; font-family: var(--sans); font-variant-numeric: tabular-nums; font-size: clamp(13px, 3.6vw, 18px); }
  .ranking th, .ranking td { padding: 10px clamp(6px, 2vw, 14px); text-align: right; border-bottom: 1px solid var(--cy-faint); white-space: nowrap; }
  .ranking th { background: var(--cy-faint); font-weight: 700; font-size: clamp(12px, 3.4vw, 17px); color: var(--cy-sub-ink); }
  .ranking td.who { text-align: left; }
  .ranking .rank-1 { font-weight: bold; color: var(--cy-pt); }
  .ranking .final { color: var(--cy-pt); font-size: clamp(15px, 4.4vw, 22px); font-weight: 700; }
  .ranking .final.lose { color: var(--cy-hot); }
  .ranking .cumulative { font-size: clamp(13px, 3.6vw, 18px); color: var(--cy-sub-ink); }
  .ranking .raw-defen { font-size: clamp(13px, 3.6vw, 18px); font-variant-numeric: tabular-nums; }
  .ranking .ledger, .ranking .uma, .ranking .topn, .ranking .tonton { font-size: clamp(13px, 3.6vw, 18px); }
</style>
