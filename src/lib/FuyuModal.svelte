
<script lang="ts">
  // フィーバー中 冬使う / 保留 modal
  export let winnerName: string | null = null;
  export let winner: number;
  export let waitRemain: number = 0;
  export let shanRemain: number = 0;
  export let onSelect: (use: boolean) => void;

  // 2026-08-13 手順F: shell を Sheet へ統合 [寸法・色は従来値をそのまま渡す]
  import Sheet from './Sheet.svelte';
</script>

<Sheet
  ariaLabel="フィーバー中の冬使用選択"
  tone="dark"
  size="standard"
  top="min(22%, 48px)"
  border="3px solid skyblue"
  z={1010}
>
  <div class="title">❄️ フィーバー中、 冬を使う？ [{winnerName ?? `player ${winner}`}]</div>
  <div class="info">
    <div class="info-row">残り待ち牌: <strong>{waitRemain}</strong> 枚</div>
    <div class="info-row">残り山: <strong>{shanRemain}</strong> 枚</div>
  </div>
  <div class="actions">
    <button class="primary" on:click={() => onSelect(true)}>使う [アリス発動 + フィーバー終了]</button>
    <button class="secondary" on:click={() => onSelect(false)}>保留 [継続]</button>
  </div>
</Sheet>

<style>
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
