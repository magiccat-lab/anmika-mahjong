<script lang="ts">
  // [2026-10-29 リョー ○ 見た目 B / P1] 残り山の枚数を大きな数字と、1 枚 1 目盛りの帯で見せる。
  // 1 枚引くごとに目盛りが 1 つ消え、10 枚以下で赤になる。数字と帯の元は同じ [paishu と、その局の最大値]
  export let remaining: number;
  /** その局の山の最大枚数 [目盛りの数]。remaining が超えたら remaining に合わせる */
  export let total: number;

  $: cells = Math.max(Math.floor(total), Math.floor(remaining), 1);
  $: low = remaining <= 10;
</script>

<div class="cy-wall" class:low role="meter" aria-label="残り山" aria-valuemin="0" aria-valuemax={cells} aria-valuenow={remaining}>
  <div class="cy-wall-num"><span class="n">{remaining}</span><small>WALL</small></div>
  <div class="cy-wall-bar" style="--cells: {cells}" aria-hidden="true">
    {#each Array(cells) as _, i}<i class:off={i >= remaining}></i>{/each}
  </div>
</div>

<style>
  .cy-wall {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: stretch;
    width: 100%;
    min-width: 0;
    margin-top: 4px;
  }
  .cy-wall-num {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 6px;
    white-space: nowrap;
    line-height: 1;
  }
  .n {
    font: 700 clamp(16px, 2.2vmin + 6px, 24px) / 1 var(--cy-font-num);
    letter-spacing: 0.06em;
    color: var(--cy-pt);
    text-shadow: 0 0 10px color-mix(in srgb, var(--cy-pt) 70%, transparent);
    font-variant-numeric: tabular-nums;
  }
  small {
    font: 700 10px / 1 var(--cy-font-label);
    letter-spacing: 0.2em;
    color: var(--cy-sub-ink);
  }
  .cy-wall-bar {
    display: grid;
    grid-template-columns: repeat(var(--cells), minmax(0, 1fr));
    gap: 1px;
    height: 12px;
    padding: 2px;
    border: 1px solid var(--cy-dim);
    box-sizing: border-box;
  }
  i {
    background: var(--cy-line);
    box-shadow: 0 0 6px color-mix(in srgb, var(--cy-line) 70%, transparent);
    transition: background-color 0.15s ease;
  }
  i.off {
    background: color-mix(in srgb, var(--cy-line) 10%, transparent);
    box-shadow: none;
  }
  /* 残り 10 枚以下は赤。数字も合わせる */
  .low i:not(.off) {
    background: var(--cy-hot);
    box-shadow: 0 0 6px var(--cy-hot);
  }
  .low .n {
    color: var(--cy-hot);
    text-shadow: 0 0 10px color-mix(in srgb, var(--cy-hot) 70%, transparent);
  }
</style>
