
<script lang="ts">
  // 部屋画面: ホストが member list + 開始 button、 ゲストは 「待機中」 表示
  // 3 人揃ったら host が start、 status=playing → 親へ通知して game 開始
  import { onMount, onDestroy } from 'svelte';
  import { roomInviteUrl } from './roomLink';

  const API_BASE = (import.meta as any).env?.VITE_ANMIKA_SERVER ?? '';

  export let roomId: string;
  export let me: { user_id: string; username: string };
  /** reason: ロビーの上に出す知らせ [部屋が解散された時など] */
  export let onLeave: (reason?: string) => void = () => {};
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
          // [2026-10-09 shun2 R4] 待っている間に解散された時は、ロビーの上に誰が解散したかを残す
          // [旧: 「部屋が削除された」を出した直後にロビーへ移り、何が起きたか分からなかった]
          const hostName = members.find((m) => m.user_id === room?.host_user_id)?.username;
          error = '部屋が削除された';
          onLeave(hostName && room?.host_user_id !== me.user_id
            ? `${hostName} が部屋 ${roomId} を解散しました`
            : `部屋 ${roomId} はなくなりました`);
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
  <h2>部屋{room?.match_mode === 'hanchan' ? ' [半荘戦]' : ' [東風戦]'}{room?.rotation_enabled ? ' [4人回し]' : ''}</h2>
  <!-- [2026-10-09 遊真 B3] 部屋コードを大きく出す [口頭 ・ 画面越しでも読める] -->
  <div class="code-block">
    <div class="code-label">部屋コード</div>
    <div class="code" aria-label={`部屋コード ${roomId}`}>{roomId}</div>
  </div>
  <p class="hint">招待リンク: <code>{shareLink()}</code></p>
  <div class="invite-actions">
    <button class="copy" on:click={copyLink}>{copied ? 'コピーした' : 'コピー'}</button>
    {#if canShare}<button class="copy share" on:click={shareRoom}>共有</button>{/if}
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
  /* [2026-10-09 shun2 見た目 b / V3 V8] ロビーと同じ札 ・ 字 ・ ボタン。開始は主ボタン [金]、退出 ・ 解散は副 */
  .room {
    box-sizing: border-box;
    width: min(720px, 100%);
    margin: 24px auto;
    padding: 20px;
    color: var(--jz-ink);
    font-family: var(--sans);
    background: var(--jz-panel);
    border: 1px solid var(--jz-panel-bd);
    border-radius: var(--jz-rad);
    box-shadow: var(--jz-shadow);
  }
  h2 { margin: 0 0 8px; font-size: 20px; font-weight: 700; color: var(--jz-ink); }
  .code-block { text-align: center; margin: 8px 0 4px; }
  .code-label { font-size: 12px; color: var(--jz-sub); margin-bottom: 6px; }
  .code {
    display: inline-block;
    font-family: var(--sans);
    font-variant-numeric: tabular-nums;
    font-size: 44px;
    line-height: 1.15; /* 大きい字が見出しに重ならない様に */
    font-weight: 700;
    letter-spacing: 0.3em;
    padding-left: 0.3em; /* letter-spacing の右端ぶんを左にも足して中央に見せる */
    color: var(--jz-gold);
    user-select: all;
  }
  .hint { font-size: 12px; color: var(--jz-sub); word-break: break-all; }
  .invite-actions { display: flex; gap: 8px; justify-content: center; }
  .hint code {
    background: var(--jz-sec);
    padding: 2px 6px;
    border-radius: var(--jz-rad);
    font-family: var(--mono);
    color: var(--jz-ink);
  }
  button {
    box-sizing: border-box;
    min-height: 44px;
    padding: 0 18px;
    border-radius: var(--jz-rad);
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    border: 1px solid var(--jz-sec-bd);
    background: var(--jz-sec);
    color: var(--jz-ink);
  }
  button:hover:not(:disabled) { filter: brightness(1.08); }
  .members {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 18px 0;
  }
  .seat {
    flex: 1 1 140px;
    text-align: center;
    padding: 14px 8px;
    background: var(--jz-sec);
    border: 1px solid var(--jz-sec-bd);
    border-radius: var(--jz-rad);
    min-height: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .seat-label { font-size: 12px; color: var(--jz-sub); }
  .avatar { width: 40px; height: 40px; border-radius: 50%; }
  .name { font-weight: 700; }
  .host-tag,
  .cpu-tag {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: var(--jz-rad);
    font-weight: 700;
  }
  .host-tag { background: var(--jz-accent); color: var(--jz-on-accent); }
  .cpu-tag { background: transparent; color: var(--jz-ink); box-shadow: inset 0 0 0 1px var(--jz-sub); }
  .empty { color: var(--jz-sub); }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: center; margin-top: 24px; }
  .start {
    min-height: 48px;
    padding: 0 28px;
    font-size: 16px;
    background: var(--jz-accent);
    color: var(--jz-on-accent);
    border-color: transparent;
    box-shadow: var(--jz-shadow);
  }
  /* [2026-10-09 遊真 B3] 揃っていない間は押せない見た目 */
  .start:disabled {
    background: var(--jz-sec);
    color: var(--jz-sub);
    border: 1px solid var(--jz-sec-bd);
    box-shadow: none;
    cursor: not-allowed;
    opacity: 1;
  }
  .waiting { color: var(--jz-sub); font-size: 14px; }
  .leave { background: transparent; }
  .error { color: #ffb4a0; font-size: 13px; }
  @media (max-width: 560px) {
    .room { margin: 0; padding: 16px; border-radius: 0; border-width: 0; min-height: 100dvh; }
    .code { font-size: 36px; }
    .actions { flex-direction: column; align-items: stretch; }
  }
</style>
