
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

  // [2026-10-14 リョー「勝利演出の時はアンミカーニバルの曲流したいなw」] 終わりにトップの人の勝利で、アン ミカさんの
  // 「アンミカーニバル」を流す。音のファイルは置かず (権利)、講談社 mimollet の公式の短い動画 (43 秒、埋め込み可) を
  // YouTube の埋め込みで画面に出して鳴らす。YouTube の決まりで、プレーヤーは隠さず 200px 以上で見せる。
  // ミュートの設定なら音なしで始める。閉じれば止まる
  import { prefs } from './prefs';
  const CARNIVAL_VIDEO = 'pIfOv74wBCE';
  let carnivalOpen = true;
  $: winner = (finalScore ?? ranking).find((r) => r.rank === 1);
  $: carnivalSrc = `https://www.youtube-nocookie.com/embed/${CARNIVAL_VIDEO}?autoplay=1&playsinline=1&rel=0&modestbranding=1${$prefs.muted ? '&mute=1' : ''}`;
</script>

<section class="game-end-panel">
  <h2>{matchLabel}終了</h2>
  {#if winner && carnivalOpen}
    <div class="carnival">
      <div class="carnival-head">
        <strong class="carnival-win">{names[winner.player] ?? `P${winner.player}`} の勝利！</strong>
        <button class="carnival-close" type="button" on:click={() => (carnivalOpen = false)}>曲を止める</button>
      </div>
      <iframe class="carnival-video" src={carnivalSrc} title="アンミカーニバル" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
    </div>
  {/if}
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
    border: 2px solid #2080d0;
    background: #f0f8ff;
    padding: 10px 14px;
    border-radius: 6px;
    margin: 12px 0;
  }
  h2 { font-size: 14px; margin: 0 0 8px; color: #2080d0; }
  .carnival { display: grid; gap: 6px; margin: 0 0 10px; }
  .carnival-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .carnival-win { font-size: 20px; color: #c08000; }
  .carnival-close { margin-left: auto; border: 1px solid rgba(0,0,0,0.2); background: #fff; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 13px; }
  .carnival-video { width: min(100%, 480px); min-width: 200px; aspect-ratio: 16 / 9; min-height: 200px; border: 0; border-radius: 4px; background: #000; }
  .rule-note { font-size: 12px; color: #555; margin: 8px 0; line-height: 1.5; }
  .ranking { width: 100%; border-collapse: collapse; font-family: var(--sans); font-variant-numeric: tabular-nums; font-size: 18px; }
  .ranking th, .ranking td { padding: 10px 14px; text-align: right; border-bottom: 1px solid rgba(0,0,0,0.1); }
  .ranking th { background: rgba(0,0,0,0.05); font-weight: 700; font-size: 17px; }
  .ranking td.who { text-align: left; }
  .ranking .rank-1 { font-weight: bold; color: #c08000; }
  .ranking .final { color: #208040; font-size: 22px; font-weight: 700; }
  .ranking .final.lose { color: #c03030; }
  .ranking .cumulative { font-size: 18px; color: #555; }
  .ranking .raw-defen { font-size: 18px; font-variant-numeric: tabular-nums; }
  .ranking .ledger, .ranking .uma, .ranking .topn, .ranking .tonton { font-size: 18px; }
</style>
