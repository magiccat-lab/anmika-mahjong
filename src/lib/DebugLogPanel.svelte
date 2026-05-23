
<script lang="ts">
  // Debug Log panel
  export let logs: string[];
  export let onClear: () => void = () => {};
</script>

<h2>🪲 Debug Log [全履歴]</h2>
<button on:click={onClear}>Clear</button>
<button on:click={() => { navigator.clipboard?.writeText(logs.join('\n')); }}>📋 Copy</button>
<pre class="debug-pre">{logs.join('\n')}</pre>

<style>
  .debug-pre {
    max-height: 300px;
    overflow: auto;
    font-size: 10px;
    background: #1a1a1a;
    color: #5fff5f;
    padding: 8px;
    border-radius: 4px;
  }
</style>
