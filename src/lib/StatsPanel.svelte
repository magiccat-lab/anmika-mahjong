<script lang="ts">
  // [2026-07-23 リョー要望] 戦績パネル: /api/stats/summary の生カウントから率を出して表示。
  // 率の定義はここに集約 [server は生カウントのみ返す]
  import { onMount } from 'svelte';

  export let onClose: () => void = () => {};

  type PlayerStats = {
    user_id: string;
    name: string;
    games: number;
    incomplete_matches: number;
    rounds: number;
    riichi: number;
    fever_riichi: number;
    furo_rounds: number;
    ankan: number;
    nuki: number;
    wins: number;
    tsumo_wins: number;
    ron_wins: number;
    deal_ins: number;
    points_won: number;
    points_dealt_in: number;
    hule_chips: number;
    chip_delta: number;
    place1: number;
    place2: number;
    place3: number;
    avg_placement: number | null;
  };

  let loading = true;
  let error: string | null = null;
  let players: PlayerStats[] = [];
  let statsSince = '';
  let effectiveSince = '';
  let showCpu = false;
  let showAll = false; // stats_since 設定後に「全期間」も見たい時用

  async function load() {
    loading = true;
    error = null;
    try {
      const q = showAll ? '?since=all' : '';
      const r = await fetch(`/api/stats/summary${q}`, { credentials: 'include' });
      if (r.status === 401) {
        error = 'Discord ログインすると見れる';
        players = [];
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      players = data.players ?? [];
      statsSince = data.stats_since ?? '';
      effectiveSince = data.effective_since ?? '';
    } catch (e: any) {
      error = `読み込み失敗: ${e?.message ?? e}`;
    } finally {
      loading = false;
    }
  }
  onMount(load);

  $: visiblePlayers = players.filter((p) => showCpu || !p.user_id.startsWith('CPU_'));

  const pct = (num: number, den: number): string =>
    den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '-';
  const avg = (num: number, den: number): string =>
    den > 0 ? `${Math.round(num / den).toLocaleString()}` : '-';
  const signed = (v: number): string => (v > 0 ? `+${v}` : `${v}`);
</script>

<div class="stats-overlay" role="dialog" aria-label="戦績">
  <div class="stats-panel">
    <div class="stats-head">
      <h2>📊 戦績</h2>
      <button class="close-btn" on:click={onClose}>✕ 閉じる</button>
    </div>
    <div class="stats-meta">
      {#if effectiveSince}
        <span>集計対象: {effectiveSince} 以降</span>
      {:else}
        <span>集計対象: 全期間</span>
        {#if !statsSince}<span class="caveat">[デバッグ中データ込み。採用開始は後で切替可]</span>{/if}
      {/if}
      <label class="toggle"><input type="checkbox" bind:checked={showCpu} /> CPU込み</label>
      {#if statsSince}
        <label class="toggle"><input type="checkbox" bind:checked={showAll} on:change={load} /> 全期間</label>
      {/if}
      <button class="reload-btn" on:click={load}>↻ 更新</button>
    </div>

    {#if loading}
      <p class="stats-note">読み込み中…</p>
    {:else if error}
      <p class="stats-note">{error}</p>
    {:else if visiblePlayers.length === 0}
      <p class="stats-note">まだ記録がない。オンライン対戦を最後まで打つと試合ごとに貯まる</p>
    {:else}
      <div class="player-cards">
        {#each visiblePlayers as p (p.user_id)}
          <div class="player-card">
            <div class="player-head">
              <span class="player-name">{p.name}</span>
              <span class="player-games">{p.games}戦 {p.rounds}局</span>
              {#if p.incomplete_matches > 0}
                <span class="caveat">[不完全牌譜 {p.incomplete_matches}件]</span>
              {/if}
            </div>
            <div class="stat-grid">
              <div class="cell"><span class="k">トップ率</span><span class="v">{pct(p.place1, p.games)}</span></div>
              <div class="cell"><span class="k">2位率</span><span class="v">{pct(p.place2, p.games)}</span></div>
              <div class="cell"><span class="k">3位率</span><span class="v">{pct(p.place3, p.games)}</span></div>
              <div class="cell"><span class="k">平均順位</span><span class="v">{p.avg_placement != null ? p.avg_placement.toFixed(2) : '-'}</span></div>
              <div class="cell"><span class="k">アガリ率</span><span class="v">{pct(p.wins, p.rounds)}</span></div>
              <div class="cell"><span class="k">放銃率</span><span class="v">{pct(p.deal_ins, p.rounds)}</span></div>
              <div class="cell"><span class="k">リーチ率</span><span class="v">{pct(p.riichi, p.rounds)}</span></div>
              <div class="cell"><span class="k">フーロ率</span><span class="v">{pct(p.furo_rounds, p.rounds)}</span></div>
              <div class="cell"><span class="k">フィーバー率</span><span class="v">{pct(p.fever_riichi, p.rounds)}</span></div>
              <div class="cell"><span class="k">ツモ率</span><span class="v">{pct(p.tsumo_wins, p.wins)}</span></div>
              <div class="cell"><span class="k">平均打点</span><span class="v">{avg(p.points_won, p.wins)}</span></div>
              <div class="cell"><span class="k">平均放銃点</span><span class="v">{avg(p.points_dealt_in, p.deal_ins)}</span></div>
              <div class="cell"><span class="k">チップ収支</span><span class="v" class:plus={p.chip_delta > 0} class:minus={p.chip_delta < 0}>{signed(p.chip_delta)}</span></div>
              <div class="cell"><span class="k">和了祝儀</span><span class="v">{signed(p.hule_chips)}</span></div>
              <div class="cell"><span class="k">北抜き</span><span class="v">{p.nuki}</span></div>
              <div class="cell"><span class="k">暗槓</span><span class="v">{p.ankan}</span></div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .stats-overlay {
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
  .stats-panel {
    width: min(720px, 100%);
    max-height: min(86vh, 86dvh);
    overflow-y: auto;
    background: linear-gradient(170deg, #17452c, #0d2a1c);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 14px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    padding: 14px 16px 18px;
    box-sizing: border-box;
    color: #eef7ef;
  }
  .stats-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .stats-head h2 { margin: 4px 0; font-size: 1.3rem; color: #ffe9ad; }
  .close-btn, .reload-btn {
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    border-radius: 8px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .stats-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    font-size: 0.82rem;
    opacity: 0.92;
    margin: 6px 0 10px;
  }
  .toggle { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .caveat { color: #ffcf7d; }
  .stats-note { padding: 12px 4px; opacity: 0.9; }
  .player-cards { display: flex; flex-direction: column; gap: 12px; }
  .player-card {
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 10px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.05);
  }
  .player-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .player-name { font-weight: 700; font-size: 1.05rem; color: #ffe9ad; }
  .player-games { font-size: 0.82rem; opacity: 0.85; }
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px 10px;
  }
  .cell { display: flex; flex-direction: column; min-width: 0; }
  .cell .k { font-size: 0.7rem; opacity: 0.75; }
  .cell .v { font-size: 0.98rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .cell .v.plus { color: #8fe3a1; }
  .cell .v.minus { color: #ff9d9d; }
  @media (max-width: 480px) {
    .stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .stats-panel { padding: 10px 10px 14px; }
  }
</style>
