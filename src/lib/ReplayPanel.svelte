<script lang="ts">
  // [2026-07-23 リョー要望 名牌譜] 試合一覧 → 牌譜再生 [表示専用 fold] + 名局マーク
  import { onDestroy, onMount } from 'svelte';
  import Tile from './Tile.svelte';
  import { foldPaifu, type ReplayRound } from './replay';

  export let onClose: () => void = () => {};

  type MatchRow = {
    match_id: number;
    room_id: string;
    match_no: number;
    finished_at: string;
    starred: number;
    title: string;
    paifu_source: string;
    is_public?: number;
    rule_version?: string;
    members: Array<{ user_id: string; seat: number | null; name: string }>;
  };

  let loading = true;
  let error: string | null = null;
  let matches: MatchRow[] = [];
  let starredOnly = false;
  // [2026-09-14] 名前・タイトル・部屋で絞る。一覧が伸びると目で探せない
  let nameQuery = '';
  // [2026-09-14] 公開牌譜。ログインしていない時は公開ぶんだけ出す
  let publicOnly = false;
  let shareNote = '';

  // viewer state
  let viewing: MatchRow | null = null;
  let rounds: ReplayRound[] = [];
  let roundIdx = 0;
  let stepIdx = 0;
  let autoPlay = false;
  let autoTimer: any = null;
  let showHands = true;
  let titleDraft = '';

  // 絞り込みは取得済みの一覧に対してかける [サーバーへの往復を増やさない]
  $: visibleMatches = (() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return matches;
    return matches.filter((m) => {
      const hay = [
        m.title ?? '',
        m.room_id ?? '',
        ...(m.members ?? []).map((x) => x.name ?? ''),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  })();

  async function loadList() {
    loading = true;
    error = null;
    try {
      const r = await fetch(`/api/matches${starredOnly ? '?starred=1' : ''}`, { credentials: 'include' });
      if (r.status === 401) {
        // 未ログインでも公開ぶんは読める
        publicOnly = true;
        const pr = await fetch('/api/matches/public');
        if (!pr.ok) { error = 'Discord ログインすると全部見れる'; matches = []; return; }
        matches = (await pr.json()).matches ?? [];
        if (matches.length === 0) error = '公開された牌譜はまだない [ログインすると全部見れる]';
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      publicOnly = false;
      matches = (await r.json()).matches ?? [];
    } catch (e: any) {
      error = `読み込み失敗: ${e?.message ?? e}`;
    } finally {
      loading = false;
    }
  }
  onMount(async () => { await loadList(); await openFromUrl(); });
  onDestroy(() => { if (autoTimer) clearInterval(autoTimer); });

  async function openMatch(m: MatchRow) {
    error = null;
    try {
      const r = await fetch(`/api/matches/${m.match_id}/paifu`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      rounds = foldPaifu(data.paifu);
      viewing = m;
      titleDraft = m.title ?? '';
      roundIdx = 0;
      stepIdx = 0;
      stopAuto();
    } catch (e: any) {
      error = `牌譜の読み込み失敗: ${e?.message ?? e}`;
    }
  }

  function stopAuto() {
    autoPlay = false;
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }
  function toggleAuto() {
    if (autoPlay) { stopAuto(); return; }
    autoPlay = true;
    autoTimer = setInterval(() => {
      if (!nextStep()) stopAuto();
    }, 700);
  }
  function nextStep(): boolean {
    const steps = rounds[roundIdx]?.steps ?? [];
    if (stepIdx < steps.length - 1) { stepIdx += 1; return true; }
    if (roundIdx < rounds.length - 1) { roundIdx += 1; stepIdx = 0; return true; }
    return false;
  }
  function prevStep() {
    if (stepIdx > 0) { stepIdx -= 1; return; }
    if (roundIdx > 0) {
      roundIdx -= 1;
      stepIdx = Math.max(0, (rounds[roundIdx]?.steps.length ?? 1) - 1);
    }
  }

  async function saveStar(starred: boolean) {
    if (!viewing) return;
    try {
      const r = await fetch(`/api/matches/${viewing.match_id}/star`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred, title: titleDraft }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      viewing.starred = starred ? 1 : 0;
      viewing.title = titleDraft;
      matches = matches.map((m) => (m.match_id === viewing!.match_id ? { ...m, starred: viewing!.starred, title: viewing!.title } : m));
    } catch (e: any) {
      error = `保存失敗: ${e?.message ?? e}`;
    }
  }

  async function savePublic(isPublic: boolean) {
    if (!viewing) return;
    try {
      const r = await fetch(`/api/matches/${viewing.match_id}/public`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public: isPublic }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      viewing.is_public = isPublic ? 1 : 0;
      viewing = viewing;
      matches = matches.map((m) => (m.match_id === viewing!.match_id ? { ...m, is_public: viewing!.is_public } : m));
    } catch (e: any) {
      error = `公開設定の保存に失敗: ${e?.message ?? e}`;
    }
  }

  /** いま見ている局面の URL をコピーする。開くと同じ局・同じ手数から始まる。 */
  async function copyShareLink() {
    if (!viewing) return;
    const url = new URL(window.location.href);
    url.searchParams.set('replay', String(viewing.match_id));
    url.searchParams.set('round', String(roundIdx));
    url.searchParams.set('step', String(stepIdx));
    const text = url.toString();
    try {
      await navigator.clipboard.writeText(text);
      shareNote = 'この局面の URL をコピーした';
    } catch {
      shareNote = text;
    }
    setTimeout(() => { shareNote = ''; }, 4000);
  }

  // [2026-09-14] ?replay=<id>&round=&step= で局面を直接開く
  async function openFromUrl() {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const id = Number(q.get('replay'));
    if (!Number.isFinite(id) || id <= 0) return;
    const row = matches.find((m) => m.match_id === id)
      ?? ({ match_id: id, room_id: '?', match_no: 0, finished_at: '', starred: 0,
            title: '', paifu_source: '', members: [] } as MatchRow);
    await openMatch(row);
    const r = Number(q.get('round'));
    const st = Number(q.get('step'));
    if (Number.isFinite(r) && r >= 0 && r < rounds.length) roundIdx = r;
    if (Number.isFinite(st) && st >= 0 && st < (rounds[roundIdx]?.steps.length ?? 0)) stepIdx = st;
  }

  $: currentStep = rounds[roundIdx]?.steps[stepIdx] ?? null;
  $: stepCount = rounds[roundIdx]?.steps.length ?? 0;
  const memberName = (m: MatchRow, seat: number): string =>
    m.members.find((x) => x.seat === seat)?.name ?? `P${seat}`;
</script>

<div class="replay-overlay" role="dialog" aria-label="名牌譜">
  <div class="replay-panel">
    <div class="replay-head">
      <h2>📼 牌譜</h2>
      {#if viewing}
        <button class="flat-btn" on:click={() => { viewing = null; stopAuto(); }}>← 一覧へ</button>
      {/if}
      <button class="flat-btn" on:click={onClose}>✕ 閉じる</button>
    </div>

    {#if !viewing}
      <div class="list-meta">
        <label class="toggle"><input type="checkbox" bind:checked={starredOnly} on:change={loadList} /> ⭐ 名牌譜のみ</label>
        <input class="name-search" type="search" placeholder="名前・タイトル・部屋で絞る" bind:value={nameQuery} />
        <button class="flat-btn" on:click={loadList}>↻ 更新</button>
      </div>
      {#if loading}
        <p class="note">読み込み中…</p>
      {:else if error}
        <p class="note">{error}</p>
      {:else if matches.length === 0}
        <p class="note">{starredOnly ? '名牌譜はまだない。再生画面の ⭐ で登録できる' : 'まだ試合記録がない'}</p>
      {:else if visibleMatches.length === 0}
        <p class="note">「{nameQuery}」に当たる試合はない</p>
      {:else}
        <ul class="match-list">
          {#each visibleMatches as m (m.match_id)}
            <li>
              <button class="match-row" on:click={() => openMatch(m)}>
                <span class="m-id">{m.starred ? '⭐' : '・'} 部屋{m.room_id} 第{m.match_no}試合</span>
                <span class="m-title">{m.title || m.members.map((x) => x.name).join(' / ')}</span>
                <span class="m-date">{m.finished_at}{m.paifu_source === 'authority' ? '' : ' [簡易]'}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <div class="viewer">
        <div class="viewer-meta">
          <span>部屋{viewing.room_id} 第{viewing.match_no}試合</span>
          {#if viewing.rule_version}<span class="rule-ver">ルール {viewing.rule_version}</span>{/if}
          <input class="title-input" placeholder="名局タイトル [任意]" bind:value={titleDraft} maxlength="80" />
          {#if viewing.starred}
            <button class="flat-btn" on:click={() => saveStar(false)}>⭐ 解除</button>
            <button class="flat-btn" on:click={() => saveStar(true)}>タイトル保存</button>
          {:else}
            <button class="flat-btn" on:click={() => saveStar(true)}>⭐ 名牌譜に保存</button>
          {/if}
          <!-- [2026-09-14] 公開とリンク共有。既定は非公開 -->
          {#if !publicOnly}
            {#if viewing.is_public}
              <button class="flat-btn" on:click={() => savePublic(false)}>🌐 公開中 [やめる]</button>
            {:else}
              <button class="flat-btn" on:click={() => savePublic(true)}>🔒 非公開 [公開する]</button>
            {/if}
          {/if}
          <button class="flat-btn" on:click={copyShareLink}>🔗 この局面のリンク</button>
          {#if shareNote}<span class="share-note">{shareNote}</span>{/if}
        </div>
        <div class="viewer-controls">
          <select bind:value={roundIdx} on:change={() => { stepIdx = 0; stopAuto(); }}>
            {#each rounds as r, i}
              <option value={i}>{r.label}</option>
            {/each}
          </select>
          <button class="flat-btn" on:click={prevStep}>⏮</button>
          <button class="flat-btn" on:click={toggleAuto}>{autoPlay ? '⏸' : '▶'}</button>
          <button class="flat-btn" on:click={() => nextStep()}>⏭</button>
          <input type="range" min="0" max={Math.max(0, stepCount - 1)} bind:value={stepIdx} on:input={stopAuto} />
          <span class="step-no">{stepIdx + 1}/{stepCount}</span>
          <label class="toggle"><input type="checkbox" bind:checked={showHands} /> 手牌</label>
        </div>
        {#if currentStep}
          <div class="desc-line">{currentStep.desc}</div>
          <div class="boards">
            {#each [0, 1, 2] as seat}
              {@const st = currentStep.seats[seat as 0|1|2]}
              <div class="seat-board">
                <div class="seat-head">
                  <span class="seat-name">{memberName(viewing, seat)}</span>
                  {#if st.riichi !== 'none'}<span class="badge {st.riichi}">{st.riichi === 'fever' ? 'FEVER' : 'リーチ'}</span>{/if}
                  {#if st.nuki > 0}<span class="badge nuki">北×{st.nuki}</span>{/if}
                  {#if st.defen != null}<span class="defen">{st.defen.toLocaleString()}点</span>{/if}
                </div>
                {#if showHands}
                  <div class="tile-row hand">
                    {#each st.hand as t}
                      <Tile pai={t === 'back' ? '' : t} face={t === 'back' ? 'down' : 'up'} size="sm" />
                    {/each}
                    {#each st.melds as m}
                      <span class="meld">{m}</span>
                    {/each}
                  </div>
                {/if}
                <div class="tile-row river">
                  {#each st.river as r}
                    <span class="river-tile" class:riichi-tile={r.riichi}>
                      <Tile pai={r.pai} size="sm" />
                    </span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    {#if viewing && error}<p class="note">{error}</p>{/if}
  </div>
</div>

<style>
  .replay-overlay {
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
  .replay-panel {
    width: min(860px, 100%);
    max-height: min(90vh, 90dvh);
    overflow-y: auto;
    background: linear-gradient(170deg, #17452c, #0d2a1c);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 14px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    padding: 14px 16px 18px;
    box-sizing: border-box;
    color: #eef7ef;
  }
  .replay-head { display: flex; align-items: center; gap: 8px; }
  .replay-head h2 { margin: 4px auto 4px 0; font-size: 1.3rem; color: #ffe9ad; }
  .name-search {
    flex: 1 1 140px;
    min-width: 0;
    padding: 3px 8px;
    border-radius: 5px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: #10201a;
    color: #e8f0ea;
    font-size: 12px;
  }

  .rule-ver {

    font-size: 11px;

    color: #9fb3a6;

    white-space: nowrap;

  }


  .share-note {

    font-size: 11px;

    color: #9fe3b5;

    word-break: break-all;

  }


  .flat-btn {
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    border-radius: 8px;
    padding: 5px 10px;
    cursor: pointer;
    font-size: 0.88rem;
  }
  .list-meta { display: flex; gap: 12px; align-items: center; margin: 8px 0; font-size: 0.85rem; }
  .toggle { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .note { padding: 10px 4px; opacity: 0.9; }
  .match-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .match-row {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: baseline;
    text-align: left;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    padding: 8px 10px;
    color: inherit;
    cursor: pointer;
  }
  .match-row:hover { background: rgba(255, 255, 255, 0.1); }
  .m-id { font-weight: 700; color: #ffe9ad; }
  .m-title { flex: 1; min-width: 120px; }
  .m-date { font-size: 0.75rem; opacity: 0.7; }
  .viewer-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; font-size: 0.9rem; }
  .title-input {
    flex: 1;
    min-width: 140px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: inherit;
    border-radius: 6px;
    padding: 5px 8px;
  }
  .viewer-controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
  .viewer-controls select {
    background: #2a3340;
    color: #fff;
    border: 1px solid #555;
    border-radius: 6px;
    padding: 4px 6px;
  }
  .viewer-controls input[type='range'] { flex: 1; min-width: 120px; }
  .step-no { font-variant-numeric: tabular-nums; font-size: 0.85rem; opacity: 0.85; }
  .desc-line {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    padding: 6px 10px;
    margin-bottom: 8px;
    font-size: 0.95rem;
    color: #ffe9ad;
  }
  .boards { display: flex; flex-direction: column; gap: 10px; }
  .seat-board { border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 6px 8px; background: rgba(255, 255, 255, 0.04); }
  .seat-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }
  .seat-name { font-weight: 700; color: #ffe9ad; }
  .badge { font-size: 0.7rem; border-radius: 999px; padding: 1px 8px; background: #a33; color: #fff; }
  .badge.fever { background: #c60; }
  .badge.nuki { background: #357; }
  .defen { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 0.85rem; }
  .tile-row { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; min-height: 24px; }
  .tile-row.river { opacity: 0.95; }
  .river-tile.riichi-tile { transform: rotate(90deg); margin: 0 6px; }
  .meld {
    font-size: 0.78rem;
    border: 1px solid rgba(255, 224, 128, 0.5);
    border-radius: 4px;
    padding: 1px 6px;
    margin-left: 6px;
    color: #ffe9ad;
  }
  @media (max-width: 480px) {
    .replay-panel { padding: 10px; }
  }
</style>
