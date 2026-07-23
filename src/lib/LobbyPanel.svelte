
<script lang="ts">
  // ロビー画面: Discord login + 部屋一覧 + 部屋作成 [リョー指示 2026-05-13 オンライン対戦 Phase 1]
  import { onMount, onDestroy } from 'svelte';

  // dev mode は同 origin、 production は同 domain で server が proxied
  // env で override 可能
  const API_BASE = (import.meta as any).env?.VITE_ANMIKA_SERVER ?? '';

  type User = { user_id: string; username: string; avatar_url: string | null; chip_total: number; games_played: number };
  type Room = { room_id: string; host_user_id: string; host_name: string; member_count: number; status: string };

  let me: User | null = null;
  let rooms: Room[] = [];
  let loading = true;
  let error: string | null = null;
  let cpuCount = 0; // 0 = 友達 2 人待ち、 1 = 友達 1 人 + CPU 1、 2 = CPU 2
  // [2026-07-23 リョー要望 東風戦設定] tonpu=東風 [東1〜東3+連荘/返り東] / hanchan=半荘
  let matchMode: 'tonpu' | 'hanchan' = 'tonpu';
  export let onJoinRoom: (roomId: string, user: User) => void = () => {};

  async function refreshMe() {
    try {
      const r = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
      if (r.ok) me = await r.json();
      else me = null;
    } catch (e) { me = null; }
  }
  async function refreshRooms() {
    try {
      const r = await fetch(`${API_BASE}/api/rooms`, { credentials: 'include' });
      if (r.ok) rooms = await r.json();
    } catch (e) {
      error = String(e);
    }
  }
  async function createRoom() {
    if (!me) { window.location.href = `${API_BASE}/auth/discord/login`; return; }
    try {
      const r = await fetch(`${API_BASE}/api/rooms`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpu_count: cpuCount, match_mode: matchMode }),
      });
      if (!r.ok) throw new Error('create failed');
      const { room_id } = await r.json();
      if (me) onJoinRoom(room_id, me);
    } catch (e) {
      error = String(e);
    }
  }
  async function joinRoom(roomId: string) {
    if (!me) { window.location.href = `${API_BASE}/auth/discord/login`; return; }
    try {
      const r = await fetch(`${API_BASE}/api/rooms/${roomId}/join`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error('join failed');
      onJoinRoom(roomId, me);
    } catch (e) {
      error = String(e);
    }
  }
  async function logout() {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    me = null;
  }
  // R11 user 報告: 部屋削除 button [host のみ可]
  async function deleteRoom(roomId: string) {
    if (!confirm(`部屋 ${roomId} を削除する？`)) return;
    try {
      const r = await fetch(`${API_BASE}/api/rooms/${roomId}/delete`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
      await refreshRooms();
    } catch (e) {
      error = String(e);
    }
  }
  // R11 user 報告: 24h 以上古い open 部屋 一括 cleanup
  async function cleanupOld() {
    try {
      const r = await fetch(`${API_BASE}/api/rooms/cleanup`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`cleanup failed: ${r.status}`);
      const result = await r.json();
      await refreshRooms();
      error = `${result.deleted_count} 件の古い部屋を削除`;
    } catch (e) {
      error = String(e);
    }
  }

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  onMount(async () => {
    await refreshMe();
    await refreshRooms();
    loading = false;
    // 定期 refresh、 onDestroy で cleanup [2026-05-16 yuma fix: 旧版 leak]
    pollTimer = setInterval(refreshRooms, 5000);
  });
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<div class="lobby">
  <h2>🀄 anmika online</h2>
  {#if loading}
    <p>読み込み中…</p>
  {:else if !me}
    <p>オンライン対戦には Discord ログインが必要</p>
    <a class="login-btn" href="{API_BASE}/auth/discord/login">Discord でログイン</a>
  {:else}
    <div class="user-info">
      {#if me.avatar_url}<img class="avatar" src={me.avatar_url} alt={me.username} />{/if}
      <div>
        <div class="name">{me.username}</div>
        <div class="stats">累計 chip: <strong>{me.chip_total}</strong> / 試合: {me.games_played}</div>
      </div>
      <button class="logout" on:click={logout}>logout</button>
    </div>
    <div class="actions">
      <label class="cpu-select">
        CPU 同席:
        <select bind:value={cpuCount}>
          <option value={0}>0 [友達 2 人 待ち]</option>
          <option value={1}>1 [友達 1 人 + CPU 1]</option>
          <option value={2}>2 [一人 + CPU 2]</option>
        </select>
      </label>
      <label class="cpu-select">
        形式:
        <select bind:value={matchMode}>
          <option value="tonpu">東風戦</option>
          <option value="hanchan">半荘戦</option>
        </select>
      </label>
      <button class="create" on:click={createRoom}>＋ 新しい部屋を作る</button>
    </div>
    <h3>公開中の部屋 <button class="cleanup-btn" on:click={cleanupOld} title="24h 以上古い open 部屋を一括削除">🧹 古い部屋 cleanup</button></h3>
    {#if rooms.length === 0}
      <p class="empty">部屋がない、 上の button で作って招待しよう</p>
    {:else}
      <ul class="room-list">
        {#each rooms as r}
          <li class="room">
            <div>
              <strong>{r.room_id}</strong> [{r.member_count}/3 人]
              <span class="host"> host: {r.host_name}</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button on:click={() => joinRoom(r.room_id)} disabled={r.member_count >= 3}>入る</button>
              {#if me && r.host_user_id === me.user_id}
                <button on:click={() => deleteRoom(r.room_id)} class="del-btn" title="自分の部屋を削除">🗑️</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
  {/if}
</div>

<style>
  .lobby {
    padding: 24px;
    max-width: 720px;
    margin: 24px auto;
    color: #fff;
    font-family: 'Noto Sans JP', sans-serif;
    background: linear-gradient(135deg, #1a2230, #2a2235);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
  h2 { color: #d4af37; }
  .login-btn {
    display: inline-block;
    background: #5865f2;
    color: #fff;
    padding: 10px 18px;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 700;
  }
  .login-btn:hover { background: #4752c4; }
  .user-info {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
    margin: 12px 0;
  }
  .avatar { width: 48px; height: 48px; border-radius: 50%; }
  .name { font-weight: 700; }
  .stats { font-size: 12px; opacity: 0.7; }
  .logout {
    margin-left: auto;
    background: transparent;
    color: #aaa;
    border: 1px solid #555;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .actions { margin: 16px 0; display: flex; align-items: center; gap: 12px; }
  .cpu-select { font-size: 13px; color: #ddd; }
  .cpu-select select { margin-left: 6px; padding: 4px; background: #2a3340; color: #fff; border: 1px solid #555; border-radius: 4px; }
  .create {
    background: #d4af37;
    color: #1a1820;
    border: 0;
    padding: 10px 20px;
    border-radius: 6px;
    font-weight: 700;
    cursor: pointer;
  }
  .room-list {
    list-style: none;
    padding: 0;
  }
  .room {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: rgba(255,255,255,0.04);
    border-radius: 6px;
    margin: 6px 0;
  }
  .host { font-size: 11px; opacity: 0.6; margin-left: 8px; }
  .room button {
    background: #4060a0;
    color: #fff;
    border: 0;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
  }
  .room button[disabled] { opacity: 0.4; cursor: not-allowed; }
  .empty { opacity: 0.6; font-style: italic; }
  .error { color: #f88; font-size: 12px; }
</style>
