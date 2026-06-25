
<script lang="ts">
  // Server-authoritative オンライン game view [Phase 1 MVP]
  // WS で server から snapshot 受信 → ただ render、 操作 button で action を server に送信
  import { onMount, onDestroy } from 'svelte';
  import Tile from './Tile.svelte';

  export let roomId: string;
  export let me: { user_id: string; username: string };
  export let isHost: boolean;
  export let mySeat: number;
  export let onLeave: () => void = () => {};

  const WS_BASE = (import.meta as any).env?.VITE_ANMIKA_WS ?? '';

  let ws: WebSocket | null = null;
  let connected = false;
  let snapshot: any = null;
  let lobbyMembers: any[] = [];
  let logs: string[] = [];
  let error: string | null = null;

  function log(msg: string) {
    logs = [...logs, `[${new Date().toLocaleTimeString()}] ${msg}`].slice(-30);
  }

  async function fetchWsToken(): Promise<string> {
    // [Phase B1] server から短期 JWT を取得して WS handshake に渡す。
    // uid / seat / is_host は server が DB から決定するので client は room_id を渡すだけ。
    const r = await fetch('/api/ws-token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new Error(`ws-token ${r.status}: ${detail}`);
    }
    const data = (await r.json()) as { token: string };
    return data.token;
  }

  async function buildUrl(): Promise<string> {
    const base = WS_BASE || (location.protocol === 'https:' ? `wss://${location.host}` : `ws://${location.host}`);
    const token = await fetchWsToken();
    const params = new URLSearchParams({ token });
    return `${base}/ws/room/${roomId}?${params.toString()}`;
  }

  async function connect() {
    if (ws) return;
    let url: string;
    try {
      url = await buildUrl();
    } catch (e: any) {
      error = `ws-token failed: ${e?.message ?? e}`;
      log(error);
      return;
    }
    log(`connecting ${url.replace(/token=[^&]+/, 'token=***')}`);
    ws = new WebSocket(url);
    ws.addEventListener('open', () => { connected = true; log('connected'); });
    ws.addEventListener('close', (e) => { connected = false; log(`closed code=${e.code}`); ws = null; });
    ws.addEventListener('error', () => { error = 'WebSocket error'; });
    ws.addEventListener('message', (e) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.type === 'snapshot') {
        snapshot = msg;
        log(`snapshot received [paishu=${msg.state?.paishu ?? '?'}]`);
      } else if (msg.type === 'lobby') {
        lobbyMembers = msg.members ?? [];
      } else if (msg.type === 'presence') {
        log(`presence: ${msg.user_id} ${msg.event}`);
      } else if (msg.type === 'error') {
        error = msg.message;
        log(`error: ${msg.message}`);
      }
    });
  }

  function sendStart() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'start' }));
  }
  function sendAction(action: any) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'action', action }));
  }

  function tilesFromBingpai(bingpai: any): string[] {
    const tiles: string[] = [];
    for (const s of ['m', 'p', 's', 'z']) {
      const arr = bingpai?.[s] ?? [];
      for (let n = 0; n < arr.length; n++) {
        for (let k = 0; k < (arr[n] ?? 0); k++) tiles.push(`${s}${n}`);
      }
    }
    return tiles;
  }

  onMount(connect);
  onDestroy(() => { try { ws?.close(); } catch (e) {} });

  $: state = snapshot?.state;
  $: members = snapshot?.members ?? lobbyMembers;
  $: myHand = state?.shoupais?.[mySeat]?.bingpai ? tilesFromBingpai(state.shoupais[mySeat].bingpai) : [];
  $: myZimo = state?.shoupais?.[mySeat]?.zimo ?? null;
  $: currentSeat = state ? (((state.qijia ?? 0) - state.lunban) % 3 + 3) % 3 : 0;
  $: isMyTurn = currentSeat === mySeat;
</script>

<div class="online-game">
  <header>
    <h2>🀄 部屋 {roomId} [online]</h2>
    <span class="me-info">{me.username} [seat {mySeat}]</span>
    <span class="conn" class:ok={connected}>{connected ? '🟢' : '🔴'}</span>
    <button on:click={onLeave}>退出</button>
  </header>

  {#if !snapshot}
    <div class="lobby">
      <h3>待機中 [{members.length}/3]</h3>
      <ul>
        {#each members as m}
          <li>seat {m.seat}: {m.username} {m.is_cpu ? '[CPU]' : ''}</li>
        {/each}
      </ul>
      {#if isHost && members.length >= 3}
        <button class="start-btn" on:click={sendStart}>▶ 開始</button>
      {:else if isHost}
        <p>3 人揃ったら 開始</p>
      {:else}
        <p>ホストの開始を待ってる</p>
      {/if}
    </div>
  {:else}
    <div class="game">
      <div class="info">
        場:{['東','南','西','北'][state.changbang ?? 0]} {state.jushu + 1}局 / {state.benbang}本場 / 山:{state.paishu}
      </div>
      <div class="other-hands">
        {#each [0, 1, 2] as s}
          {#if s !== mySeat}
            <div class="other">
              P{s} [{members.find((m: any) => m.seat === s)?.username ?? '?'}]:
              手 {state.shoupais[s]?.count ?? 0} 枚
              {state.shoupais[s]?.has_zimo ? '+ ツモ' : ''}
            </div>
          {/if}
        {/each}
      </div>
      <div class="he-rows">
        {#each [0, 1, 2] as s}
          <div class="he-row">
            P{s} 河:
            {#each (state.he?.[s] ?? []) as t}
              <Tile pai={t.replace(/[_-]$/, '')} size="sm" />
            {/each}
          </div>
        {/each}
      </div>
      <div class="dora">
        ドラ表:
        {#each (state.baopai ?? []).filter((t: string) => !t.startsWith('f')) as t}
          <Tile pai={t} size="sm" />
        {/each}
      </div>
      <div class="my-hand">
        <div class="my-hand-label">あなたの手 [seat {mySeat}]{isMyTurn ? ' ← あなたの番' : ''}</div>
        <div class="my-hand-tiles">
          {#each myHand as t}
            <button class="hand-tile" disabled={!isMyTurn} on:click={() => sendAction({ type: 'discard', pai: t })}>
              <Tile pai={t} size="md" />
            </button>
          {/each}
          {#if myZimo}
            <span class="zimo-sep">|</span>
            <button class="hand-tile zimo" disabled={!isMyTurn} on:click={() => sendAction({ type: 'discard', pai: myZimo })}>
              <Tile pai={myZimo} size="md" />
            </button>
          {/if}
        </div>
        <div class="action-buttons">
          {#if isMyTurn}
            <button on:click={() => sendAction({ type: 'tsumo' })}>ツモ</button>
            <button on:click={() => sendAction({ type: 'lizhi' })}>立直</button>
            <button on:click={() => sendAction({ type: 'nuki' })}>北抜き</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
  <details class="log-pane">
    <summary>log [{logs.length}]</summary>
    <pre>{logs.join('\n')}</pre>
  </details>
</div>

<style>
  .online-game {
    color: #fff;
    font-family: 'Noto Sans JP', sans-serif;
    padding: 16px;
    max-width: 960px;
    margin: 0 auto;
    background: linear-gradient(135deg, #1a2230, #2a2235);
    min-height: 80vh;
  }
  header {
    display: flex; align-items: center; gap: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #444;
  }
  h2 { color: #d4af37; margin: 0; }
  .me-info { font-size: 13px; opacity: 0.8; }
  .conn { font-size: 14px; }
  .conn.ok { filter: drop-shadow(0 0 4px #44ee77); }
  .lobby { margin: 24px 0; text-align: center; }
  .lobby ul { list-style: none; padding: 0; }
  .start-btn {
    background: #44ee77; color: #1a1820; border: 0;
    padding: 10px 24px; border-radius: 6px;
    font-weight: 900; font-size: 14px; cursor: pointer;
    margin-top: 16px;
  }
  .info {
    font-size: 13px; opacity: 0.8; padding: 8px;
    background: rgba(255,255,255,0.05); border-radius: 4px; margin-bottom: 12px;
  }
  .other-hands {
    display: flex; gap: 18px; margin: 8px 0;
    padding: 8px; background: rgba(255,255,255,0.04); border-radius: 6px;
  }
  .other { font-size: 12px; }
  .he-rows { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
  .he-row { font-size: 11px; min-height: 30px; }
  .dora { margin: 10px 0; font-size: 12px; }
  .my-hand { margin-top: 14px; padding: 12px; background: rgba(212,175,55,0.08); border-radius: 8px; }
  .my-hand-label { font-size: 12px; color: #d4af37; margin-bottom: 6px; }
  .my-hand-tiles { display: flex; gap: 2px; flex-wrap: wrap; align-items: center; }
  .hand-tile {
    background: transparent; border: 0; padding: 0; cursor: pointer;
  }
  .hand-tile[disabled] { cursor: not-allowed; opacity: 0.5; }
  .zimo-sep { color: #888; font-size: 20px; margin: 0 4px; }
  .hand-tile.zimo > :global(*) { box-shadow: 0 0 8px rgba(212,175,55,0.6); }
  .action-buttons { margin-top: 10px; display: flex; gap: 6px; }
  .action-buttons button {
    background: #4060a0; color: #fff; border: 0;
    padding: 6px 12px; border-radius: 4px; cursor: pointer;
    font-size: 13px;
  }
  .error { color: #f88; font-size: 12px; }
  .log-pane { margin-top: 16px; }
  .log-pane summary { cursor: pointer; font-size: 11px; opacity: 0.7; }
  .log-pane pre {
    font-size: 11px;
    background: rgba(0,0,0,0.4);
    padding: 8px; max-height: 200px; overflow: auto;
  }
</style>
