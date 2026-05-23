
<script lang="ts">
  // 起動時メニュー: 一人回し / 対戦 [Discord ログイン] の 2 button
  // App.svelte から抽出 [2026-05-13 リョー指示の component 化、 1 ヶ所目]
  export let onSelectSolo: () => void = () => {};
  export let onSelectOnline: () => void = () => {};
</script>

<div class="entry-menu">
  <h1>アンミカ三麻</h1>
  <button class="entry-btn solo" on:click={onSelectSolo}>🀄 一人回しモード</button>
  <button class="entry-btn online" on:click={onSelectOnline}>🌐 対戦モード [Discord ログイン]</button>
</div>

<style>
  .entry-menu { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 70vh; gap: 1.5rem; }
  .entry-menu h1 { font-size: 2.5rem; }
  .entry-btn { font-size: 1.3rem; padding: 1rem 2rem; min-width: 320px; border-radius: 12px; cursor: pointer; }
  .entry-btn.solo { background: #2a7; color: white; }
  .entry-btn.online { background: #27a; color: white; }
</style>
