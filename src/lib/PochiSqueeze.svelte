<script lang="ts">
  // 白ぽっち ・ でかぽっちの絞り (2026-10-14 リョー、演出のラフ 1〜3 版の答え)。前の PochiRevealModal (タップでめくる) の置き換え。
  //  - 裏向きの牌を、指で下から上へ引いた分だけめくる。速さは指のまま (2 版 Q1 a)。キーボードは Enter で一気にめくる
  //  - 白ぽっちの点は小さく (半分近く絞るまで色が見えない)、でかぽっちは筒子の模様を 7 割に縮める (2 版 S3)
  //  - 絞りの途中で枠が光る (期待度)。正の時ほど強く、虹は正の確定 (pochiFx.expectationGlow)
  //  - 見えている牌で正 ・ 逆が決まっている時は、絞りの前に「確定」の帯 (pochiFx.kakuteiOf)
  //  - めくれたら、ツモ ・ ロンと同じ金と黒の帯に色の名前と効果 (3 版 T1 a)。逆は灰色の帯とヒビ
  //  - readOnly は他の人の画面: 引いた人の進み (progress) を外から受けて同じ様にめくる
  // 閉じ方は前と同じ 3 重 (めくれて 1.6 秒 ・ めくれた後のタップ ・ 触られないまま 30 秒で自動でめくる)
  import { onMount, onDestroy } from 'svelte';
  import { playSound } from './prefs';
  import { POCHI_DOT, POCHI_GOOD, expectationGlow, pochiRevealText, type Glow, type PochiColor } from './pochiFx';

  export let color: PochiColor;
  /** でかぽっちなら 'p1' / 'p2' */
  export let deka: 'p1' | 'p2' | null = null;
  export let who = '';
  export let kakutei: 'good' | 'bad' | null = null;
  /** 期待度の光り (他の人の画面は引いた人の物を受け取る)。無ければここで決める */
  export let glow: [Glow, Glow] | null = null;
  export let readOnly = false;
  /** readOnly の時の進み (0〜1) */
  export let progress = 0;
  export let onProgress: (p: number, glow: [Glow, Glow]) => void = () => {};
  export let onClose: () => void = () => {};

  const good = POCHI_GOOD[color];
  const stages: [Glow, Glow] = glow ?? (kakutei === 'good' ? ['rainbow', 'rainbow'] : expectationGlow(good, Math.random()));
  const text = pochiRevealText(color, !!deka);
  const REVEAL_AT = 0.9;

  let peel = 0;          // 0〜1。下からめくれた割合
  let revealed = false;
  let closing = false;
  let tileEl: HTMLDivElement | null = null;
  let startY: number | null = null;
  let startPeel = 0;
  let lastTouch = Date.now();
  const beats = new Set<number>();
  let kakuteiShowing = !!kakutei;

  $: glowNow = revealed ? (good ? (stages[1] === 'rainbow' ? 'rainbow' : 'gold') : 'none')
    : peel >= 0.42 ? stages[1] : peel >= 0.3 ? stages[0] : kakutei === 'good' ? 'rainbow' : 'none';
  $: if (readOnly) setPeel(progress);

  function se(name: string, vol = 0.6): void { playSound(`/sounds/fx/${name}.mp3`, vol); }
  function setPeel(p: number): void {
    if (revealed || closing) return;
    const v = Math.max(0, Math.min(1, p));
    for (const [t, name] of [[0.18, 'heart'], [0.33, 'heart'], [0.42, 'heart']] as Array<[number, string]>) {
      if (v >= t && !beats.has(t)) { beats.add(t); se(name, 0.5); if (t >= 0.33 && stages[t === 0.33 ? 0 : 1] !== 'white') se('pikiin', 0.45); }
    }
    peel = v;
    if (!readOnly) onProgress(v, stages);
    if (v >= REVEAL_AT) reveal();
  }
  function reveal(): void {
    if (revealed || closing) return;
    revealed = true;
    peel = 1;
    if (!readOnly) onProgress(1, stages);
    if (good) { se('kyuin', 0.6); playSound('/sounds/se_a.mp3', 0.6); } else { se('hazure', 0.6); playSound('/sounds/se_b.mp3', 0.6); }
    closeTimer = setTimeout(close, 1600);
  }
  function close(): void {
    if (closing) return;
    closing = true;
    onClose();
  }
  function onDown(e: PointerEvent): void {
    lastTouch = Date.now();
    if (revealed) { close(); return; }
    if (readOnly || kakuteiShowing) return;
    startY = e.clientY;
    startPeel = peel;
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  }
  function onMove(e: PointerEvent): void {
    if (startY === null || readOnly) return;
    lastTouch = Date.now();
    const h = tileEl?.offsetHeight ?? 260;
    setPeel(startPeel + (startY - e.clientY) / (h * 1.1));
  }
  function onUp(): void { startY = null; }
  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (revealed) close(); else if (!readOnly) setPeel(1);
  }

  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let kakuteiTimer: ReturnType<typeof setTimeout> | undefined;
  onMount(() => {
    se('pikiin', 0.4);
    if (kakutei) { se('kyuin', 0.5); kakuteiTimer = setTimeout(() => { kakuteiShowing = false; }, 1100); }
    // 触られないまま 30 秒たったら一気にめくる (他の人を待たせ続けない)。他の人の画面は引いた人に合わせるので 60 秒
    idleTimer = setInterval(() => {
      if (revealed || closing) return;
      if (Date.now() - lastTouch > (readOnly ? 60000 : 30000)) { if (readOnly) close(); else setPeel(1); }
    }, 1000);
  });
  onDestroy(() => { clearTimeout(closeTimer); clearInterval(idleTimer); clearTimeout(kakuteiTimer); });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="sq" class:revealed class:bad={revealed && !good} role="dialog" aria-label={revealed ? `${text.word} ${text.tag}` : `${who} ${deka ? 'でかぽっち' : '白ぽっち'} 絞り中`}
  tabindex="-1" on:pointerdown={onDown} on:pointermove={onMove} on:pointerup={onUp} on:pointercancel={onUp} on:keydown={onKey}>
  {#if who}<div class="sq-who">{who}{readOnly ? ' が絞っています' : ''}</div>{/if}
  <div class="sq-tile glow-{glowNow}" bind:this={tileEl}>
    {#if deka}
      <img class="sq-pin" src={`/tiles/${deka === 'p1' ? 'Pin1' : 'Pin2'}.svg`} alt="" draggable="false" />
    {:else}
      <svg class="sq-face" viewBox="0 0 300 400" aria-hidden="true"><circle cx="150" cy="200" r="24" fill={POCHI_DOT[color]} /></svg>
    {/if}
    <div class="sq-cover" style:clip-path={`inset(0 0 ${peel * 100}% 0)`}></div>
  </div>
  {#if !revealed && !readOnly && !kakuteiShowing && peel < 0.05}<div class="sq-hint">下から上へ指で絞る</div>{/if}
  {#if kakuteiShowing}
    <div class="sq-band" class:grey={kakutei === 'bad'}><span class="sq-word">確定</span><span class="sq-tag">{kakutei === 'good' ? '正のぽっち' : '逆のぽっち'}</span></div>
  {/if}
  {#if revealed}
    {#if !good}<svg class="sq-crack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 40 L38 22 L41 8 M50 40 L66 25 L70 6 M50 40 L30 48 L10 44 M50 40 L72 52 L94 50 M50 40 L44 64 L36 90 M50 40 L60 66 L68 92" /></svg>{/if}
    <div class="sq-band reveal" class:grey={!good}><span class="sq-word">{text.word}</span><span class="sq-tag">{text.tag}</span></div>
  {/if}
</div>

<style>
  .sq { position: fixed; inset: 0; z-index: 9999; background: rgba(0, 0, 0, 0.55); touch-action: none; user-select: none; outline: none; cursor: grab; overflow: hidden; }
  .sq.bad { background: rgba(0, 0, 0, 0.8); }
  .sq-who { position: absolute; left: 50%; top: max(12px, 6vh); transform: translateX(-50%); padding: 3px 14px; background: #111; color: #fff; font: 700 clamp(13px, 2vw, 18px) 'Zen Kaku Gothic New', sans-serif; letter-spacing: 0.08em; white-space: nowrap; }
  .sq-tile { position: absolute; left: 50%; top: 42%; width: min(46vw, 210px); aspect-ratio: 3 / 4; transform: translate(-50%, -50%); border-radius: 14px;
    background: linear-gradient(#fffdf6, #efe8d2); border: 2px solid #d9cfae; box-shadow: 0 10px 0 #c9bf9f, 0 16px 34px rgba(0, 0, 0, 0.6); transition: box-shadow 0.3s; }
  .sq-tile.glow-white { box-shadow: 0 10px 0 #c9bf9f, 0 0 0 6px #fff, 0 0 50px 14px rgba(255, 255, 255, 0.75); }
  .sq-tile.glow-gold { box-shadow: 0 10px 0 #c9bf9f, 0 0 0 7px #f2d27a, 0 0 70px 26px rgba(255, 200, 70, 0.95); }
  .sq-tile.glow-rainbow { animation: sqRainbow 0.6s linear infinite; }
  @keyframes sqRainbow {
    0%, 100% { box-shadow: 0 10px 0 #c9bf9f, 0 0 0 7px #ff3b3b, 0 0 80px 30px rgba(255, 80, 80, 0.9); }
    25% { box-shadow: 0 10px 0 #c9bf9f, 0 0 0 7px #ffd23b, 0 0 80px 30px rgba(255, 220, 80, 0.9); }
    50% { box-shadow: 0 10px 0 #c9bf9f, 0 0 0 7px #3bff8a, 0 0 80px 30px rgba(80, 255, 140, 0.9); }
    75% { box-shadow: 0 10px 0 #c9bf9f, 0 0 0 7px #3bb8ff, 0 0 80px 30px rgba(80, 180, 255, 0.9); }
  }
  .sq-face, .sq-pin { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .sq-pin { transform: scale(0.68); }
  .sq-cover { position: absolute; inset: -2px; border-radius: 14px; background: url('/tiles/Back.svg') center / 100% 100%; pointer-events: none; }
  .sq-hint { position: absolute; left: 50%; top: calc(42% + min(31vw, 150px)); transform: translateX(-50%); color: #fff; font: 700 15px 'Zen Kaku Gothic New', sans-serif; background: rgba(0, 0, 0, 0.55); padding: 4px 14px; border-radius: 4px; white-space: nowrap; }
  /* 帯はアプリのツモ ・ ロン (App.svelte の .dr-band) と同じ見た目 */
  .sq-band { --pink: #f2d27a; --pink2: #b8862b; --sh: #6b4a12; --h: clamp(90px, 20vh, 170px); --fs: calc(min(12vw, 120px, var(--h) * 0.6));
    position: absolute; left: -10%; right: -10%; top: 74%; height: var(--h); margin-top: calc(var(--h) / -2); display: flex; align-items: center; justify-content: center;
    background: repeating-linear-gradient(115deg, transparent 0 28px, rgba(0, 0, 0, 0.16) 28px 34px), linear-gradient(180deg, #111 0 7%, var(--pink) 7% 50%, var(--pink2) 50% 93%, #111 93% 100%);
    box-shadow: 0 0 0 4px #fff inset, 0 10px 30px rgba(0, 0, 0, 0.5); transform: rotate(-7deg); animation: sqBandIn 0.28s cubic-bezier(0.2, 0.9, 0.2, 1) both; pointer-events: none; }
  .sq-band:not(.reveal) { top: 74%; --h: clamp(70px, 14vh, 120px); --fs: calc(min(9vw, 84px, var(--h) * 0.6)); }
  .sq-band.grey { --pink: #8a8f99; --pink2: #4a4f5a; --sh: #222; }
  .sq-word { font-family: 'FX Kana', 'Zen Kaku Gothic New', sans-serif; font-size: var(--fs); line-height: 1; letter-spacing: 0.04em; white-space: nowrap; color: #fff !important;
    -webkit-text-stroke: calc(var(--fs) * 0.07) #111; paint-order: stroke fill; text-shadow: calc(var(--fs) * 0.06) calc(var(--fs) * 0.06) 0 var(--sh); transform: skewX(-12deg);
    animation: sqWord 0.4s cubic-bezier(0.2, 1.4, 0.3, 1) both; }
  .sq-tag { position: absolute; right: 14%; bottom: 10%; padding: 3px 14px; background: #111; color: #fff !important; font: 700 clamp(13px, 2vw, 20px) 'Zen Kaku Gothic New', sans-serif; letter-spacing: 0.08em; transform: skewX(-12deg); }
  .sq-crack { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .sq-crack path { fill: none; stroke: #f4f4f4; stroke-width: 0.5; stroke-dasharray: 200; stroke-dashoffset: 200; animation: sqDraw 0.35s ease-out forwards; filter: drop-shadow(0 0 1px #000); }
  @keyframes sqBandIn { from { transform: rotate(-7deg) translateX(-120%); } to { transform: rotate(-7deg) translateX(0); } }
  @keyframes sqWord { 0% { opacity: 0; transform: skewX(-12deg) scale(2.4); } 60% { opacity: 1; transform: skewX(-12deg) scale(0.94); } 100% { opacity: 1; transform: skewX(-12deg) scale(1); } }
  @keyframes sqDraw { to { stroke-dashoffset: 0; } }
  @media (prefers-reduced-motion: reduce) { .sq-band, .sq-word, .sq-crack path { animation: none; } .sq-crack path { stroke-dashoffset: 0; } .sq-tile.glow-rainbow { animation: none; box-shadow: 0 10px 0 #c9bf9f, 0 0 0 7px #ff5ad1, 0 0 80px 30px rgba(120, 220, 255, 0.9); } }
</style>
