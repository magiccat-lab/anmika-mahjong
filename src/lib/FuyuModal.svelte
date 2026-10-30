
<script lang="ts">
  // フィーバー中 冬使う / 保留 modal
  export let winnerName: string | null = null;
  export let winner: number;
  // [2026-10-30 リョー] やめ権は正が立直者、逆が下家。owner が winner と違う時は逆なので下家が決める
  export let owner: number | null = null;
  export let ownerName: string | null = null;
  export let waitRemain: number = 0;
  export let shanRemain: number = 0;
  export let onSelect: (use: boolean) => void;
  // [2026-10-27 リョー「冬でやめるかどうかは他の処理が終わってから決めたい」] 秋のめくり ・ ぽっちの
  // 選択まで済んだ保留時の和了と、その時のドラ表。shownBaopai より後ろが今回めくれた分
  export let preview: { hupai: Array<{ name: string; fanshu: unknown }>; fanshu?: number; defen?: number } | null = null;
  export let baopai: string[] = [];
  export let shownBaopai: number = 0;

  // 2026-08-13 手順F: shell を Sheet へ統合 [寸法・色は従来値をそのまま渡す]
  import Sheet from './Sheet.svelte';
  import KinpeiPeekBar from './KinpeiPeekBar.svelte';
  import Tile from './Tile.svelte';

  // [2026-10-24 先輩「冬冬金北とか選ぶか考える時に山の残り枚数とか川とか見れるように」]
  // 金北の選択と同じく板をたたんで盤面 [河 ・ 残り ・ ドラ] を見る。選択 [pendingFuyu] は pending のまま
  let peeking = false;
  $: reverseOwner = owner !== null && owner !== winner;
</script>

{#if peeking}
  <KinpeiPeekBar note="冬を使うかの選択待ち [盤面を見ています]" onBack={() => (peeking = false)} />
{:else}
<Sheet
  ariaLabel="フィーバー中の冬使用選択"
  tone="dark"
  size="standard"
  top="min(22%, 48px)"
  border="3px solid skyblue"
  z={1010}
>
  <div class="title">❄️ フィーバー中、 冬を使う？ [{winnerName ?? `player ${winner}`}] <button type="button" class="peek" on:click={() => (peeking = true)}>盤面を見る</button></div>
  {#if reverseOwner}
    <div class="owner">やめ権: {ownerName ?? `player ${owner}`} [逆なので下家]</div>
  {/if}
  <div class="info">
    <div class="info-row">残り待ち牌: <strong>{waitRemain}</strong> 枚</div>
    <div class="info-row">残り山: <strong>{shanRemain}</strong> 枚</div>
  </div>
  {#if preview}
    <div class="preview">保留: {preview.fanshu !== undefined ? `${preview.fanshu}翻` : '役満'}{preview.defen ? ` ${preview.defen.toLocaleString()}点` : ''} / {(preview.hupai ?? []).map((h) => h.name).join('・')}</div>
  {/if}
  {#if baopai.length}
    <div class="dora" aria-label="ドラ表示牌">{#each baopai as b, i}<span class:fresh={i >= shownBaopai}><Tile pai={b} size="sm" /></span>{/each}</div>
  {/if}
  <div class="actions">
    <button class="primary" on:click={() => onSelect(true)}>使う [アリス発動 + フィーバー終了]</button>
    <button class="secondary" on:click={() => onSelect(false)}>保留 [継続]</button>
  </div>
</Sheet>
{/if}

<style>
  .title { font-weight: bold; margin-bottom: 14px; font-size: 20px; }
  .owner { font-size: 15px; color: #ffe9ad; margin: -6px 0 8px; }
  .info { margin: 10px 0 16px; display: flex; gap: 24px; }
  .info-row { font-size: 17px; }
  .info-row strong { color: #ffd060; font-size: 22px; font-variant-numeric: tabular-nums; }
  .preview { font-size: 14px; color: #ffe9ad; margin: -6px 0 10px; line-height: 1.5; }
  .dora { display: flex; gap: 3px; margin: 0 0 16px; }
  .dora span { border-radius: 3px; }
  .dora .fresh { outline: 2px solid skyblue; outline-offset: 1px; }
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
  .title .peek {
    margin-left: 8px;
    padding: 4px 12px;
    border: 1px solid skyblue;
    border-radius: 4px;
    background: transparent;
    color: #d8f0ff;
    font-size: 14px;
    font-weight: normal;
    cursor: pointer;
    vertical-align: middle;
  }
</style>
