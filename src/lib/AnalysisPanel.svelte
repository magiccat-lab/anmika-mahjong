<script lang="ts">
  // [2026-10-14 リョー「まあトップから分析ページに飛べるようにしたい」] 部屋ごとの打牌の分析の一覧。
  // 分析のページ [一致率 ・ 悪手 ・ 全打牌] は秘書が部屋のまとめと一緒に作り、/api/summaries の analysis に載る。開くと別のタブで出す
  import { onMount } from 'svelte';

  export let onClose: () => void = () => {};
  const API_BASE = (import.meta as any).env?.VITE_ANMIKA_SERVER ?? '';

  type Summary = { id: string; room: string; n: number; first: string; last: string; ranking: { name: string; total: number }[]; analysis?: string | null };

  let loading = true;
  let error: string | null = null;
  let rows: Summary[] = [];

  async function load() {
    loading = true;
    error = null;
    try {
      const r = await fetch(`${API_BASE}/api/summaries?limit=30`, { credentials: 'include' });
      if (r.status === 401) {
        error = 'Discord ログインすると見れる';
        rows = [];
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      rows = ((await r.json()).summaries ?? []).filter((s: Summary) => s.analysis);
    } catch (e: any) {
      error = `読み込み失敗: ${e?.message ?? e}`;
    } finally {
      loading = false;
    }
  }
  onMount(load);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div class="analysis-overlay" role="dialog" aria-modal="true" aria-label="分析" tabindex="-1"
  on:click|self={onClose} on:keydown={(e) => { if (e.key === 'Escape') onClose(); }}>
  <div class="analysis-panel">
    <div class="analysis-head">
      <h2>分析</h2>
      <button class="close-btn" on:click={onClose}>閉じる</button>
    </div>
    <p class="analysis-note">部屋ごとに、人の打牌 1 つずつを期待値で見直した物です。一致率 ・ 悪手 ・ 降り率と、悪手の局面が見られます</p>
    {#if loading}
      <p class="analysis-note">読み込み中…</p>
    {:else if error}
      <p class="analysis-note error">{error}</p>
    {:else if rows.length === 0}
      <p class="analysis-note">まだ分析のある部屋がありません</p>
    {:else}
      <ul class="analysis-list">
        {#each rows as sm}
          <li>
            <a class="analysis-row" href={`${API_BASE}${sm.analysis}`} target="_blank" rel="noopener">
              <span class="analysis-room">部屋 {sm.room}</span>
              <span class="analysis-meta">{sm.first}〜{sm.last} ・ 東風 {sm.n} 戦</span>
              <span class="analysis-names">{sm.ranking.map((r) => r.name).join(' ・ ')}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .analysis-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    padding: 12px;
    box-sizing: border-box;
  }
  .analysis-panel {
    width: min(560px, 100%);
    max-height: min(86vh, 86dvh);
    overflow-y: auto;
    background: var(--jz-felt-bg, #174a39);
    border: 1px solid var(--jz-sec-bd, rgba(255, 255, 255, 0.18));
    border-radius: var(--jz-rad, 4px);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    padding: 14px 16px 18px;
    box-sizing: border-box;
    color: var(--jz-ink, #f2eee3);
  }
  .analysis-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .analysis-head h2 { margin: 4px 0; font-size: 1.3rem; color: var(--jz-gold, #e5c26a); }
  .close-btn {
    border: 1px solid var(--jz-sec-bd, rgba(255, 255, 255, 0.25));
    background: var(--jz-sec, rgba(255, 255, 255, 0.08));
    color: inherit;
    border-radius: var(--jz-rad, 4px);
    padding: 6px 12px;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .analysis-note { font-size: 0.85rem; opacity: 0.9; margin: 6px 0 12px; }
  .analysis-note.error { color: #ffcf7d; }
  .analysis-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .analysis-row {
    display: grid;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--jz-sec-bd, rgba(255, 255, 255, 0.22));
    border-radius: var(--jz-rad, 4px);
    background: var(--jz-sec, rgba(255, 255, 255, 0.08));
    color: inherit;
    text-decoration: none;
  }
  .analysis-row:hover { filter: brightness(1.1); }
  .analysis-row:focus-visible { outline: 3px solid var(--jz-gold, #e5c26a); outline-offset: 2px; }
  .analysis-room { font-weight: 700; font-size: 1.05rem; }
  .analysis-meta, .analysis-names { font-size: 0.85rem; opacity: 0.85; }
</style>
