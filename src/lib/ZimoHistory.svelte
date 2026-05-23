
<script lang="ts">
  // ツモ順 panel
  export let history: string[];
</script>

<h2>🎲 ツモ順 [全 {history.length} 回]</h2>
<div class="zimo-history">
  {#each history as line}
    <div class="line">{line}</div>
  {/each}
</div>

<style>
  h2 { font-size: 13px; margin: 6px 0 4px; }
  .zimo-history {
    max-height: 200px;
    overflow: auto;
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 11px;
    background: #f0f0f0;
    padding: 6px 8px;
    border-radius: 4px;
  }
  .line { line-height: 1.5; }
</style>
