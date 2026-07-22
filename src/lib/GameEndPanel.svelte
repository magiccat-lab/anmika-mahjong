
<script lang="ts">
  export let ranking: { rank: number; player: number; defen: number }[];
  /** 席表示名 [オンラインはユーザー名] */
  export let names: string[] = ['P0', 'P1', 'P2'];
  export let zifengZ: (p: number) => number;
  /** 半荘 chip 収支 [P0/P1/P2 = 累計 chip ledger]、 final score 表示用 fallback */
  export let chipLedger: number[] | null = null;
  /** game.getFinalScore() の出力 [uma + chip 込みの最終 total + 内訳] */
  export let finalScore: Array<{ player: number; defen: number; rank: number; chipBase?: number; uma: number; topNBonus?: number; tobiBonus?: number; tontonbuBonus?: number; chip: number; total: number }> | null = null;
</script>

<section class="game-end-panel">
  <h2>半荘終了</h2>
  {#if finalScore}
    <div class="rule-note">
      ウマ: 2着 40,000+ → +30 / 0 / -30 [2着クビ]、 未達 → +45 / -15 / -30 [2着クビなし]<br>
      含む chip: アガリ祝儀 / 抜きドラ / 8万点+トップ (2n-10) / トビ賞 +5 [or 倍 +10] / トントンブー +6
    </div>
  {/if}
  <table class="ranking">
    <thead>
      <tr><th>順位</th><th>player</th><th>点数</th><th>チップ収支</th><th>順位チップ</th><th>N万点トップ賞</th><th>トビ賞</th><th>トントンブー</th><th>合計</th></tr>
    </thead>
    <tbody>
      {#each (finalScore ?? ranking.map(r => ({ ...r, chipBase: chipLedger?.[r.player] ?? 0, uma: 0, topNBonus: 0, tobiBonus: 0, tontonbuBonus: 0, chip: chipLedger?.[r.player] ?? 0, total: chipLedger?.[r.player] ?? 0 }))) as r}
        <tr class="rank-{r.rank}">
          <td class="pos">{r.rank}位</td>
          <td class="who">{names[r.player] ?? `P${r.player}`} [{['東','南','西'][zifengZ(r.player) - 1]}家]</td>
          <td class="raw-defen">{r.defen.toLocaleString()}</td>
          <td class="ledger">{(r.chipBase ?? 0) > 0 ? '+' : ''}{r.chipBase ?? 0}</td>
          <td class="uma">{r.uma > 0 ? '+' : ''}{r.uma}</td>
          <td class="topn">{(r.topNBonus ?? 0) > 0 ? '+' : ''}{r.topNBonus ?? 0}</td>
          <td class="tobi">{(r.tobiBonus ?? 0) > 0 ? '+' : ''}{r.tobiBonus ?? 0}</td>
          <td class="tonton">{(r.tontonbuBonus ?? 0) > 0 ? '+' : ''}{r.tontonbuBonus ?? 0}</td>
          <td class="final"><strong>{r.total > 0 ? '+' : ''}{r.total}</strong></td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  section.game-end-panel {
    border: 2px solid #2080d0;
    background: #f0f8ff;
    padding: 10px 14px;
    border-radius: 6px;
    margin: 12px 0;
  }
  h2 { font-size: 14px; margin: 0 0 8px; color: #2080d0; }
  .rule-note { font-size: 12px; color: #555; margin: 8px 0; line-height: 1.5; }
  .ranking { width: 100%; border-collapse: collapse; font-family: 'Menlo', Consolas, monospace; font-size: 18px; }
  .ranking th, .ranking td { padding: 10px 14px; text-align: right; border-bottom: 1px solid rgba(0,0,0,0.1); }
  .ranking th { background: rgba(0,0,0,0.05); font-weight: 700; font-size: 17px; }
  .ranking td.who { text-align: left; }
  .ranking .rank-1 { font-weight: bold; color: #c08000; }
  .ranking .final { color: #208040; font-size: 22px; font-weight: 700; }
  .ranking .raw-defen { font-size: 18px; font-variant-numeric: tabular-nums; }
  .ranking .ledger, .ranking .uma, .ranking .topn, .ranking .tonton { font-size: 18px; }
</style>
