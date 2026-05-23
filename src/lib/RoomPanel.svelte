
<script lang="ts">
  // 部屋画面: ホストが member list + 開始 button、 ゲストは 「待機中」 表示
  // 3 人揃ったら host が start、 status=playing → 親へ通知して game 開始
  import { onMount, onDestroy } from 'svelte';

  const API_BASE = (import.meta as any).env?.VITE_ANMIKA_SERVER ?? '';

  export let roomId: string;
  export let me: { user_id: string; username: string };
  export let onLeave: () => void = () => {};
  export let onStart: () => void = () => {};

  type Member = { seat: number; user_id: string; username: string; avatar_url: string | null };
  type Room = { room_id: string; host_user_id: string; status: string };

  let room: Room | null = null;
  let members: Member[] = [];
  let error: string | null = null;
  let polling: any = null;
  let isHost = false;
  let startedOnce = false;  // polling 連発で onStart 多重呼びを防ぐ [2026-05-13 fix]

  async function refresh() {
    try {
      const r = await fetch(`${API_BASE}/api/rooms/${roomId}`, { credentials: 'include' });
      if (!r.ok) {
        if (r.status === 404) {
          error = '部屋が削除された';
          onLeave();
          return;
        }
        throw new Error('fetch room failed');
      }
      const data = await r.json();
      room = data.room;
      members = data.members;
      isHost = room?.host_user_id === me.user_id;
      if (room?.status === 'playing' && !startedOnce) {
        startedOnce = true;
        onStart();
      }
    } catch (e) {
      error = String(e);
    }
  }

  async function leave() {
    try {
      await fetch(`${API_BASE}/api/rooms/${roomId}/leave`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (e) {}
    onLeave();
  }

  async function start() {
    try {
      const r = await fetch(`${API_BASE}/api/rooms/${roomId}/start`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        error = j.detail || 'start failed';
        return;
      }
      if (!startedOnce) { startedOnce = true; onStart(); }
    } catch (e) {
      error = String(e);
    }
  }

  function shareLink(): string {
    return `${location.origin}/?room=${roomId}`;
  }
  function copyLink() {
    navigator.clipboard?.writeText(shareLink());
  }

  onMount(() => {
    refresh();
    polling = setInterval(refresh, 3000);
  });
  onDestroy(() => {
    if (polling) clearInterval(polling);
  });
</script>

<div class="room">
  <h2>🀄 部屋 {roomId}</h2>
  <p class="hint">招待リンク: <code>{shareLink()}</code> <button class="copy" on:click={copyLink}>📋 copy</button></p>

  <div class="members">
    {#each [0, 1, 2] as seat}
      {@const m = members.find((x) => x.seat === seat)}
      <div class="seat">
        <div class="seat-label">P{seat}</div>
        {#if m}
          {#if m.avatar_url}<img class="avatar" src={m.avatar_url} alt={m.username} />{/if}
          <span class="name">{m.username}</span>
          {#if m.user_id === room?.host_user_id}<span class="host-tag">host</span>{/if}
          {#if m.user_id.startsWith('CPU_')}<span class="cpu-tag">CPU</span>{/if}
        {:else}
          <span class="empty">待機中…</span>
        {/if}
      </div>
    {/each}
  </div>

  <div class="actions">
    {#if isHost}
      <button class="start" on:click={start} disabled={members.length < 3}>
        {members.length < 3 ? `${members.length}/3 人 揃ったら開始可能` : '▶ 開始'}
      </button>
    {:else}
      <span class="waiting">ホストの開始を待機中… [{members.length}/3]</span>
    {/if}
    <button class="leave" on:click={leave}>
      {isHost ? '× 部屋を解散' : '← 退出'}
    </button>
  </div>

  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .room {
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
  .hint { font-size: 12px; opacity: 0.8; }
  .hint code {
    background: rgba(255,255,255,0.1);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
  }
  .copy {
    background: #4060a0;
    color: #fff;
    border: 0;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    margin-left: 4px;
  }
  .members {
    display: flex;
    gap: 12px;
    margin: 18px 0;
    justify-content: space-around;
  }
  .seat {
    flex: 1;
    text-align: center;
    padding: 16px 8px;
    background: rgba(255,255,255,0.05);
    border-radius: 8px;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .seat-label { font-size: 11px; opacity: 0.6; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; }
  .name { font-weight: 700; }
  .host-tag {
    background: #d4af37;
    color: #1a1820;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 700;
  }
  .cpu-tag {
    background: #555;
    color: #fff;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .empty { color: #888; font-style: italic; }
  .actions { display: flex; gap: 12px; justify-content: center; margin-top: 24px; }
  .start {
    background: #44ee77;
    color: #1a1820;
    border: 0;
    padding: 10px 24px;
    border-radius: 6px;
    font-weight: 900;
    font-size: 14px;
    cursor: pointer;
  }
  .start:disabled { opacity: 0.4; cursor: not-allowed; }
  .waiting { color: #aaa; font-size: 13px; line-height: 38px; }
  .leave {
    background: transparent;
    color: #aaa;
    border: 1px solid #555;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
  }
  .error { color: #f88; font-size: 12px; }
</style>
