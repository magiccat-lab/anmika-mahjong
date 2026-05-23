
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
</script>

<section class="hule-panel">
  <div class="top-line">
    <h2>局結果</h2>
    <span class="winner">player {lastWinner} 和了</span>
    <span class="score">{huleResult.fu ?? 0}符 {huleResult.fanshu ?? 0}翻</span>
    <span class="defen">{(huleResult.defen3 ?? huleResult.defen ?? 0).toLocaleString()}点</span>
  </div>

  <div class="section-divider"><span class="section-title">打点計算</span></div>
  <div class="section-body">
    {#if defenDelta}
      <div class="payment-row">
        <span class="payment-label">点数移動:</span>
        {#each defenDelta as v, p}
          <span class="payment-cell {v > 0 ? 'gain' : (v < 0 ? 'loss' : 'zero')}">
            P{p}: {v > 0 ? '+' : ''}{v.toLocaleString()}{#if defenAfter} → {defenAfter[p].toLocaleString()}{/if}
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
      {#each baopai.filter((b) => typeof b === 'string' && !b.startsWith('f')) as b}<Tile pai={b} size="sm" />{/each}
      {#if winnerLizhi && fubaopai}
        <span class="dora-label">裏ドラ表:</span>
        {#each fubaopai.filter((b) => typeof b === 'string' && !b.startsWith('f')) as b}<Tile pai={b} size="sm" />{/each}
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
  h2 { font-size: 14px; margin: 0 0 6px; color: #c04040; }
  .winner { font-weight: bold; color: #c04040; }
  .score { color: #555; font-size: 12px; }
  .defen { font-weight: bold; color: #806000; }
  .yaku-list { margin: 6px 0; display: flex; flex-wrap: wrap; gap: 4px; }
  .yaku-chip {
    background: #fff;
    border: 1px solid #c8a020;
    padding: 2px 6px;
    border-radius: 12px;
    font-size: 11px;
    color: #806000;
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
  .payment-row { display: flex; gap: 10px; align-items: center; margin-top: 8px; flex-wrap: wrap; font-size: 14px; }
  .payment-label { color: #888; font-size: 12px; font-weight: bold; }
  .payment-cell { padding: 3px 10px; border-radius: 4px; background: rgba(0, 0, 0, 0.08); font-weight: 700; }
  .payment-cell.gain { color: #2c8040; background: rgba(80, 180, 100, 0.18); }
  .payment-cell.loss { color: #c04040; background: rgba(220, 80, 80, 0.18); }
  .payment-cell.zero { color: #888; }
  .top-line { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  .top-line h2 { margin: 0; }
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
