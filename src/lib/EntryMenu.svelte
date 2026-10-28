
<script lang="ts">
  // 起動時メニュー: 一人回し / 対戦 [Discord ログイン] の 2 button
  // App.svelte から抽出 [2026-05-13 リョー指示の component 化、 1 ヶ所目]
  export let onSelectSolo: () => void = () => {};
  export let onSelectOnline: () => void = () => {};
  export let onSelectStats: () => void = () => {};
  export let onSelectReplay: () => void = () => {};
  // [2026-10-14] 部屋ごとの打牌の分析
  export let onSelectAnalysis: () => void = () => {};
  // [2026-09-14] 説明書と画面設定を入口に出す
  export let onSelectRules: () => void = () => {};
  export let onSelectSettings: () => void = () => {};
  // [2026-10-15 リョー「トップページに演出一覧ってボタン押してそこから見れるようにページ出して」] 演出ごとの出る割合と当たり
  export let onSelectFxOdds: () => void = () => {};
</script>

<div class="entry-menu">
  <div class="entry-brand">
    <h1>ONLINE ANMIKA</h1>
  </div>
  <!-- [2026-10-29 サイバー B / P2] 一人回しと対戦は斜めの大きな板。英語の見出しは飾りなので読み上げからは外す -->
  <button class="entry-btn big solo" on:click={onSelectSolo}>
    <span class="btn-en" aria-hidden="true">SOLO</span>
    <span class="btn-main">一人回しモード</span>
  </button>
  <button class="entry-btn big online" on:click={onSelectOnline}>
    <span class="btn-en" aria-hidden="true">VERSUS</span>
    <span class="btn-main">対戦モード</span>
  </button>
  <!-- [2026-07-23 リョー要望] 戦績 [オンライン対戦の記録から集計] -->
  <button class="entry-btn small stats" on:click={onSelectStats}>
    <span class="btn-main">戦績</span>
    <span class="btn-en" aria-hidden="true">STATS</span>
  </button>
  <!-- [2026-07-23 リョー要望] 名牌譜 [試合記録の再生と名局保存] -->
  <button class="entry-btn small replay" on:click={onSelectReplay}>
    <span class="btn-main">牌譜</span>
    <span class="btn-en" aria-hidden="true">REPLAY</span>
  </button>
  <!-- [2026-10-14 リョー「まあトップから分析ページに飛べるようにしたい」] 部屋ごとの打牌の分析 -->
  <button class="entry-btn small analysis" on:click={onSelectAnalysis}>
    <span class="btn-main">分析</span>
    <span class="btn-en" aria-hidden="true">ANALYZE</span>
  </button>
  <!-- [2026-09-14] ルールが特殊なので初見の入口を出す -->
  <button class="entry-btn small rules" on:click={onSelectRules}>
    <span class="btn-main">説明書</span>
    <span class="btn-en" aria-hidden="true">RULES</span>
  </button>
  <button class="entry-btn small fxodds" on:click={onSelectFxOdds}>
    <span class="btn-main">演出一覧</span>
    <span class="btn-en" aria-hidden="true">EFFECTS</span>
  </button>
  <button class="entry-btn small settings" on:click={onSelectSettings}>
    <span class="btn-main">画面設定</span>
    <span class="btn-en" aria-hidden="true">CONFIG</span>
  </button>
</div>

<style>
  /* [2026-10-29 サイバー B / P2] 狭い画面は縦に積んで傾けない。広い画面は大きな板を奥行きの中で傾ける。
     文字は折り返さない [nowrap + clamp] */
  .entry-menu {
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 10px;
    min-height: 100vh;
    min-height: 100dvh;
    padding: 24px 16px 40px;
    box-sizing: border-box;
    background: var(--jz-felt-bg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cy-line) 45%, transparent);
    color: var(--jz-ink);
  }
  /* 床の格子 */
  .entry-menu::before {
    content: '';
    position: absolute;
    left: -20%;
    right: -20%;
    bottom: -10%;
    height: 55%;
    background:
      linear-gradient(var(--cy-dim) 1px, transparent 1px) 0 0 / 60px 60px,
      linear-gradient(90deg, var(--cy-dim) 1px, transparent 1px) 0 0 / 60px 60px;
    transform: rotateX(72deg);
    transform-origin: 50% 100%;
    -webkit-mask-image: linear-gradient(to top, #000 0%, transparent 85%);
    mask-image: linear-gradient(to top, #000 0%, transparent 85%);
    pointer-events: none;
    opacity: 0.55;
  }
  .entry-menu > * { position: relative; }
  .entry-brand { display: flex; justify-content: center; margin-bottom: 14px; }
  .entry-menu h1 {
    margin: 0;
    font: 800 clamp(22px, 6.4vw, 54px) / 1.1 var(--cy-font-num);
    letter-spacing: 0.06em;
    white-space: nowrap;
    color: var(--cy-ink);
    text-shadow: 0 0 18px color-mix(in srgb, var(--cy-line) 65%, transparent);
  }
  .entry-btn {
    --tone: var(--cy-line);
    display: flex;
    min-width: 0;
    box-sizing: border-box;
    padding: 0 18px;
    border: 1px solid var(--cy-dim);
    border-radius: 0;
    background: color-mix(in srgb, var(--cy-panel-solid) 85%, transparent);
    color: var(--cy-ink);
    font-family: var(--cy-font-label);
    cursor: pointer;
    touch-action: manipulation;
    transition: filter 0.12s ease;
  }
  .entry-btn.online { --tone: var(--cy-hot); }
  .entry-btn .btn-main { white-space: nowrap; font-weight: 700; line-height: 1.25; }
  .entry-btn .btn-en { white-space: nowrap; font-family: var(--cy-font-num); font-weight: 800; letter-spacing: 0.08em; }
  .entry-btn:hover { filter: brightness(1.12); }
  .entry-btn:focus-visible { outline: 3px solid var(--cy-line); outline-offset: 3px; }

  /* 大きな板 */
  .entry-btn.big {
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-end;
    gap: 6px;
    min-height: 112px;
    padding: 16px 22px;
    border-color: var(--tone);
    background: linear-gradient(120deg, color-mix(in srgb, var(--tone) 26%, transparent), color-mix(in srgb, var(--cy-panel-solid) 90%, transparent));
    box-shadow: inset 0 0 30px color-mix(in srgb, var(--tone) 22%, transparent);
  }
  .entry-btn.big .btn-en {
    font-size: clamp(30px, 9vw, 46px);
    line-height: 1;
    color: var(--tone);
    text-shadow: 0 0 14px color-mix(in srgb, var(--tone) 70%, transparent);
  }
  .entry-btn.big .btn-main { font-size: 1.05rem; }
  /* 小さな札 */
  .entry-btn.small {
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 46px;
  }
  .entry-btn.small .btn-main { font-size: 1rem; }
  .entry-btn.small .btn-en { font-size: 11px; color: var(--cy-sub-ink); }
  .entry-btn.small:hover .btn-en { color: var(--cy-line); }

  /* 広い画面: 左に大きな板 2 枚、右に小さな札 6 枚。どちらも奥に向けて傾ける */
  @media (min-width: 721px) {
    .entry-menu {
      display: grid;
      grid-template-columns: 400px 300px;
      grid-template-areas: 'brand brand' 'solo stats' 'solo replay' 'solo analysis' 'online rules' 'online fxodds' 'online settings';
      column-gap: clamp(60px, 12vw, 160px);
      row-gap: 12px;
      align-content: center;
      justify-content: center;
      align-items: stretch;
      perspective: 1100px;
      padding: 32px 16px;
    }
    .entry-brand { grid-area: brand; margin-bottom: 28px; }
    .entry-btn.solo { grid-area: solo; }
    .entry-btn.online { grid-area: online; }
    .entry-btn.stats { grid-area: stats; }
    .entry-btn.replay { grid-area: replay; }
    .entry-btn.analysis { grid-area: analysis; }
    .entry-btn.rules { grid-area: rules; }
    .entry-btn.fxodds { grid-area: fxodds; }
    .entry-btn.settings { grid-area: settings; }
    .entry-btn.big { justify-self: end; width: 400px; height: 100%; transform: rotateY(16deg); transform-origin: 100% 50%; }
    .entry-btn.small { width: 300px; transform: rotateY(-16deg); transform-origin: 0 50%; }
  }
  @media (min-width: 721px) and (max-width: 960px) {
    .entry-menu { grid-template-columns: 320px 260px; }
    .entry-btn.big { width: 320px; }
    .entry-btn.small { width: 260px; }
  }
</style>
