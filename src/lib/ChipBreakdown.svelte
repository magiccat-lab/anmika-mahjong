
<script lang="ts">
  // 局結果の祝儀計算式 panel
  export let breakdown: Array<{ label: string; base: number; multiplier: number; total: number; mode: 'oall' | 'ron'; multiplierParts?: string[] }>;
  export let total: number;
  $: void total; // 内部未使用 [将来 total 表示用に予約、 svelte warn 抑止]
</script>

<div class="chip-breakdown">
  {#each breakdown as b}
    <div class="row">
      <span class="label">{b.label}</span>:
      <span class="base">base {b.base}</span>
      × 倍率 <span class="mul" title={b.multiplierParts?.length ? b.multiplierParts.join(' × ') : '倍率 1 [素点]'}>{b.multiplier}</span>
      {#if b.multiplierParts && b.multiplierParts.length > 0}
        <span class="parts">[{b.multiplierParts.join(' × ')}]</span>
      {/if}
      = <strong class="total">{b.total}</strong>
      <span class="mode">[{b.mode === 'oall' ? 'オール' : 'ロン放銃'}]</span>
    </div>
  {/each}
</div>

<style>
  .chip-breakdown {
    background: #fef9e7;
    padding: 6px 8px;
    margin-top: 6px;
    border: 1px solid #c8a020;
    border-radius: 4px;
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 11px;
  }
  .row { line-height: 1.6; }
  .label { color: #806020; }
  .base { color: #404040; }
  .mul { color: #a04020; cursor: help; border-bottom: 1px dotted #a04020; }
  .parts { color: #608030; font-size: 10px; margin-left: 2px; }
  .total { color: #208040; font-variant-numeric: tabular-nums; }
  .mode { color: #888; }
</style>
