
<script lang="ts">
  export let loadedPaifu: any;
  export let loadedReplayIdx: number;
  export let replayLabel: (e: any) => string;
  export let onPrev: () => void;
  export let onNext: () => void;
  export let onClose: () => void;
</script>

<section class="paifu-load">
  <h2>📂 ロード牌譜 [{loadedPaifu.timestamp}]</h2>
  <div class="replay-controls">
    <button on:click={onPrev} disabled={loadedReplayIdx === 0}>◀ 前</button>
    <span class="replay-pos">{loadedReplayIdx + 1} / {loadedPaifu.events.length}</span>
    <button on:click={onNext} disabled={loadedReplayIdx >= loadedPaifu.events.length - 1}>次 ▶</button>
    <button on:click={onClose}>閉じる</button>
  </div>
  <div class="replay-current">
    <strong>現在 [{loadedReplayIdx + 1}]:</strong> {replayLabel(loadedPaifu.events[loadedReplayIdx])}
  </div>
  <ol class="replay-list">
    {#each loadedPaifu.events as e, i}
      <li class:active={i === loadedReplayIdx}>{replayLabel(e)}</li>
    {/each}
  </ol>
</section>

<style>
  section.paifu-load {
    border: 1px solid #2080d0;
    background: #f8fcff;
    padding: 8px 12px;
    border-radius: 6px;
    margin: 12px 0;
  }
  h2 { font-size: 13px; margin: 0 0 6px; color: #2080d0; }
  .replay-controls { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
  .replay-pos { font-family: monospace; font-size: 12px; }
  .replay-current { font-size: 12px; color: #555; padding: 4px 0; }
  .replay-list { max-height: 200px; overflow: auto; font-size: 11px; font-family: monospace; padding-left: 24px; }
  .replay-list li.active { background: #fffacd; font-weight: bold; }
</style>
