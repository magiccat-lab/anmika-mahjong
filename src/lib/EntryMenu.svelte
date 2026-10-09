
<script lang="ts">
  // 起動時メニュー: 一人回し / 対戦 [Discord ログイン] の 2 button
  // App.svelte から抽出 [2026-05-13 リョー指示の component 化、 1 ヶ所目]
  export let onSelectSolo: () => void = () => {};
  export let onSelectOnline: () => void = () => {};
  export let onSelectStats: () => void = () => {};
  export let onSelectReplay: () => void = () => {};
  // [2026-09-14] 説明書と画面設定を入口に出す
  export let onSelectRules: () => void = () => {};
  export let onSelectSettings: () => void = () => {};
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
  <!-- [2026-07-23 リョー要望] 戦績 [オンライン対戦の記録から集計] -->
  <button class="entry-btn stats" on:click={onSelectStats}>
    <span class="btn-main">📊 戦績</span>
  </button>
  <!-- [2026-07-23 リョー要望] 名牌譜 [試合記録の再生と名局保存] -->
  <button class="entry-btn replay" on:click={onSelectReplay}>
    <span class="btn-main">📼 牌譜</span>
  </button>
  <!-- [2026-09-14] ルールが特殊なので初見の入口を出す -->
  <button class="entry-btn rules" on:click={onSelectRules}>
    <span class="btn-main">📖 説明書</span>
  </button>
  <button class="entry-btn settings" on:click={onSelectSettings}>
    <span class="btn-main">⚙️ 画面設定</span>
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
    /* [2026-10-09 shun2 見た目 b] 入口も卓と同じフェルトと木の縁 */
    background: var(--jz-felt-bg);
    box-shadow: inset 0 0 0 10px var(--jz-wood), inset 0 0 0 11px rgba(208, 170, 82, 0.5);
    color: var(--jz-ink);
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
    font-weight: 700;
    color: var(--jz-ink);
    letter-spacing: 0.06em;
  }
  /* [2026-10-09 shun2 V8] ボタンは 主 [金] と 副 [淡い札] の 2 種、角 4px、高さ 52px。
     旧: 6 色 [緑 ・ 青 ・ 茶 ・ 紫 ・ 紺 ・ 灰] で色と意味が結び付いていなかった */
  .entry-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: min(320px, calc(100vw - 32px));
    min-width: 0;
    min-height: 52px;
    box-sizing: border-box;
    padding: 0.7rem 1.25rem;
    border: 1px solid var(--jz-sec-bd);
    border-radius: var(--jz-rad);
    background: var(--jz-sec);
    color: var(--jz-ink);
    cursor: pointer;
    touch-action: manipulation;
    transition: filter 0.12s ease;
  }
  .entry-btn .btn-main { font-size: 1.1rem; font-weight: 700; line-height: 1.25; }
  .entry-btn.solo,
  .entry-btn.online { background: var(--jz-accent); color: var(--jz-on-accent); border-color: transparent; box-shadow: var(--jz-shadow); }
  .entry-btn:hover { filter: brightness(1.08); }
  .entry-btn:focus-visible { outline: 3px solid var(--jz-gold); outline-offset: 3px; }

  @media (max-width: 420px) {
    .entry-menu { gap: 1rem; padding: 16px; box-sizing: border-box; }
    .entry-menu h1 { margin-bottom: 0.5rem; font-size: 2rem; }
    .entry-btn { width: 100%; font-size: 1rem; }
  }
</style>
