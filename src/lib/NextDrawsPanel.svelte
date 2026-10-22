<script lang="ts">
  // [2026-10-22 リョー「観戦モードに限りそのあとのそれぞれのツモ見れるようにするとかできない？」]
  // 観戦だけが見る「この後のツモ」。局が終わったあと、続けていたら各席が引いたはずの牌を引く順に並べる。
  // 牌そのものは Tile の小サイズを使い、席ごとに 1 行 [幅が足りなければ折り返す]。
  import Tile from './Tile.svelte';

  /** 表示する席 [左 ・ 中 ・ 右の並び = App の srv1 / srv0 / srv2]。名前は席の札と同じ */
  export let rows: Array<{ seat: number; name: string }> = [];
  /** 席番号 → 引く順の牌 */
  export let draws: Record<number, string[]> = {};
</script>

<div class="next-draws" role="region" aria-label="この後のツモ">
  <h3 class="nd-title">この後のツモ <span class="nd-note">[続けたら引く牌]</span></h3>
  {#each rows as row (row.seat)}
    {@const tiles = draws[row.seat] ?? []}
    <div class="nd-row" data-seat={row.seat}>
      <span class="nd-name">{row.name}</span>
      <span class="nd-tiles">
        {#each tiles as t, i (i)}<Tile pai={t} size="sm" />{/each}
        {#if tiles.length === 0}<span class="nd-none">なし</span>{/if}
      </span>
    </div>
  {/each}
</div>

<style>
  .next-draws {
    /* 和了 ・ 流局の板の中に置く明るい地。板の下の「次局」ボタンの上に 1 ブロックで入る */
    box-sizing: border-box;
    margin: 8px 0;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(60, 50, 30, 0.07);
    border: 1px solid rgba(120, 100, 50, 0.25);
    color: #3a3220;
    font-size: 12px;
    line-height: 1.3;
  }
  .nd-title { margin: 0 0 3px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
  .nd-note { font-weight: 400; opacity: 0.7; }
  .nd-row { display: flex; align-items: flex-start; gap: 6px; margin-top: 2px; }
  .nd-name { flex: none; width: 5.2em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-top: 4px; }
  .nd-tiles { display: flex; flex-wrap: wrap; gap: 0; min-width: 0; }
  .nd-tiles :global(.tile.size-sm) { width: 17px; height: 24px; min-width: 0; min-height: 0; margin: 1px 0.5px; }
  .nd-none { opacity: 0.6; padding-top: 4px; }
</style>
