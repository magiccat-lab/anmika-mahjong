<script lang="ts">
  import {
    lizhiCandidateText,
    lizhiChoiceId,
    lizhiChoiceLabel,
    type LizhiChoiceId,
    type LizhiPendingFlags,
  } from './lizhiUi';

  export let pending = false;
  export let flags: LizhiPendingFlags | null = null;
  export let normalCandidates: string[] = [];
  export let feverCandidates: string[] = [];
  export let feverAvailable = false;
  export let shuvariUsed = false;
  export let onSelect: (opts: { open?: boolean; shuvari?: boolean; fever?: boolean }) => void = () => {};
  // 2026-07-22 リョー要望: 宣言牌を切る前なら選択中ボタンの再クリックで取消
  export let onCancel: () => void = () => {};

  $: selected = pending ? lizhiChoiceId(flags) : null;
  $: normalText = lizhiCandidateText(normalCandidates);
  $: feverText = lizhiCandidateText(feverCandidates);
  $: selectedText = selected === 'fever' || selected === 'shuvari-fever' ? feverText : normalText;

  function ariaLabel(id: LizhiChoiceId, candidates: string): string {
    return `${lizhiChoiceLabel(id)}を選択。選択後に切れる宣言牌: ${candidates}`;
  }
</script>

<div class="lizhi-controls" aria-label="リーチ種別と宣言牌の選択">
  <button
    type="button" class="choice lizhi-choice normal" class:selected={selected === 'normal'}
    aria-pressed={selected === 'normal'} aria-label={ariaLabel('normal', normalText)}
    disabled={pending ? selected !== 'normal' : normalCandidates.length === 0}
    on:click={() => pending ? onCancel() : onSelect({})}
  >
    <span class="choice-name">{selected === 'normal' ? '✓ ' : ''}通常リーチ</span>
    <span class="choice-candidates">宣言牌: {normalText}</span>
  </button>

  {#if !shuvariUsed}
    <button
      type="button" class="choice lizhi-choice shuvari" class:selected={selected === 'shuvari'}
      aria-pressed={selected === 'shuvari'} aria-label={ariaLabel('shuvari', normalText)}
      disabled={pending ? selected !== 'shuvari' : normalCandidates.length === 0}
      on:click={() => pending ? onCancel() : onSelect({ shuvari: true })}
    >
      <span class="choice-name">{selected === 'shuvari' ? '✓ ' : ''}シュバリーチ</span>
      <span class="choice-candidates">宣言牌: {normalText}</span>
    </button>
  {/if}

  {#if feverAvailable}
    <button
      type="button" class="choice lizhi-choice fever" class:selected={selected === 'fever'}
      aria-pressed={selected === 'fever'} aria-label={ariaLabel('fever', feverText)}
      disabled={pending ? selected !== 'fever' : feverCandidates.length === 0}
      on:click={() => pending ? onCancel() : onSelect({ fever: true })}
    >
      <span class="choice-name">{selected === 'fever' ? '✓ ' : ''}フィーバーリーチ</span>
      <span class="choice-candidates">宣言牌: {feverText}</span>
    </button>
    {#if !shuvariUsed}
      <button
        type="button" class="choice lizhi-choice shuvari-fever" class:selected={selected === 'shuvari-fever'}
        aria-pressed={selected === 'shuvari-fever'} aria-label={ariaLabel('shuvari-fever', feverText)}
        disabled={pending ? selected !== 'shuvari-fever' : feverCandidates.length === 0}
        on:click={() => pending ? onCancel() : onSelect({ shuvari: true, fever: true })}
      >
        <span class="choice-name">{selected === 'shuvari-fever' ? '✓ ' : ''}シュバ・フィーバー</span>
        <span class="choice-candidates">宣言牌: {feverText}</span>
      </button>
    {/if}
  {/if}

  <button
    type="button" class="choice lizhi-choice open" class:selected={selected === 'open'}
    aria-pressed={selected === 'open'} aria-label={ariaLabel('open', normalText)}
    disabled={pending ? selected !== 'open' : normalCandidates.length === 0}
    on:click={() => pending ? onCancel() : onSelect({ open: true })}
  >
    <span class="choice-name">{selected === 'open' ? '✓ ' : ''}オープンリーチ</span>
    <span class="choice-candidates">宣言牌: {normalText}</span>
  </button>

  {#if !shuvariUsed}
    <button
      type="button" class="choice lizhi-choice shuvari-open" class:selected={selected === 'shuvari-open'}
      aria-pressed={selected === 'shuvari-open'} aria-label={ariaLabel('shuvari-open', normalText)}
      disabled={pending ? selected !== 'shuvari-open' : normalCandidates.length === 0}
      on:click={() => pending ? onCancel() : onSelect({ shuvari: true, open: true })}
    >
      <span class="choice-name">{selected === 'shuvari-open' ? '✓ ' : ''}シュバ・オープン</span>
      <span class="choice-candidates">宣言牌: {normalText}</span>
    </button>
  {/if}

  {#if pending && selected}
    <div class="selection-status" role="status" aria-live="polite" data-testid="lizhi-selection-status">
      <strong>選択確定: {lizhiChoiceLabel(selected)}</strong>
      <span>次に切る牌: {selectedText}</span>
      <small>手牌の「切る」表示から1枚選んでください / 選択中ボタンをもう一度クリックで取消</small>
    </div>
  {/if}
</div>

<style>
  .lizhi-controls {
    display: flex;
    flex: 1 1 100%;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 6px;
  }
  button.choice {
    display: inline-flex;
    min-width: 132px;
    max-width: 220px;
    flex: 1 1 132px;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 6px 8px;
    border: 2px solid #b08040;
    border-radius: 6px;
    background: #d4b070;
    color: #fff;
    line-height: 1.25;
    text-align: left;
  }
  button.choice.shuvari { background: #8f711c; }
  button.choice.fever { background: #a04020; }
  button.choice.shuvari-fever { background: #aa1038; }
  button.choice.open { background: #9b5419; }
  button.choice.shuvari-open { background: #71370d; }
  button.choice.selected {
    border-color: #fff4a0;
    background: #f2dc28;
    color: #2d2600;
    box-shadow: 0 0 0 3px #ffbd18, 0 0 15px rgba(255, 208, 64, 0.85);
    font-weight: 800;
  }
  button.choice:disabled:not(.selected) { cursor: not-allowed; opacity: 0.5; }
  button.choice.selected:disabled { cursor: default; opacity: 1; }
  .choice-name { font-size: 12px; font-weight: 800; }
  .choice-candidates { font-size: 10px; overflow-wrap: anywhere; }
  .selection-status {
    display: flex;
    flex: 1 1 100%;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    padding: 7px 10px;
    border: 2px solid #f0b000;
    border-radius: 6px;
    background: #fff8cf;
    color: #392b00;
  }
  .selection-status strong { font-size: 13px; }
  .selection-status span { font-size: 12px; font-weight: 700; }
  .selection-status small { flex-basis: 100%; font-size: 10px; }
  @media (max-width: 680px) {
    button.choice { min-width: calc(50% - 4px); max-width: none; flex-basis: calc(50% - 4px); }
  }
</style>
