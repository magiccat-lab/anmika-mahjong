
<script lang="ts">
  // 場・局・本場・供託・山残・ドラ表・現家・直前ツモ表示
  import Tile from './Tile.svelte';
  export let changbang: number;
  export let jushu: number;
  export let benbang: number;
  export let lizhibang: number;
  export let paishu: number;
  export let baopai: string[];
  export let dora: string[]; // baopai を doraFrom した結果
  export let currentPlayer: number;
  export let lastZimo: string | null;
  $: ba = ['東', '南', '西'][changbang] ?? '?';
  // [2026-05-15 bug A fix + bug 5 fix] ぽっち色 [z5b/r/g/y] / 金牌 [gp/gs/gN] は ツモ時点で
  // UI 露出すると あがる前に 色 / 金 が バレる。 直ツモ表示は plain key にマスク。
  // 河に出した後は handHe が discardLog から色 / 金 を引いて 表示してくれる [既存仕様]。
  // [2026-05-15 bug 5 fix] 赤 5 [p0/s0] も ツモ瞬間に Tile.svelte が 赤 5 face で 描画して
  // 早バレ。 直ツモ表示では p5 / s5 [通常 5] にマスクして 河出し / アガリ確定 まで隠す。
  function maskZimoReveal(p: string | null): string | null {
    if (!p) return p;
    if (p === 'z5b' || p === 'z5r' || p === 'z5g' || p === 'z5y') return 'z5';
    if (p === 'p0') return 'p5';
    if (p === 's0') return 's5';
    // gp/gs/gN [金牌]: 既存 spec 通り 露出継続 [リョー指示 2026-05-15 維持]
    return p;
  }
  $: lastZimoMasked = maskZimoReveal(lastZimo);
</script>

<div class="header-info">
  <span class="ba">{ba}場 {jushu + 1}局</span>
  <span class="seg">本場 {benbang}</span>
  <span class="seg">供託 {lizhibang}</span>
  <span class="seg">山 {paishu}枚</span>
  <span class="seg dora">
    ドラ表
    {#each baopai as b}<Tile pai={b} size="sm" />{/each}
    →
    {#each dora as d}<Tile pai={d} size="sm" />{/each}
  </span>
  <span class="seg current">現家 p{currentPlayer}</span>
  {#if lastZimo}
    <span class="seg zimo">直ツモ <Tile pai={lastZimoMasked ?? ''} size="sm" /></span>
  {/if}
</div>

<style>
  .header-info {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    font-size: 12px;
    color: #555;
    padding: 4px 0;
  }
  .ba {
    font-weight: bold;
    color: #c04040;
    font-size: 13px;
  }
  .seg { display: inline-flex; align-items: center; gap: 3px; }
  .seg.dora { color: #b07000; }
  .seg.current { color: #406090; font-weight: bold; }
  .seg.zimo { color: #c04040; }
</style>
