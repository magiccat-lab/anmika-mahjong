
<script lang="ts">
  // 局結果の祝儀計算式 panel
  export let breakdown: Array<{ label: string; base: number; multiplier: number; total: number; mode: 'oall' | 'ron'; multiplierParts?: string[] }>;
  export let total: number;
  $: void total; // 内部未使用 [将来 total 表示用に予約、 svelte warn 抑止]
</script>

<div class="chip-breakdown">
  {#each breakdown as b}
    <div class="row">
      <span class="u label">{b.label}:</span>
      <span class="u base">base {b.base}</span>
      <span class="u">× 倍率 <span class="mul" title={b.multiplierParts?.length ? b.multiplierParts.join(' × ') : '倍率 1 [素点]'}>{b.multiplier}</span></span>
      {#if b.multiplierParts && b.multiplierParts.length > 0}
        <span class="u parts">[{b.multiplierParts.join(' × ')}]</span>
      {/if}
      <span class="u">= <strong class="total">{b.total}</strong></span>
      <span class="u mode">[{b.mode === 'oall' ? 'オール' : 'ロン放銃'}]</span>
    </div>
  {/each}
</div>

<style>
  /* [2026-10-29 サイバー B / P4] 暗い板に合わせた色。1 行は意味のかたまり [u] ごとに折り、
     「[ロン放\n銃]」のように字の途中では折らない。広ければ 2 列 */
  .chip-breakdown {
    color: var(--cy-ink);
    font-family: var(--cy-font-label);
    font-size: clamp(13px, 3.6vw, 17px);
    line-height: 1.7;
    column-width: 440px;
    column-gap: 32px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.4em;
    padding: 2px 0;
    break-inside: avoid;
  }
  .u { white-space: nowrap; }
  .label { color: var(--cy-line); font-weight: 700; }
  .base { color: var(--cy-ink); }
  .mul { color: var(--cy-ink); cursor: help; border-bottom: 1px dotted var(--cy-dim); }
  .parts { color: var(--cy-sub-ink); }
  .total { color: var(--cy-pt); font-family: var(--cy-font-num); font-variant-numeric: normal; }
  .mode { color: var(--cy-sub-ink); }
</style>
