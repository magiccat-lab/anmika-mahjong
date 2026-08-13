
<script lang="ts">
  // 金北強化選択 modal [アガリ後変更可]
  export let preview: { hupai: Array<{ name: string; fanshu: unknown }>; fanshu?: number } | null = null;
  export let winnerName: string | null = null;
  export let winner: number;
  export let huapai: string[];
  export let onSelect: (target: 'haru' | 'natsu' | 'aki' | 'fuyu' | null) => void;
  /** true: フィーバー時、 保留可。 false: 通常アガリ、 保留不可 [リョー指示 2026-05-12] */
  export let allowHold: boolean = false;

  // 2026-08-13 手順F: shell を Sheet へ統合 [寸法・色は従来値をそのまま渡す]
  import Sheet from './Sheet.svelte';
</script>

<Sheet
  ariaLabel="金北 強化対象選択"
  tone="dark"
  size="compact"
  top="min(30%, 64px)"
  border="2px solid gold"
  z={1000}
>
  <div class="title">🎁 金北 強化対象選択 [{winnerName ?? `player ${winner}`}]{allowHold ? '' : ' [必須]'}</div>
  {#if preview}
    <div class="preview">現時点: {preview.fanshu !== undefined ? `${preview.fanshu}翻` : '役満'} / {(preview.hupai ?? []).map((h) => h.name).join('・')}</div>
  {/if}
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
</Sheet>

<style>
  .preview { font-size: 11px; color: #ffe9ad; margin-bottom: 8px; max-width: 420px; line-height: 1.5; }
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
