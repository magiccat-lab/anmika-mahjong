
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
  <h2>アンミカ麻雀 オンライン</h2>
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
    <h3>公開中の部屋 <button class="cleanup-btn" on:click={cleanupOld} title="24 時間たった空き部屋を片付ける">古い空き部屋を片付ける</button></h3>
    {#if rooms.length === 0}
      <p class="empty">部屋がない、 上の「新しい部屋を作る」で作って招待しよう</p>
    {:else}
      <ul class="room-list">
        {#each rooms as r}
          <li class="room">
            <div class="room-info">
              <strong>{r.room_id}</strong> [{r.member_count}/{r.rotation_enabled ? 4 : 3} 人]{r.match_mode === 'hanchan' ? ' 半荘' : ' 東風'}{r.rotation_enabled ? ' 4人回し' : ''}{r.status === 'playing' ? ' ▶対局中' : ''}
              <span class="host"> ホスト: {r.host_name}</span>
              {#if r.my_seat !== null && r.my_seat !== undefined}<span class="mine"> あなたは席{r.my_seat + 1}</span>{/if}
            </div>
            <div class="room-btns">
              <!-- [2026-10-09 遊真 B2] 自分が座っている部屋は「戻る」。招待リンクと同じ道 [join は既存 member なら
                   対局中でも冪等に成功 → 部屋画面 → 対局中なら盤面を復元] で入り直す -->
              {#if r.my_seat !== null && r.my_seat !== undefined}
                <button class="rejoin-btn" on:click={() => joinRoom(r.room_id)}>戻る</button>
              {:else if r.status === 'open'}
                <button class="join-btn" on:click={() => joinRoom(r.room_id)} disabled={r.member_count >= (r.rotation_enabled ? 4 : 3)}>入る</button>
              {/if}
              <!-- [2026-07-23 観戦モード] 対局中の部屋は閲覧専用で覗ける -->
              <button on:click={() => { if (!me) { goLogin(); return; } onSpectateRoom(r.room_id, me); }} title="閲覧専用で見る">観戦</button>
              {#if me && r.host_user_id === me.user_id}
                <button on:click={() => deleteRoom(r.room_id)} class="del-btn" title="自分の部屋を削除">削除</button>
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
  /* [2026-10-09 shun2 見た目 b / V3 V8] 卓と同じ札 ・ 字 ・ ボタン。スマホ縦は設定を縦に積み、
     作るボタンは横いっぱいの 1 行 [旧: 「新しい部屋を作る」「入る」が 1 字ずつ縦に崩れていた] */
  .lobby {
    box-sizing: border-box;
    width: min(720px, 100%);
    margin: 24px auto;
    padding: 20px;
    color: var(--jz-ink);
    font-family: var(--sans);
    text-align: left;
    background: var(--jz-panel);
    border: 1px solid var(--jz-panel-bd);
    border-radius: var(--jz-rad);
    box-shadow: var(--jz-shadow);
  }
  h2 { margin: 0 0 12px; font-size: 22px; font-weight: 700; color: var(--jz-ink); }
  h3 { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 20px 0 8px; font-size: 16px; font-weight: 700; color: var(--jz-ink); }
  button, .login-btn {
    box-sizing: border-box;
    min-height: 44px;
    padding: 0 16px;
    border-radius: var(--jz-rad);
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    border: 1px solid var(--jz-sec-bd);
    background: var(--jz-sec);
    color: var(--jz-ink);
  }
  .login-btn {
    display: inline-flex;
    align-items: center;
    background: #5865f2;
    border-color: transparent;
    color: #fff;
    text-decoration: none;
  }
  .login-btn:hover { background: #4752c4; }
  button:hover:not([disabled]) { filter: brightness(1.08); }
  .user-info {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--jz-sec);
    border-radius: var(--jz-rad);
    margin: 12px 0;
  }
  .avatar { width: 44px; height: 44px; border-radius: 50%; }
  .name { font-weight: 700; font-size: 16px; }
  .stats { font-size: 12px; color: var(--jz-sub); font-variant-numeric: tabular-nums; }
  .logout { margin-left: auto; min-height: 36px; font-size: 13px; background: transparent; }
  .actions { margin: 16px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
  .cpu-select { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: var(--jz-sub); white-space: nowrap; min-height: 44px; }
  .cpu-select select {
    min-height: 40px;
    padding: 0 8px;
    font-size: 14px;
    background: var(--jz-panel-solid);
    color: var(--jz-ink);
    border: 1px solid var(--jz-sec-bd);
    border-radius: var(--jz-rad);
  }
  .cpu-select input[type='checkbox'] { width: 20px; height: 20px; accent-color: var(--jz-accent-flat); }
  .create {
    background: var(--jz-accent);
    color: var(--jz-on-accent);
    border-color: transparent;
    box-shadow: var(--jz-shadow);
    min-height: 48px;
    padding: 0 22px;
    font-size: 16px;
  }
  .cleanup-btn { min-height: 36px; font-size: 13px; font-weight: 500; color: var(--jz-sub); background: transparent; }
  .room-list { list-style: none; padding: 0; margin: 0; }
  .room {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px 12px;
    padding: 10px 12px;
    background: var(--jz-sec);
    border: 1px solid var(--jz-sec-bd);
    border-radius: var(--jz-rad);
    margin: 8px 0;
    font-size: 14px;
  }
  .room-info { min-width: 0; flex: 1 1 220px; }
  .room-btns { display: flex; flex-wrap: wrap; gap: 6px; }
  .host { font-size: 12px; color: var(--jz-sub); margin-left: 8px; }
  .mine { font-size: 12px; color: var(--jz-gold); margin-left: 8px; }
  .room button.rejoin-btn,
  .room button.join-btn { background: var(--jz-accent); color: var(--jz-on-accent); border-color: transparent; }
  .room button.del-btn { background: transparent; }
  .room button[disabled] { opacity: 0.4; cursor: not-allowed; }
  .empty { color: var(--jz-sub); font-size: 14px; }
  .error { color: #ffb4a0; font-size: 13px; }
  .notice {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: var(--jz-rad);
    background: #f4e3b0;
    color: #2a1a04;
    font-size: 14px;
    font-weight: 700;
  }
  @media (max-width: 560px) {
    .lobby { margin: 0; padding: 16px; border-radius: 0; border-width: 0; min-height: 100dvh; }
    .actions { flex-direction: column; align-items: stretch; }
    .cpu-select { justify-content: space-between; }
    .cpu-select:has(input[type='checkbox']) { justify-content: flex-start; gap: 10px; }
    .cpu-select select { flex: 1 1 auto; max-width: 62%; }
    .create { width: 100%; }
    .room-btns { width: 100%; }
    .room-btns button { flex: 1 1 0; }
  }
</style>
