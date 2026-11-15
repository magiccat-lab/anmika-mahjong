
<script lang="ts">
  import Tile from './Tile.svelte';
  export let feverWaits: Array<{
    player: number;
    waits: Array<{ tile: string; remain: number | null; hasRed?: boolean; hasGold?: boolean; hasNiji?: boolean }>;
  }>;
  export let openWaits: Array<{ player: number; waits: Array<{ tile: string; remain: number | null }> }> = [];
  export let seatNames: Record<number, string> = {};
</script>

{#if openWaits.length > 0}
  <section class="fever-info open-info">
    <h2>オープン 待ち</h2>
    {#each openWaits as ow}
      <div class="fever-row">
        <strong>{seatNames[ow.player] ?? `p${ow.player}`}:</strong>
        {#each ow.waits as w}
          <span class="wait-chip"><Tile pai={w.tile} /> 残{w.remain ?? '-'}</span>
        {/each}
      </div>
    {/each}
  </section>
{/if}

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
            {#if w.hasNiji}<span class="niji-mark">虹</span>{/if}
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
  section.open-info { border-color: #2a8a6a; background: #effaf5; }
  section.open-info h2 { color: #1f6e54; }
  h2 { font-size: 13px; margin: 0 0 6px; color: #a02080; }
  .fever-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; }
  .wait-chip { display: inline-flex; align-items: center; gap: 2px; background: #fff; border: 1px solid #d0a0c0; padding: 2px 6px; border-radius: 12px; }
  .red-mark { color: #c04040; font-weight: bold; font-size: 10px; }
  .gold-mark { color: #b08020; font-weight: bold; font-size: 10px; }
  .niji-mark { background: linear-gradient(90deg, #ff3333, #ffaa00, #33cc33, #3399ff, #cc33ff); background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: bold; font-size: 10px; }
</style>
