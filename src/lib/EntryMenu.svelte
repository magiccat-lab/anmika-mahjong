
<script lang="ts">
  // 起動時メニュー: 一人回し / 対戦 [Discord ログイン] の 2 button
  // App.svelte から抽出 [2026-05-13 リョー指示の component 化、 1 ヶ所目]
  export let onSelectSolo: () => void = () => {};
  export let onSelectOnline: () => void = () => {};
</script>

<div class="entry-menu">
  <div class="entry-brand">
    <h1>ONLINE ANMIKA</h1>
  </div>
  <button class="entry-btn solo" on:click={onSelectSolo}>
    <span class="btn-main">🀄 一人回しモード</span>
  </button>
  <button class="entry-btn online" on:click={onSelectOnline}>
    <span class="btn-main">🌐 対戦モード</span>
  </button>
</div>

<style>
  .entry-menu {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    /* 2026-07-21 リョー指摘: 70vh + 角丸だと下に body の白帯が見えてヘン。
       全画面に敷いて縁も消す */
    min-height: 100vh;
    min-height: 100dvh;
    gap: 1.5rem;
    padding: 32px 16px;
    box-sizing: border-box;
    border-radius: 0;
    background:
      radial-gradient(ellipse at 50% -10%, rgba(255, 224, 128, 0.14), transparent 55%),
      radial-gradient(ellipse at 50% 115%, rgba(0, 0, 0, 0.45), transparent 60%),
      linear-gradient(165deg, #17452c 0%, #123524 55%, #0d2a1c 100%);
    box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.25);
  }
  .entry-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    text-align: center;
  }
  .entry-menu h1 {
    margin: 0;
    font-size: 2.5rem;
    color: #ffe9ad;
    letter-spacing: 0.06em;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
  }
  .entry-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: min(320px, calc(100vw - 32px));
    min-width: 0;
    min-height: 58px;
    box-sizing: border-box;
    font-size: 1.15rem;
    padding: 0.8rem 1.25rem;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 12px;
    cursor: pointer;
    touch-action: manipulation;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
  }
  .entry-btn .btn-main { font-size: 1.15rem; font-weight: 700; line-height: 1.25; }
  .entry-btn.solo { background: #2a7; color: white; }
  .entry-btn.online { background: #27a; color: white; }
  .entry-btn:hover { transform: translateY(-2px); box-shadow: 0 7px 18px rgba(0, 0, 0, 0.4); filter: brightness(1.07); }
  .entry-btn:active { transform: translateY(0); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35); }
  .entry-btn:focus-visible { outline: 3px solid #ffd060; outline-offset: 3px; }

  @media (max-width: 420px) {
    .entry-menu { gap: 1rem; padding: 16px; box-sizing: border-box; }
    .entry-menu h1 { margin-bottom: 0.5rem; font-size: 2rem; }
    .entry-btn { width: 100%; font-size: 1rem; }
  }
</style>
