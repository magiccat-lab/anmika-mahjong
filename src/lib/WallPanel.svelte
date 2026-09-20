
<script lang="ts">
  // 山構成 panel。reveal=true は debug / 牌譜再生用で牌面を出す。
  // reveal=false [対局中の「山を見る」] は枚数と伏せ牌だけ。
  // [2026-09-20 リョー報告「ツモ牌ネタバレしてる」: 対局中の山がツモ順の牌面を出していた]
  import Tile from './Tile.svelte';
  export let wall: string[];     // live wall のみ [末尾から通常ツモ]
  export let rinshan: string[] = [];
  export let baopai: string[];
  export let fubaopai: string[];
  export let reveal: boolean = true;
</script>

<h2>🗻 山構成 [生牌 {wall.length} 枚 / 王牌 {rinshan.length + baopai.length + fubaopai.length} 枚]</h2>
<div class="wall-panel">
  <div class="row">
    <strong>{reveal ? 'ツモ順 [末尾→先頭]:' : '生牌 [伏せ]:'}</strong>
    <span class="inline-tiles">
      {#each [...wall].reverse() as t}<Tile pai={reveal ? t : ''} face={reveal ? 'up' : 'down'} size="sm" />{/each}
    </span>
  </div>
  <div class="row">
    <strong>嶺上牌 [{rinshan.length} 枚]:</strong>
    <span class="inline-tiles wangpai">
      {#each rinshan as t, i}
        <span class="wp-tile">
          <Tile pai={reveal ? t : ''} face={reveal ? 'up' : 'down'} size="sm" />
          <div class="wp-tag">嶺{i}</div>
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
      {#each fubaopai as t}<Tile pai={reveal ? t : ''} face={reveal ? 'up' : 'down'} size="sm" />{/each}
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
