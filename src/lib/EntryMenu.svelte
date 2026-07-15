
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
  .entry-btn {
    width: min(320px, calc(100vw - 32px));
    min-width: 0;
    min-height: 58px;
    box-sizing: border-box;
    font-size: 1.15rem;
    padding: 0.9rem 1.25rem;
    border-radius: 12px;
    cursor: pointer;
    touch-action: manipulation;
  }
  .entry-btn.solo { background: #2a7; color: white; }
  .entry-btn.online { background: #27a; color: white; }
  .entry-btn:focus-visible { outline: 3px solid #ffd060; outline-offset: 3px; }

  @media (max-width: 420px) {
    .entry-menu { gap: 1rem; padding: 16px; box-sizing: border-box; }
    .entry-menu h1 { margin-bottom: 0.5rem; font-size: 2rem; }
    .entry-btn { width: 100%; font-size: 1rem; }
  }
</style>
