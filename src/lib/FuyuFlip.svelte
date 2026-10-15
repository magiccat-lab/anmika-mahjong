<script lang="ts">
  // [2026-10-15 リョー「冬冬金北の時だけ自分で1つづつ捲る演出とかつけられる？」→ ラフ 3 通りから 3 (1 枚ずつ + ラストチャンス) に ○]
  // 冬冬金北の冬めくりを、伏せた牌を自分で 1 枚ずつ押してめくる形で見せる。
  // めくる牌と当たりは和了の時に決まっている (huleChip の fuyuLog)。ここは見せ方だけで、祝儀は変えない。
  // 伏せて置くのは次の組だけなので、何組続くかは最後までわからない。上段が外れたら「ラストチャンス」で下段を赤く光らせる。
  // 下に自分の牌を並べ、当たった牌 (冬冬なので隣の牌も) から金に光らせる。
  // 動かし方: 自分の和了は押してめくる (放っておくと IDLE_MS で自動に切り替える)。CPU の和了は auto。
  // オンラインで他の人の和了は remote: 和了った人の画面から届いた枚数 (remoteOpened) まで返す。届かなくなったら自動で続ける
  import { createEventDispatcher, onDestroy } from 'svelte';
  import Tile from './Tile.svelte';
  import { playSound } from './prefs';
  import { tulipNeighbors } from './game3/tulip';

  export let log: Array<{ pai: string; tier: 'upper' | 'lower'; hit: number }> = [];
  /** 当たりを数える自分の牌 (手牌 ・ 抜き北 ・ 華) */
  export let hand: string[] = [];
  /** 自分以外の和了なら名前を出す */
  export let name = '';
  /** CPU の和了は自動でめくる */
  export let auto = false;
  /** オンラインで他の人の和了。remoteOpened まで返す */
  export let remote = false;
  export let remoteOpened = 0;

  const AUTO_MS = 650;
  /** 自分の和了で押さないまま、この間が過ぎたら自動に切り替える */
  const IDLE_MS = 10_000;
  /** 他の人の和了で中継がこの間届かなければ自動で続ける (和了った人が抜けた時など) */
  const REMOTE_STALL_MS = 6_000;
  /** CPU ・ 他の人の和了は、めくり終わってこの間で閉じる */
  const CLOSE_MS = 3_000;

  const dispatch = createEventDispatcher<{ flip: { opened: number }; done: { hits: number } }>();

  type Entry = { pai: string; tier: 'upper' | 'lower'; hit: number };
  // 組に分ける (金北なので上下 2 枚ずつ。最後は山の残りで 1 枚の事もある)
  $: pairs = (() => {
    const out: Entry[][] = [];
    for (const e of log) {
      if (e.tier === 'upper' || out.length === 0) out.push([e]);
      else out[out.length - 1].push(e);
    }
    return out;
  })();
  $: total = log.length;

  let opened = 0;
  let ended = false;
  let autoNow = auto;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  $: hits = log.slice(0, opened).reduce((a, e) => a + e.hit, 0);
  $: pairIndex = pairOf(opened);
  $: curPair = pairs[pairIndex] ?? [];
  $: firstOfCur = pairs.slice(0, pairIndex).reduce((a, p) => a + p.length, 0);
  $: inPair = opened - firstOfCur;
  $: lastChance = !ended && inPair === 1 && curPair.length === 2 && curPair[0].hit === 0;
  $: canTap = !ended && !autoNow && !remote;

  function pairOf(n: number): number {
    let acc = 0;
    for (let i = 0; i < pairs.length; i += 1) {
      acc += pairs[i].length;
      if (n < acc) return i;
    }
    return pairs.length;
  }

  // 試験 (Playwright) は録画に音が入らないので、鳴らした音と時刻を window.__seLog に残す (PochiSqueeze と同じ)
  function snd(path: string, vol: number): void {
    playSound(path, vol);
    if (typeof navigator !== 'undefined' && (navigator as any).webdriver) ((window as any).__seLog ??= []).push({ path, vol, at: Date.now() });
  }
  const se = (n: string, v = 0.6) => snd(`/sounds/fx/${n}.mp3`, v);

  function norm(p: string): string {
    if (/^f[1-4]$/.test(p)) return p;
    if (p.startsWith('z5')) return 'z5';
    if (p === 'gN') return 'z4';
    if (p === 'gp' || p === 'gs') return `${p[1]}5`;
    return p[1] === '0' ? `${p[0]}5` : p.slice(0, 2);
  }
  $: litHand = (() => {
    const set = new Set<string>();
    for (const e of log.slice(0, opened)) {
      if (e.hit <= 0) continue;
      const n = norm(e.pai);
      if (/^f/.test(n)) { set.add('hua'); continue; }
      set.add(n);
      for (const t of tulipNeighbors(n)) set.add(t);
    }
    return set;
  })();

  function openOne(fromTap = false): void {
    if (ended || opened >= total) return;
    const e = log[opened];
    opened += 1;
    se(e.hit > 0 ? 'kira' : 'push', e.hit > 0 ? 0.7 : 0.5);
    if (!remote) dispatch('flip', { opened });
    const pi = pairOf(opened - 1);
    const p = pairs[pi];
    const start = pairs.slice(0, pi).reduce((a, x) => a + x.length, 0);
    if ((opened - start >= p.length && p.every((x) => x.hit === 0)) || opened >= total) finish();
    else if (opened - start === 1 && p.length === 2 && p[0].hit === 0) se('kyuin', 0.6);
    if (fromTap) armIdle();
  }
  function finish(): void {
    ended = true;
    clearTimers();
    setTimeout(() => se(hits > 0 ? 'don' : 'hazure', 0.7), 250);
    // 見ているだけの画面 (CPU ・ 他の人の和了) は合計を見せてから自分で閉じる。自分の和了は OK を押すまで残す
    if (auto || remote) timer = setTimeout(close, CLOSE_MS);
  }
  function tap(): void {
    if (!canTap) return;
    openOne(true);
  }
  function openAll(): void {
    if (ended || remote) return;
    clearTimers();
    opened = total;
    dispatch('flip', { opened });
    ended = true;
    se('don', 0.7);
  }
  function close(): void {
    clearTimers();
    dispatch('done', { hits });
  }
  function clearTimers(): void {
    if (timer) { clearTimeout(timer); timer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }
  function autoStep(): void {
    timer = null;
    if (ended) return;
    openOne();
    if (!ended) timer = setTimeout(autoStep, AUTO_MS);
  }
  function startAuto(delay = AUTO_MS): void {
    autoNow = true;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (!timer && !ended) timer = setTimeout(autoStep, delay);
  }
  function armIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => startAuto(0), remote ? REMOTE_STALL_MS : IDLE_MS);
  }
  // 他の人の和了: 届いた枚数まで 1 枚ずつ返す。届くたびに止まった時の保険を掛け直す
  $: if (remote && !autoNow) catchUp(remoteOpened);
  function catchUp(target: number): void {
    const to = Math.min(total, Math.max(0, Math.floor(target)));
    if (to <= opened || ended) return;
    if (to - opened > 1) {
      // まとめてめくった (または取り逃した) 分は一度に返す
      while (opened < to - 1 && !ended) opened += 1;
    }
    openOne();
    if (!ended) armIdle();
  }

  // 出た時: CPU はすぐ自動、自分の和了と他の人の和了は止まった時の保険だけ掛ける
  let started = false;
  $: if (!started && total > 0) {
    started = true;
    if (auto) startAuto(900);
    else armIdle();
  }
  onDestroy(clearTimers);

  $: nextSlots = ended ? [] : curPair.slice(inPair);
</script>

<div class="ff" class:ended data-testid="fuyu-flip">
  <div class="ff-band"><span class="ff-title">冬冬金北</span>{#if name}<span class="ff-sub">{name}</span>{/if}</div>
  <div class="ff-board">
    {#each pairs as p, pi}
      {@const start = pairs.slice(0, pi).reduce((a, x) => a + x.length, 0)}
      {#if start < opened}
        <div class="ff-pair">
          {#each p as e, k}
            {#if start + k < opened}
              <div class="ff-slot open" class:hit={e.hit > 0} class:miss={e.hit === 0} class:fresh={start + k === opened - 1}>
                <Tile pai={e.pai} size="lg" />
                <span class="ff-mark">{e.hit > 0 ? `+${e.hit}` : '×'}</span>
              </div>
            {:else}
              <button class="ff-slot down" class:pulse={canTap} class:lc={lastChance} on:click={tap} disabled={!canTap} aria-label="伏せた牌">
                <Tile pai="back" size="lg" />
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    {/each}
    {#if !ended && inPair === 0 && nextSlots.length}
      <div class="ff-pair next">
        {#each nextSlots as _, k}
          <button class="ff-slot down" class:pulse={canTap && k === 0} on:click={tap} disabled={!canTap || k > 0} aria-label="伏せた牌">
            <Tile pai="back" size="lg" />
          </button>
        {/each}
      </div>
    {/if}
  </div>
  {#if lastChance}
    <div class="ff-lc">ラストチャンス</div>
  {/if}
  {#if hand.length}
    <div class="ff-hand">
      {#each hand as h}
        <span class="ff-h" class:lit={litHand.has(/^f/.test(h) ? 'hua' : norm(h))}><Tile pai={h} size="sm" /></span>
      {/each}
    </div>
  {/if}
  {#if canTap}<div class="ff-hint">伏せた牌をタップでめくる</div>{/if}
  <div class="ff-foot">
    <span class="ff-sum">合計 <b>{hits}</b> 枚</span>
    {#if ended}
      <button class="ff-btn" on:click={close}>OK</button>
    {:else if !remote}
      <button class="ff-btn ghost" on:click={openAll}>まとめてめくる</button>
    {/if}
  </div>
</div>

<style>
  .ff { position: fixed; inset: 0; z-index: 10040; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    background: radial-gradient(ellipse at 50% 40%, rgba(40, 70, 120, 0.92), rgba(6, 12, 28, 0.96)); color: #fff; }
  .ff-band { position: relative; display: flex; align-items: baseline; gap: 14px; padding: 8px 40px; transform: skewX(-12deg);
    background: linear-gradient(90deg, #0b0b0b, #1c1c1c); border-top: 3px solid #e7c25a; border-bottom: 3px solid #e7c25a; animation: ff-in 0.5s ease-out both; }
  .ff-title { font-family: 'FX Fuyu', 'FX Kana', sans-serif; font-size: 44px; color: #ffe08a; letter-spacing: 0.06em; text-shadow: 0 2px 0 #6b4a00; transform: skewX(12deg); }
  .ff-sub { font-size: 16px; color: #cfe2ff; transform: skewX(12deg); }
  .ff-board { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; max-width: min(92vw, 900px); }
  .ff-pair { display: flex; flex-direction: column; gap: 6px; padding: 6px; border-radius: 8px; background: rgba(160, 200, 255, 0.10); }
  .ff-slot { position: relative; display: flex; justify-content: center; align-items: center; width: 52px; height: 70px; padding: 0; border: 0; background: none; color: inherit; }
  .ff-slot :global(.tile), .ff-slot :global(img) { transform: scale(1.25); }
  .ff-slot.down { cursor: pointer; }
  .ff-slot.down:disabled { cursor: default; opacity: 0.85; }
  .ff-slot.down.pulse { animation: ff-pulse 1s ease-in-out infinite; }
  .ff-slot.down.lc { filter: drop-shadow(0 0 10px #ff5050); }
  .ff-slot.open.fresh { animation: ff-flip 0.35s ease-out both; }
  .ff-slot.open.hit { filter: drop-shadow(0 0 10px #ffd34d); }
  .ff-slot.open.miss { filter: grayscale(0.6) brightness(0.75); }
  .ff-mark { position: absolute; right: -10px; top: -12px; font-family: 'FX Fuyu', sans-serif; font-size: 20px; padding: 0 6px; border-radius: 10px; }
  .hit .ff-mark { background: #e7c25a; color: #2a1a00; animation: ff-pop 0.4s ease-out both; }
  .miss .ff-mark { background: #555; color: #ddd; }
  .ff-lc { font-family: 'FX Fuyu', sans-serif; font-size: 34px; color: #ff6b6b; text-shadow: 0 0 12px rgba(255, 60, 60, 0.8); animation: ff-in 0.3s ease-out both; }
  .ff-hand { display: flex; flex-wrap: wrap; gap: 2px; justify-content: center; max-width: 92vw; padding: 6px 10px; background: rgba(0, 0, 0, 0.35); border-radius: 8px; }
  .ff-h { opacity: 0.55; transition: opacity 0.2s, filter 0.2s; }
  .ff-h.lit { opacity: 1; filter: drop-shadow(0 0 6px #ffd34d); }
  .ff-hint { font-size: 13px; color: #cfe2ff; opacity: 0.85; }
  .ff-foot { display: flex; align-items: center; gap: 20px; }
  .ff-sum { font-family: 'FX Fuyu', sans-serif; font-size: 22px; }
  .ff-sum b { font-size: 34px; color: #ffe08a; }
  .ff-btn { font-size: 16px; padding: 8px 22px; border-radius: 6px; border: 2px solid #e7c25a; background: #e7c25a; color: #1a1200; font-weight: 700; cursor: pointer; }
  .ff-btn.ghost { background: transparent; color: #e7c25a; }
  @keyframes ff-in { from { opacity: 0; transform: skewX(-12deg) translateX(-60px); } to { opacity: 1; } }
  @keyframes ff-pulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
  @keyframes ff-flip { 0% { transform: rotateY(90deg) scale(1.1); } 100% { transform: rotateY(0) scale(1); } }
  @keyframes ff-pop { 0% { transform: scale(0.2); } 70% { transform: scale(1.3); } 100% { transform: scale(1); } }
</style>
