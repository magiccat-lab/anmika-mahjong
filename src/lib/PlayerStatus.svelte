
<script lang="ts">
  // player 1 行の状態表示 [固定順序: ID/風/点数/向聴/ドラ/リーチ/北/チップ]
  export let player: number;
  export let isCurrent: boolean;
  export let zifengZ: number;
  export let defen: number;
  export let xiangting: number;
  export let dora: number;
  export let lizhi: boolean;
  export let openLizhi: boolean;
  export let tingpai: string[];
  export let nukidora: number;
  export let nukidoraGold: number = 0;
  export let chip: number;
  // unused export 警告対策 [リョー指示: 残しておくが UI には表示しない]
  void nukidoraGold;
  $: zifeng = ['東', '南', '西'][zifengZ - 1];
</script>

<span class="player-status" class:current={isCurrent}>
  <span class="seg id">p{player}</span>
  <span class="seg feng">{zifeng}</span>
  <span class="seg score">{defen.toLocaleString()}</span>
  <span class="seg xt">向{xiangting}</span>
  {#if dora}<span class="seg dora">🀅{dora}</span>{/if}
  {#if lizhi}
    {#if openLizhi}
      <span class="seg lizhi open">🟠オ[{tingpai.join(',')}]</span>
    {:else}
      <span class="seg lizhi">🔴リ</span>
    {/if}
  {/if}
  {#if nukidora}<span class="seg nuki">北×{nukidora}</span>{/if}
  <span class="seg chip">💴{chip}</span>
</span>

<style>
  .player-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.6;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .player-status.current {
    background: #fff8c0;
    font-weight: bold;
  }
  .seg {
    white-space: nowrap;
  }
  .seg.id { color: #888; min-width: 22px; }
  .seg.feng { color: #c04040; min-width: 14px; text-align: center; }
  .seg.score { color: #222; min-width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
  .seg.xt { color: #555; }
  .seg.dora { color: #b07000; }
  .seg.lizhi { color: #c04040; }
  .seg.lizhi.open { color: #d68000; }
  .seg.nuki { color: #406090; }
  .seg.chip { color: #806000; font-weight: bold; }
</style>
