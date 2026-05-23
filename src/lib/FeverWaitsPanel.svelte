
<script lang="ts">
  import Tile from './Tile.svelte';
  export let feverWaits: Array<{
    player: number;
    waits: Array<{ tile: string; remain: number; hasRed?: boolean; hasGold?: boolean }>;
  }>;
</script>

{#if feverWaits.length > 0}
  <section class="fever-info">
    <h2>🔥 フィーバー立直 待ち情報</h2>
    {#each feverWaits as fw}
      <div class="fever-row">
        <strong>p{fw.player}:</strong>
        {#each fw.waits as w}
          <span class="wait-chip">
            <Tile pai={w.tile} /> 残{w.remain}
            {#if w.hasRed}<span class="red-mark">赤</span>{/if}
            {#if w.hasGold}<span class="gold-mark">金</span>{/if}
          </span>
        {/each}
      </div>
    {/each}
  </section>
{/if}

<style>
  section.fever-info {
    border: 2px solid #d040a0;
    background: #fff0fa;
    padding: 8px 12px;
    border-radius: 6px;
    margin: 10px 0;
  }
  h2 { font-size: 13px; margin: 0 0 6px; color: #a02080; }
  .fever-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; }
  .wait-chip { display: inline-flex; align-items: center; gap: 2px; background: #fff; border: 1px solid #d0a0c0; padding: 2px 6px; border-radius: 12px; }
  .red-mark { color: #c04040; font-weight: bold; font-size: 10px; }
  .gold-mark { color: #b08020; font-weight: bold; font-size: 10px; }
</style>
