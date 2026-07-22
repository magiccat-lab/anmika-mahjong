
<script lang="ts">
  // フィーバー中 冬使う / 保留 modal
  export let winner: number;
  export let waitRemain: number = 0;
  export let shanRemain: number = 0;
  export let onSelect: (use: boolean) => void;
</script>

<div class="modal fuyu">
  <div class="title">❄️ フィーバー中、 冬を使う？ [player {winner}]</div>
  <div class="info">
    <div class="info-row">残り待ち牌: <strong>{waitRemain}</strong> 枚</div>
    <div class="info-row">残り山: <strong>{shanRemain}</strong> 枚</div>
  </div>
  <div class="actions">
    <button class="primary" on:click={() => onSelect(true)}>使う [アリス発動 + フィーバー終了]</button>
    <button class="secondary" on:click={() => onSelect(false)}>保留 [継続]</button>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    /* 2026-07-22 SP対応: 低背でも収まるよう固定寸法を流体化 [PC は従来寸法に収束] */
    top: min(22%, 48px);
    left: 50%;
    transform: translateX(-50%);
    background: #222;
    color: #fff;
    padding: clamp(12px, 4dvh, 22px) clamp(16px, 5dvw, 28px);
    z-index: 1010;
    border-radius: 10px;
    font-family: 'Noto Sans JP', sans-serif;
    min-width: min(460px, 88dvw);
    max-width: 94dvw;
    max-height: 86dvh;
    overflow-y: auto;
    box-sizing: border-box;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  }
  .modal.fuyu { border: 3px solid skyblue; }
  .title { font-weight: bold; margin-bottom: 14px; font-size: 20px; }
  .info { margin: 10px 0 16px; display: flex; gap: 24px; }
  .info-row { font-size: 17px; }
  .info-row strong { color: #ffd060; font-size: 22px; font-variant-numeric: tabular-nums; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .actions button {
    padding: 12px 18px;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    font-weight: 700;
  }
  .actions .primary { background: #2080d0; color: #fff; }
  .actions .secondary { background: #888; color: #fff; }
</style>
