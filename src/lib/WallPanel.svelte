
<script lang="ts">
  // 山構成 panel [debug 用]
  import Tile from './Tile.svelte';
  export let wall: string[];
  export let baopai: string[];
  export let fubaopai: string[];
  function wpaiLabel(i: number): string {
    if (i < 4) return `嶺${i}`;
    if (i === 4 || i === 5) return `表${i - 4}`;
    if (i === 9 || i === 10) return `裏${i - 9}`;
    return `予${i}`;
  }
</script>

<h2>🗻 山構成 [全 {wall.length} 枚]</h2>
<div class="wall-panel">
  <div class="row">
    <strong>ツモ順 [末尾→先頭]:</strong>
    <span class="inline-tiles">
      {#each [...wall].slice(16).reverse() as t}<Tile pai={t} size="sm" />{/each}
    </span>
  </div>
  <div class="row">
    <strong>王牌 [先頭 16 枚: リンシャン 16 + 表ドラ {baopai.length} + 裏ドラ {fubaopai.length}]:</strong>
    <span class="inline-tiles wangpai">
      {#each wall.slice(0, 16) as t, i}
        <span class="wp-tile">
          <Tile pai={t} size="sm" />
          <div class="wp-tag">{wpaiLabel(i)}</div>
        </span>
      {/each}
    </span>
  </div>
  <div class="row">
    <strong>表ドラ:</strong>
    <span class="inline-tiles">
      {#each baopai as t}<Tile pai={t} size="sm" />{/each}
    </span>
    <strong>裏ドラ:</strong>
    <span class="inline-tiles">
      {#each fubaopai as t}<Tile pai={t} size="sm" />{/each}
    </span>
  </div>
</div>

<style>
  h2 { font-size: 13px; margin: 6px 0 4px; }
  .wall-panel { font-size: 11px; }
  .row { margin-top: 6px; line-height: 1.6; }
  .row:first-child { margin-top: 0; }
  .row strong { font-weight: bold; color: #555; margin-right: 4px; }
  .inline-tiles { display: inline-block; vertical-align: middle; }
  .wangpai { display: inline-flex; flex-wrap: wrap; gap: 2px; }
  .wp-tile { display: inline-block; text-align: center; }
  .wp-tag { font-size: 9px; color: #888; margin-top: 2px; }
</style>
