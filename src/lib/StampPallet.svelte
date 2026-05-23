
<script lang="ts">
  // スタンプ pallet [12 種 grid、 thumb image + label]
  // 自家 panel の「💬」 button から open、 click で sendStamp
  import { STAMP_IDS, STAMP_LABELS, type StampId } from './store';
  export let onSelect: (id: StampId) => void;
  export let onClose: () => void = () => {};
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="stamp-pallet-overlay" on:click|self={onClose} role="dialog" tabindex="-1">
  <div class="stamp-pallet">
    <div class="stamp-pallet-header">
      <span>スタンプ</span>
      <button class="stamp-close" on:click={onClose}>×</button>
    </div>
    <div class="stamp-grid">
      {#each STAMP_IDS as sid}
        <button class="stamp-btn" on:click={() => { onSelect(sid); onClose(); }} title={STAMP_LABELS[sid]}>
          <img class="stamp-thumb" src={`/stamps/stamp_${sid}.png`} alt={STAMP_LABELS[sid]} />
          <span class="stamp-label">{STAMP_LABELS[sid]}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .stamp-pallet-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .stamp-pallet {
    background: #fff;
    border-radius: 8px;
    padding: 12px;
    min-width: 360px;
    max-width: 92vw;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }
  .stamp-pallet-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-weight: bold;
  }
  .stamp-close {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    line-height: 1;
    padding: 0 6px;
  }
  .stamp-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .stamp-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #f8f8f8;
    cursor: pointer;
  }
  .stamp-thumb {
    width: 64px;
    height: 64px;
    object-fit: contain;
    pointer-events: none;
  }
  .stamp-label {
    font-size: 9px;
    line-height: 1.1;
    color: #555;
    text-align: center;
    word-break: break-word;
  }
  .stamp-btn:hover {
    background: #ffe082;
    border-color: #ff9800;
  }
</style>
