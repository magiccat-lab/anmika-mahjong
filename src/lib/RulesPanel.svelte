<script lang="ts">
  // 説明書。`data/notes/anmika_rules.md` をそのまま読ませる。
  // [2026-09-14] ルールが特殊なので、初見が最初に開く場所を画面から出す。
  // md をビルドに焼き込む [?raw]。パーサは入れず、見出し・表・箇条書きだけを軽く整形する。
  import rulesMarkdown from '../../data/notes/anmika_rules.md?raw';

  export let onClose: () => void = () => {};

  let query = '';

  type Block =
    | { kind: 'h'; level: number; text: string }
    | { kind: 'p'; text: string }
    | { kind: 'li'; text: string }
    | { kind: 'table'; rows: string[][] }
    | { kind: 'hr' };

  function parse(md: string): Block[] {
    const out: Block[] = [];
    const lines = md.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { i++; continue; }
      if (/^-{3,}$/.test(trimmed)) { out.push({ kind: 'hr' }); i++; continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (h) { out.push({ kind: 'h', level: h[1].length, text: h[2] }); i++; continue; }
      if (trimmed.startsWith('|')) {
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
          // 罫線行 [|---|---|] は捨てる
          if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
          i++;
        }
        if (rows.length) out.push({ kind: 'table', rows });
        continue;
      }
      const li = /^[-*]\s+(.*)$/.exec(trimmed);
      if (li) { out.push({ kind: 'li', text: li[1] }); i++; continue; }
      out.push({ kind: 'p', text: trimmed });
      i++;
    }
    return out;
  }

  const blocks = parse(rulesMarkdown);

  // 検索は「見出しから次の見出しまで」の塊で絞る
  function matches(b: Block, q: string): boolean {
    if (!q) return true;
    const needle = q.toLowerCase();
    if (b.kind === 'table') return b.rows.some((r) => r.join(' ').toLowerCase().includes(needle));
    if (b.kind === 'hr') return false;
    return b.text.toLowerCase().includes(needle);
  }

  $: shown = query.trim()
    ? blocks.filter((b) => matches(b, query.trim()))
    : blocks;
</script>

<div class="overlay" role="dialog" aria-label="説明書">
  <div class="panel">
    <div class="head">
      <h2>📖 説明書</h2>
      <input class="search" type="search" placeholder="語句で絞る" bind:value={query} />
      <button class="close" on:click={onClose}>閉じる</button>
    </div>
    <p class="lead">
      出典は公式ルールブックと解説書。細かい裁定は
      <code>data/notes/anmika_rules.md</code> が原本です。
    </p>
    <div class="body">
      {#if shown.length === 0}
        <p class="empty">「{query}」に当たるところはありません</p>
      {/if}
      {#each shown as b}
        {#if b.kind === 'hr'}
          <hr />
        {:else if b.kind === 'h'}
          {#if b.level <= 2}
            <h3>{b.text}</h3>
          {:else}
            <h4>{b.text}</h4>
          {/if}
        {:else if b.kind === 'li'}
          <div class="li">・{b.text}</div>
        {:else if b.kind === 'table'}
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  {#each b.rows[0] as cell}<th>{cell}</th>{/each}
                </tr>
              </thead>
              <tbody>
                {#each b.rows.slice(1) as row}
                  <tr>
                    {#each row as cell}<td>{cell}</td>{/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p>{b.text}</p>
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 60; padding: 16px; box-sizing: border-box;
  }
  .panel {
    width: min(820px, 100%); max-height: 88vh; display: flex; flex-direction: column;
    background: #1c2a22; color: #e8f0ea;
    border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 12px;
    padding: 14px 16px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }
  .head { display: flex; align-items: center; gap: 10px; }
  h2 { margin: 0; font-size: 1.1rem; flex: 0 0 auto; }
  .search {
    flex: 1 1 auto; min-width: 0; padding: 6px 10px; border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2); background: #10201a; color: #e8f0ea;
  }
  .close { background: #345; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; flex: 0 0 auto; }
  .lead { margin: 8px 0; font-size: 12px; color: #9fb3a6; }
  .lead code { background: #10201a; padding: 1px 4px; border-radius: 3px; }
  .body { overflow: auto; padding-right: 4px; }
  .empty { color: #9fb3a6; }
  h3 { font-size: 1rem; margin: 14px 0 6px; color: #ffe9ad; border-bottom: 1px solid rgba(255, 233, 173, 0.25); padding-bottom: 3px; }
  h4 { font-size: 0.92rem; margin: 10px 0 4px; color: #cfe3d5; }
  p, .li { margin: 3px 0; font-size: 13px; line-height: 1.55; }
  hr { border: 0; border-top: 1px solid rgba(255, 255, 255, 0.12); margin: 12px 0; }
  .table-wrap { overflow-x: auto; margin: 6px 0 10px; }
  table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
  th, td { border: 1px solid rgba(255, 255, 255, 0.15); padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: rgba(255, 233, 173, 0.12); color: #ffe9ad; white-space: nowrap; }
</style>
