
<script lang="ts">
  // ロビー画面: Discord login + 部屋一覧 + 部屋作成 [リョー指示 2026-05-13 オンライン対戦 Phase 1]
  import { onMount, onDestroy } from 'svelte';
  import { discordLoginUrl } from './roomLink';

  // dev mode は同 origin、 production は同 domain で server が proxied
  // env で override 可能
  const API_BASE = (import.meta as any).env?.VITE_ANMIKA_SERVER ?? '';

  type User = { user_id: string; username: string; avatar_url: string | null; chip_total: number; games_played: number };
  // [2026-10-09 遊真 B3] my_seat = その部屋での自分の席 [部屋の席番号。座っていなければ null]
  type Room = { room_id: string; host_user_id: string; host_name: string; member_count: number; status: string; match_mode?: string; rotation_enabled?: number | boolean; my_seat?: number | null };

  let me: User | null = null;
  let rooms: Room[] = [];
  let loading = true;
  let error: string | null = null;
  let cpuCount = 0; // 0 = 友達 2 人待ち、 1 = 友達 1 人 + CPU 1、 2 = CPU 2
  // [2026-07-23 リョー要望 東風戦設定] tonpu=東風 [東1〜東3+連荘/返り東] / hanchan=半荘
  let matchMode: 'tonpu' | 'hanchan' = 'tonpu';
  // [2026-07-24 4人回し Phase6] 部屋定員4、試合ごとに順番で抜け番 [抜け番はサイコロだけ参加]
  let rotationEnabled = false;
  export let onJoinRoom: (roomId: string, user: User) => void = () => {};
  // [2026-07-23 リョー要望 観戦モード] 部屋を閲覧専用で見る
  export let onSpectateRoom: (roomId: string, user: User) => void = () => {};
  // [2026-10-09 遊真 B2] 招待リンクから入れなかった理由など、ロビーの上に出す知らせ
  export let notice: string | null = null;

  // [2026-10-09 遊真 B1] ログイン後に今のページ [招待リンクの ?room= ごと] へ戻す
  function loginHref(): string {
    return typeof window === 'undefined'
      ? `${API_BASE}/auth/discord/login`
      : discordLoginUrl(API_BASE, window.location);
  }
  function goLogin(): void {
    window.location.href = loginHref();
  }

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
    if (!me) { goLogin(); return; }
    try {
      const r = await fetch(`${API_BASE}/api/rooms`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpu_count: cpuCount, match_mode: matchMode, rotation: rotationEnabled }),
      });
      if (!r.ok) throw new Error('create failed');
      const { room_id } = await r.json();
      if (me) onJoinRoom(room_id, me);
    } catch (e) {
      error = '部屋を作れなかった。もう一度試してほしい';
    }
  }
  async function joinRoom(roomId: string) {
    if (!me) { goLogin(); return; }
    try {
      const r = await fetch(`${API_BASE}/api/rooms/${roomId}/join`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error('join failed');
      onJoinRoom(roomId, me);
    } catch (e) {
      error = `部屋 ${roomId} に入れなかった [満席か、もう始まっている]`;
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
      error = `部屋 ${roomId} を削除できなかった`;
    }
  }
  // R11 user 報告: 24h 以上古い空き部屋の一括片付け [遊んでいる部屋は消さない]
  async function cleanupOld() {
    try {
      const r = await fetch(`${API_BASE}/api/rooms/cleanup`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`cleanup failed: ${r.status}`);
      const result = await r.json();
      await refreshRooms();
      error = `${result.deleted_count} 件の古い部屋を片付けた`;
    } catch (e) {
      error = '古い部屋を片付けられなかった';
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
  <h2>🀄 アンミカ麻雀 オンライン</h2>
  {#if loading}
    <p>読み込み中…</p>
  {:else if !me}
    {#if notice}<p class="notice">{notice}</p>{/if}
    <p>オンライン対戦には Discord ログインが必要</p>
    <a class="login-btn" href={loginHref()}>Discord でログイン</a>
  {:else}
    {#if notice}<p class="notice">{notice}</p>{/if}
    <div class="user-info">
      {#if me.avatar_url}<img class="avatar" src={me.avatar_url} alt={me.username} />{/if}
      <div>
        <div class="name">{me.username}</div>
        <div class="stats">累計チップ: <strong>{me.chip_total}</strong> / 試合: {me.games_played}</div>
      </div>
      <button class="logout" on:click={logout}>ログアウト</button>
    </div>
    <div class="actions">
      <label class="cpu-select">
        CPU 同席:
        <select class="sel-cpu-count" bind:value={cpuCount}>
          <option value={0}>0 [友達 2 人 待ち]</option>
          <option value={1}>1 [友達 1 人 + CPU 1]</option>
          <option value={2}>2 [一人 + CPU 2]</option>
        </select>
      </label>
      <label class="cpu-select">
        形式:
        <select class="sel-match-mode" bind:value={matchMode}>
          <option value="tonpu">東風戦</option>
          <option value="hanchan">半荘戦</option>
        </select>
      </label>
      <!-- [2026-07-24 4人回し Phase6] 定員4で試合ごとに抜け番が回る。抜け番はサイコロ精算だけ参加 -->
      <label class="cpu-select" title="部屋に4人。試合ごとに1人が抜け番になり、サイコロ精算だけ参加する">
        <input class="chk-rotation" type="checkbox" bind:checked={rotationEnabled} /> 4人回し
      </label>
      <button class="create" on:click={createRoom}>＋ 新しい部屋を作る</button>
    </div>
    <h3>公開中の部屋 <button class="cleanup-btn" on:click={cleanupOld} title="24 時間たった空き部屋を片付ける">🧹 古い部屋を片付け</button></h3>
    {#if rooms.length === 0}
      <p class="empty">部屋がない、 上の「新しい部屋を作る」で作って招待しよう</p>
    {:else}
      <ul class="room-list">
        {#each rooms as r}
          <li class="room">
            <div>
              <strong>{r.room_id}</strong> [{r.member_count}/{r.rotation_enabled ? 4 : 3} 人]{r.match_mode === 'hanchan' ? ' 半荘' : ' 東風'}{r.rotation_enabled ? ' 4人回し' : ''}{r.status === 'playing' ? ' ▶対局中' : ''}
              <span class="host"> ホスト: {r.host_name}</span>
              {#if r.my_seat !== null && r.my_seat !== undefined}<span class="mine"> あなたは席{r.my_seat + 1}</span>{/if}
            </div>
            <div style="display:flex; gap:6px;">
              <!-- [2026-10-09 遊真 B2] 自分が座っている部屋は「戻る」。招待リンクと同じ道 [join は既存 member なら
                   対局中でも冪等に成功 → 部屋画面 → 対局中なら盤面を復元] で入り直す -->
              {#if r.my_seat !== null && r.my_seat !== undefined}
                <button class="rejoin-btn" on:click={() => joinRoom(r.room_id)}>戻る</button>
              {:else if r.status === 'open'}
                <button on:click={() => joinRoom(r.room_id)} disabled={r.member_count >= (r.rotation_enabled ? 4 : 3)}>入る</button>
              {/if}
              <!-- [2026-07-23 観戦モード] 対局中の部屋は閲覧専用で覗ける -->
              <button on:click={() => { if (!me) { goLogin(); return; } onSpectateRoom(r.room_id, me); }} title="閲覧専用で見る">👁 観戦</button>
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
  .mine { font-size: 11px; color: #ffd060; margin-left: 8px; }
  .room button.rejoin-btn { background: #d4af37; color: #1a1820; font-weight: 700; }
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
  .notice { color: #ffd060; font-size: 13px; }
</style>
