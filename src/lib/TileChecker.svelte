
<script lang="ts">
  // 全 116 牌チェック panel [debug]
  export let inventory: Record<string, number>;
  export let expected: Record<string, number>;
  $: total = Object.values(inventory).reduce((a, b) => a + b, 0);
  $: diff = (() => {
    const result: Array<{ pai: string; got: number; exp: number }> = [];
    const allKeys = new Set([...Object.keys(inventory), ...Object.keys(expected)]);
    for (const k of Array.from(allKeys).sort()) {
      const got = inventory[k] ?? 0;
      const exp = expected[k] ?? 0;
      if (got !== exp) result.push({ pai: k, got, exp });
    }
    return result;
  })();
</script>

<h2>📋 全牌チェック [合計 {total} 枚 / 期待 116]</h2>
<div class="tile-checker">
  {#if diff.length === 0}
    <div class="ok">✅ 全牌種数一致</div>
  {:else}
    <div class="warn">⚠️ 差分:</div>
    {#each diff as d}
      <div class="diff-row">{d.pai}: got={d.got} / exp={d.exp} {d.got > d.exp ? '⬆️余分' : '⬇️不足'}</div>
    {/each}
  {/if}
</div>

<style>
  h2 { font-size: 13px; margin: 6px 0 4px; }
  .tile-checker {
    font-size: 11px;
    font-family: 'Menlo', 'Consolas', monospace;
    line-height: 1.6;
  }
  .ok { color: #208040; }
  .warn { color: #c04040; font-weight: bold; }
  .diff-row { font-variant-numeric: tabular-nums; }
</style>
