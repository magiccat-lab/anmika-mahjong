
<script lang="ts">
  // 金北強化選択 modal [アガリ後変更可]
  export let winnerName: string | null = null;
  export let winner: number;
  export let huapai: string[];
  export let onSelect: (target: 'haru' | 'natsu' | 'aki' | 'fuyu' | null) => void;
  /** true: フィーバー時、 保留可。 false: 通常アガリ、 保留不可 [リョー指示 2026-05-12] */
  export let allowHold: boolean = false;
</script>

<div class="modal kinpei">
  <div class="title">🎁 金北 強化対象選択 [{winnerName ?? `player ${winner}`}]{allowHold ? '' : ' [必須]'}</div>
  <div class="actions">
    {#if huapai.includes('f1')}
      <button class="haru" on:click={() => onSelect('haru')}>春</button>
    {/if}
    {#if huapai.includes('f2')}
      <button class="natsu" on:click={() => onSelect('natsu')}>夏</button>
    {/if}
    {#if huapai.includes('f3')}
      <button class="aki" on:click={() => onSelect('aki')}>秋</button>
    {/if}
    {#if huapai.includes('f4')}
      <button class="fuyu" on:click={() => onSelect('fuyu')}>冬</button>
    {/if}
    {#if allowHold}
      <button class="hold" on:click={() => onSelect(null)}>保留 [今局のみ]</button>
    {/if}
  </div>
</div>

<style>
  .modal {
    position: fixed;
    top: min(30%, 64px);
    left: 50%;
    transform: translateX(-50%);
    background: #222;
    color: #fff;
    padding: 12px 16px;
    z-index: 1000;
    border-radius: 8px;
    font-family: 'Noto Sans JP', sans-serif;
    max-width: 94dvw;
    max-height: 86dvh;
    overflow-y: auto;
    box-sizing: border-box;
  }
  .modal.kinpei { border: 2px solid gold; }
  .title { font-weight: bold; margin-bottom: 8px; font-size: 13px; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .actions button {
    padding: 6px 12px;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: #fff;
    font-weight: bold;
  }
  .actions .haru { background: #c0a060; }
  .actions .natsu { background: #40a040; }
  .actions .aki { background: #c06040; }
  .actions .fuyu { background: #4080c0; }
  .actions .hold { background: #888; font-weight: normal; }
</style>
