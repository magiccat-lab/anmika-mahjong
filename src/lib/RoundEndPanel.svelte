
<script lang="ts">
  import Tile from './Tile.svelte';
  import type { FulouMianzi } from './fulouDisplay';
  export let lastWinner: number | null;
  export let huleResult: any;
  export let baopai: string[];
  export let fubaopai: string[] | null = null;
  export let winnerLizhi: boolean = false;
  /** 点数移動 [P0, P1, P2] = after_defen - before_defen */
  export let defenDelta: [number, number, number] | null = null;
  /** 移動後の各家 defen */
  export let defenAfter: [number, number, number] | null = null;
  /** 上がった人の手牌 [副露 mianzi 含む、 ロン牌 末尾] */
  export let winnerShoupai: string[] = [];
  export let winnerFulou: FulouMianzi[] = [];
  export let winnerHuapai: string[] = [];
  export let winnerNuki: number = 0;
  export let winnerNukiGold: number = 0;
  /** 金北強化未確定の間 冬めくり結果を隠す [リョー指示 2026-05-12: 結果見て強化選ばせない] */
  export let hideFuyuResult: boolean = false;
  /** アガリ牌 [ロン牌 / ツモ牌]、 null なら非表示 */
  export let agariPai: string | null = null;
  /** 'ron' | 'tsumo'、 null なら非表示 */
  export let agariType: 'ron' | 'tsumo' | null = null;
  /** ロン時の振込者 [tsumo の時は無視] */
  export let agariFrom: number | null = null;

  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';

  // 打点のカウントアップ [パネル登場後に回す]
  const defenTween = tweened(0, { duration: 900, easing: cubicOut });
  $: finalDefen = huleResult.defen3 ?? huleResult.defen ?? 0;
  $: defenTween.set(finalDefen);

  // 満貫級ラベル [総翻数ベース]
  function tierLabel(fanshu: number): string | null {
    if (fanshu >= 13) return '役満';
    if (fanshu >= 11) return '三倍満';
    if (fanshu >= 8) return '倍満';
    if (fanshu >= 6) return '跳満';
    if (fanshu >= 5) return '満貫';
    return null;
  }
  $: tier = tierLabel(Number(huleResult.fanshu) || 0);
</script>

<section class="hule-panel">
  <div class="top-line">
    {#if agariType}
      <span class="agari-kind {agariType === 'ron' ? 'kind-ron' : 'kind-tsumo'}">
        {agariType === 'ron' ? 'ロン' : 'ツモ'}
      </span>
    {/if}
    <span class="winner">player {lastWinner} 和了</span>
    <span class="score">{huleResult.fu ?? 0}符 {huleResult.fanshu ?? 0}翻</span>
    {#if tier}<span class="tier-chip tier-{tier === '役満' ? 'yakuman' : 'big'}">{tier}</span>{/if}
    <span class="defen">{Math.round($defenTween).toLocaleString()}<span class="defen-unit">点</span></span>
  </div>

  <div class="section-divider"><span class="section-title">打点計算</span></div>
  <div class="section-body">
    {#if defenDelta}
      <div class="payment-row">
        <span class="payment-label">点数移動:</span>
        {#each defenDelta as v, p}
          <span class="payment-cell {v > 0 ? 'gain' : (v < 0 ? 'loss' : 'zero')}">
            <span class="payment-player">P{p}</span>
            <span class="payment-delta">{v > 0 ? '+' : (v === 0 ? '±' : '')}{v.toLocaleString()}</span>
            {#if defenAfter}<span class="payment-after">→ {defenAfter[p].toLocaleString()}</span>{/if}
          </span>
        {/each}
      </div>
    {/if}
    {#if huleResult.hupai}
      <div class="yaku-list">
        {#each huleResult.hupai as h}
          <span class="yaku-chip">{h.name} {h.fanshu ? `${h.fanshu === '*' ? '13' : (h.fanshu === '**' ? '26' : h.fanshu)}翻` : ''}</span>
        {/each}
      </div>
    {/if}
    <div class="dora-row">
      <span class="dora-label">表ドラ表:</span>
      {#each baopai.filter((b) => typeof b === 'string') as b}<Tile pai={b} size="sm" />{/each}
      {#if winnerLizhi && fubaopai}
        <span class="dora-label">裏ドラ表:</span>
        {#each fubaopai.filter((b) => typeof b === 'string') as b}<Tile pai={b} size="sm" />{/each}
      {/if}
    </div>
    {#if agariPai && agariType}
      <div class="agari-row">
        <span class="agari-label">
          {#if agariType === 'ron'}
            ロン牌
            {#if agariFrom !== null}<span class="agari-from">[P{agariFrom} 振込]</span>{/if}
          {:else}
            ツモ牌
            {#if lastWinner !== null}<span class="agari-from">[P{lastWinner} 自摸]</span>{/if}
          {/if}
          :
        </span>
        <span class="agari-tile-wrap"><Tile pai={agariPai} size="lg" /></span>
      </div>
    {/if}
    {#if winnerShoupai.length > 0}
      <div class="winner-hand">
        <span class="winner-hand-label">手牌:</span>
        {#each winnerShoupai as t}<Tile pai={t} size="sm" />{/each}
        {#each winnerFulou as m}
          <span class="fulou-mianzi">
            {#each m.tiles as t, i}
              {#if i === m.rotateIdx}
                <span class="rot-tile"><Tile pai={t} size="sm" /></span>
                {#if m.kakanTile}<span class="rot-tile kakan-stack"><Tile pai={m.kakanTile} size="sm" /></span>{/if}
              {:else}
                <Tile pai={t} size="sm" />
              {/if}
            {/each}
          </span>
        {/each}
        {#if winnerHuapai.length > 0 || winnerNuki > 0 || winnerNukiGold > 0}
          <span class="winner-hua">
            {#each winnerHuapai as t}<Tile pai={t} size="sm" />{/each}
            {#each Array(winnerNuki) as _, i}<Tile pai="z4" size="sm" />{/each}
            {#each Array(winnerNukiGold) as _, i}<Tile pai="gN" size="sm" />{/each}
          </span>
        {/if}
      </div>
    {/if}
  </div>

  <div class="section-divider"><span class="section-title">祝儀計算</span></div>
  <div class="section-body">
    {#if huleResult.shuvariUsedThisRound}
      <div class="shuvari-used">⚡ シュバ棒使用 [祝儀 ×2 適用]</div>
    {/if}
    {#if huleResult.fuyuLog?.length}
      <div class="fuyu-row">
        <span class="fuyu-label">冬めくり:</span>
        {#if hideFuyuResult}
          <span class="fuyu-hidden">[金北強化決定後に表示]</span>
        {:else}
          {#each huleResult.fuyuLog as fl}
            <span class="fuyu-tile {fl.hit > 0 ? 'fuyu-hit' : 'fuyu-miss'}">
              <Tile pai={fl.pai} size="sm" />
              <span class="fuyu-mark {fl.hit > 0 ? 'hit' : 'miss'}">{fl.hit > 0 ? `+${fl.hit}` : '×'}</span>
            </span>
          {/each}
          <span class="fuyu-sum">合計 {huleResult.fuyuLog.reduce((a: number, f: any) => a + f.hit, 0)} 枚</span>
        {/if}
      </div>
    {/if}
    <slot name="chip" />
  </div>
</section>

<style>
  section.hule-panel {
    border: 2px solid #f0a000;
    background: #fffaf0;
    padding: 10px 14px;
    border-radius: 6px;
    margin: 12px 0;
  }
  .top-line {
    padding: 6px 10px 10px;
    border-bottom: 3px double #d4af37;
    margin-bottom: 4px;
  }
  .agari-kind {
    display: inline-flex;
    align-items: center;
    padding: 4px 14px;
    border-radius: 6px;
    color: #fff;
    font-size: 18px;
    font-weight: 900;
    letter-spacing: 4px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    animation: kindStamp 0.4s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  /* 2026-07-21 リョー指摘: ロン/ツモを赤青で塗り分けるのはきもい → 金縁の共通バッジ */
  .kind-ron,
  .kind-tsumo {
    background: linear-gradient(135deg, #243c2e, #16281e);
    border: 1px solid #d4af37;
    color: #f0e6c8;
  }
  .winner { font-weight: 800; color: #7c1620; font-size: 20px; }
  .score { color: #555; font-size: 15px; font-weight: 600; }
  .tier-chip {
    padding: 3px 12px;
    border-radius: 14px;
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 2px;
    color: #fff;
    animation: kindStamp 0.45s 0.25s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  .tier-big { background: linear-gradient(135deg, #b06010, #e09020); box-shadow: 0 0 10px rgba(224, 144, 32, 0.5); }
  .tier-yakuman {
    background: linear-gradient(120deg, #8c1020, #d02840 40%, #f0a000 100%);
    box-shadow: 0 0 14px rgba(208, 40, 64, 0.6);
  }
  .defen {
    margin-left: auto;
    font-weight: 900;
    font-size: 30px;
    color: #8a6400;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 0 #fff;
  }
  .defen-unit { font-size: 15px; font-weight: 700; margin-left: 2px; }
  @keyframes kindStamp {
    0% { transform: scale(1.9); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }
  .yaku-list { margin: 8px 0 2px; display: flex; flex-wrap: wrap; gap: 6px; }
  .yaku-chip {
    background: linear-gradient(180deg, #fffdf6, #f7edd2);
    border: 1px solid #c8a020;
    padding: 4px 12px;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 700;
    color: #6c5200;
    box-shadow: 0 1px 2px rgba(120, 90, 0, 0.15);
  }
  .dora-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .dora-label { font-size: 11px; color: #888; margin-right: 2px; }
  .fuyu-row { display: flex; align-items: center; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
  .fuyu-hidden { font-size: 13px; color: #888; font-style: italic; }
  .fuyu-label { font-size: 11px; color: #4060c0; font-weight: bold; }
  .fuyu-tile { display: inline-flex; align-items: center; gap: 2px; padding: 2px 4px; border-radius: 4px; }
  .fuyu-tile.fuyu-hit { background: #e0f0e0; border: 1px solid #80c080; }
  .fuyu-tile.fuyu-miss { background: #f0e0e0; border: 1px solid #c08080; }
  .fuyu-mark { font-size: 18px; font-weight: bold; }
  .fuyu-mark.miss { font-size: 22px; }
  .fuyu-sum { font-size: 11px; color: #4060c0; font-weight: bold; margin-left: 8px; }
  .payment-row { display: flex; gap: 10px; align-items: center; margin-top: 8px; flex-wrap: wrap; font-size: 15px; }
  .payment-label { color: #888; font-size: 12px; font-weight: bold; }
  .payment-cell {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.1);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .payment-cell .payment-player { font-size: 12px; color: #666; font-weight: 800; }
  .payment-cell .payment-delta { font-size: 17px; }
  .payment-cell .payment-after { font-size: 13px; color: #555; font-weight: 600; }
  .payment-cell.gain { color: #1e7a38; background: rgba(80, 180, 100, 0.16); border-color: rgba(60, 150, 80, 0.4); }
  .payment-cell.loss { color: #b23030; background: rgba(220, 80, 80, 0.14); border-color: rgba(190, 70, 70, 0.4); }
  .payment-cell.zero { color: #888; }
  .top-line { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .winner-hand { display: flex; gap: 3px; align-items: center; margin-top: 12px; flex-wrap: wrap; padding: 6px; background: rgba(0,0,0,0.04); border-radius: 4px; }
  .winner-hand-label { font-size: 14px; color: #333; font-weight: 700; margin-right: 8px; }
  .fulou-mianzi { display: inline-flex; gap: 1px; padding: 0 4px; border-left: 1px dashed #aaa; align-items: flex-end; }
  .fulou-mianzi .rot-tile { display: inline-block; transform: rotate(90deg); transform-origin: center; margin: 0 4px; }
  .fulou-mianzi .rot-tile.kakan-stack { margin-top: -14px; }
  .winner-hua { display: inline-flex; gap: 1px; padding: 0 4px; border-left: 1px solid #c8a020; }
  .section-divider {
    border-top: 2px solid #c0a040;
    margin: 24px 0 8px;
    position: relative;
    height: 0;
  }
  .section-title {
    position: absolute;
    left: 0;
    top: -14px;
    background: rgb(245, 240, 220);
    padding: 2px 14px;
    font-size: 18px;
    font-weight: 700;
    color: #1a1820;
    border-radius: 4px;
    letter-spacing: 1px;
  }
  .section-body { padding-top: 6px; padding-bottom: 20px; }
  .shuvari-used { font-size: 16px; font-weight: 700; color: #c04040; margin: 4px 0; }
  .agari-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding: 8px 12px;
    background: rgba(240, 160, 0, 0.12);
    border: 1px solid #f0a000;
    border-radius: 6px;
  }
  .agari-label { font-size: 16px; font-weight: 700; color: #804000; }
  .agari-from { font-size: 12px; color: #806000; margin-left: 4px; font-weight: 500; }
  .agari-tile-wrap { display: inline-flex; padding: 2px 4px; background: #fff; border-radius: 4px; }
</style>
