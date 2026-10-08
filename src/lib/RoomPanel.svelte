
<script lang="ts">
  // 部屋画面: ホストが member list + 開始 button、 ゲストは 「待機中」 表示
  // 3 人揃ったら host が start、 status=playing → 親へ通知して game 開始
  import { onMount, onDestroy } from 'svelte';
  import { roomInviteUrl } from './roomLink';

  const API_BASE = (import.meta as any).env?.VITE_ANMIKA_SERVER ?? '';

  export let roomId: string;
  export let me: { user_id: string; username: string };
  export let onLeave: () => void = () => {};
  export let onStart: () => void = () => {};

  type Member = { seat: number; user_id: string; username: string; avatar_url: string | null };
  type Room = { room_id: string; host_user_id: string; status: string; match_mode?: string; rotation_enabled?: number | boolean };

  // [2026-07-24 4人回し Phase6] 定員 = rotation 4 / 通常 3
  $: capacity = room?.rotation_enabled ? 4 : 3;

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
      error = '部屋の情報を取れなかった';
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`${API_BASE}/api/rooms/${roomId}/start`, {
          method: 'POST',
          credentials: 'include',
        });
        if (r.ok) {
          if (!startedOnce) { startedOnce = true; onStart(); }
          return;
        }
        if (r.status === 409) {
          // A retry after an accepted start is idempotent only when the room is
          // actually playing. Archived/finished conflicts must not open a game.
          await refresh();
          if (room?.status !== 'playing') error = `開始できません [status=${room?.status ?? 'unknown'}]`;
          return;
        }
        const j = await r.json().catch(() => ({}));
        error = j.detail || '開始できなかった';
        if (r.status < 500) return;
      } catch (e) {
        error = String(e);
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }

  function shareLink(): string {
    return roomInviteUrl(location.origin, roomId);
  }
  // [2026-10-09 遊真 B3] コピーできたかを見せる。clipboard が無い [http ・ 古い端末] 時は理由を出す
  let copied = false;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyLink() {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(shareLink());
      copied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; copiedTimer = null; }, 1800);
    } catch (e) {
      error = 'コピーできなかった。上のリンクを長押ししてコピーしてほしい';
    }
  }
  // [2026-10-09 遊真 B3] 端末の共有シート [LINE ・ Discord など] が使える時だけ「共有」を出す
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function shareRoom() {
    try {
      await navigator.share({ title: 'アンミカ麻雀', text: `アンミカ麻雀の部屋 ${roomId}`, url: shareLink() });
    } catch (e) { /* 共有シートを閉じた */ }
  }

  onMount(() => {
    refresh();
    polling = setInterval(refresh, 3000);
  });
  onDestroy(() => {
    if (polling) clearInterval(polling);
    if (copiedTimer) clearTimeout(copiedTimer);
  });
</script>

<div class="room">
  <h2>🀄 部屋{room?.match_mode === 'hanchan' ? ' [半荘戦]' : ' [東風戦]'}{room?.rotation_enabled ? ' [4人回し]' : ''}</h2>
  <!-- [2026-10-09 遊真 B3] 部屋コードを大きく出す [口頭 ・ 画面越しでも読める] -->
  <div class="code-block">
    <div class="code-label">部屋コード</div>
    <div class="code" aria-label={`部屋コード ${roomId}`}>{roomId}</div>
  </div>
  <p class="hint">招待リンク: <code>{shareLink()}</code></p>
  <div class="invite-actions">
    <button class="copy" on:click={copyLink}>{copied ? '✓ コピーした' : '📋 コピー'}</button>
    {#if canShare}<button class="copy share" on:click={shareRoom}>📤 共有</button>{/if}
  </div>

  <div class="members">
    {#each Array.from({ length: capacity }, (_, i) => i) as seat (seat)}
      {@const m = members.find((x) => x.seat === seat)}
      <div class="seat">
        <div class="seat-label">席{seat + 1}</div>
        {#if m}
          {#if m.avatar_url}<img class="avatar" src={m.avatar_url} alt={m.username} />{/if}
          <span class="name">{m.username}</span>
          {#if m.user_id === room?.host_user_id}<span class="host-tag">ホスト</span>{/if}
          {#if m.user_id.startsWith('CPU_')}<span class="cpu-tag">CPU</span>{/if}
        {:else}
          <span class="empty">待機中…</span>
        {/if}
      </div>
    {/each}
  </div>

  <div class="actions">
    {#if isHost}
      <button class="start" on:click={start} disabled={members.length < capacity}>
        {members.length < capacity ? `${members.length}/${capacity} 人 揃ったら開始可能` : '▶ 開始'}
      </button>
    {:else}
      <span class="waiting">ホストの開始を待機中… [{members.length}/{capacity}]</span>
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
  .code-block { text-align: center; margin: 8px 0 4px; }
  .code-label { font-size: 12px; opacity: 0.7; }
  .code {
    display: inline-block;
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 44px;
    font-weight: 900;
    letter-spacing: 0.3em;
    padding-left: 0.3em; /* letter-spacing の右端ぶんを左にも足して中央に見せる */
    color: #ffe9ad;
    user-select: all;
  }
  .hint { font-size: 12px; opacity: 0.8; word-break: break-all; }
  .invite-actions { display: flex; gap: 8px; justify-content: center; }
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
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
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
  /* [2026-10-09 遊真 B3] 揃っていない間は緑の押せそうな見た目をやめ、灰色の押せない見た目にする */
  .start:disabled {
    background: #3a3f47;
    color: #8c929c;
    border: 1px solid #555;
    cursor: not-allowed;
  }
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
