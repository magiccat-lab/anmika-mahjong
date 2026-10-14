<script lang="ts">
  // 白ぽっち ・ でかぽっちの絞り (2026-10-14 リョー、演出のラフ 1〜3 版の答え)。前の PochiRevealModal (タップでめくる) の置き換え。
  //  - 裏向きの牌を、指で下から上へ引いた分だけめくる。速さは指のまま (2 版 Q1 a)。キーボードは Enter で一気にめくる
  //  - 白ぽっちの点は小さく (半分近く絞るまで色が見えない)、でかぽっちは筒子の模様を 7 割に縮める (2 版 S3)
  //  - 絞りの途中で枠が光る (期待度)。正の時ほど強く、虹は正の確定 (pochiFx.expectationGlow)
  //  - 見えている牌で正 ・ 逆が決まっている時は、絞りの前に「確定」の帯 (pochiFx.kakuteiOf)
  //  - めくれたら、ツモ ・ ロンと同じ金と黒の帯に色の名前と効果 (3 版 T1 a)。逆は灰色の帯とヒビ
  //  - readOnly は他の人の画面: 引いた人の進み (progress) を外から受けて同じ様にめくる
  //  - 4 版の答え (同じ日「ポッチの演出もうちょっと強化したい」): 光りは 5 段のステップアップ (目盛りと字、3 段目から揺れる)、
  //    点がのぞく手前の溜め (暗くして寄り、半分の速さでしかめくれない、心臓の音が速く)、虹の確定のまれなプレミア (虹の光線とサビ 3 秒)
  // 閉じ方は前と同じ 3 重 (めくれて 1.6 秒 ・ めくれた後のタップ ・ 触られないまま 30 秒で自動でめくる)
  import { onMount, onDestroy } from 'svelte';
  import { playSound } from './prefs';
  import { POCHI_DOT, POCHI_GOOD, STEP_GLOW, STEP_WORD, TAME_BEATS, TAME_FROM, TAME_TO, pochiRevealText, pochiTopStep, stepAt,
    type Glow, type PochiColor } from './pochiFx';

  export let color: PochiColor;
  /** でかぽっちなら 'p1' / 'p2' */
  export let deka: 'p1' | 'p2' | null = null;
  export let who = '';
  export let kakutei: 'good' | 'bad' | null = null;
  /** 期待度: 光りが何段まで上がるか (0〜4)。他の人の画面は引いた人の物を受け取る。無ければここで決める */
  export let step: number | null = null;
  /** プレミア (虹の確定のまれな演出)。引いた人が決めて他の席へ流す */
  export let premium = false;
  /** 前の型の光り 2 段 (古い端末から届いた時だけ使う) */
  export let glow: [Glow, Glow] | null = null;
  export let readOnly = false;
  /** readOnly の時の進み (0〜1) */
  export let progress = 0;
  /** 他の人の画面で、色がまだ届いていない間は点を描かない */
  export let colorKnown = true;
  export let onProgress: (p: number) => void = () => {};
  /** 引いた人の画面が開いた時 (他の席へ「絞り始めた」を流す) */
  export let onOpen: () => void = () => {};
  export let onClose: () => void = () => {};

  // 他の人の画面は色が後から届くので、色から出す物は全部 $: にする
  $: good = POCHI_GOOD[color];
  $: text = pochiRevealText(color, !!deka);
  const topStep: number = step ?? (glow ? (glow[1] === 'rainbow' ? 4 : glow[1] === 'gold' ? 3 : 0)
    : pochiTopStep(POCHI_GOOD[color], kakutei, Math.random()));
  const REVEAL_AT = 0.9;

  let peel = 0;          // 0〜1。下からめくれた割合
  let revealed = false;
  let closing = false;
  let tileEl: HTMLDivElement | null = null;
  let startY: number | null = null;
  let startPeel = 0;
  let lastTouch = Date.now();
  let lastY = 0;
  const beats = new Set<number>();
  let premiumShowing = premium;
  let kakuteiShowing = !!kakutei && !premium;
  let stepNow = -1;
  let shakeKey = 0;

  $: tame = !revealed && peel >= TAME_FROM && peel < TAME_TO;
  $: glowNow = revealed ? (good ? (topStep >= 4 ? 'rainbow' : 'gold') : 'none')
    : stepNow >= 0 ? STEP_GLOW[stepNow] : kakutei === 'good' ? 'rainbow' : 'none';
  $: if (readOnly) setPeel(progress);

  function se(name: string, vol = 0.6): void { playSound(`/sounds/fx/${name}.mp3`, vol); }
  function setPeel(p: number): void {
    if (revealed || closing) return;
    const v = Math.max(0, Math.min(1, p));
    for (const t of [0.18, 0.3, ...TAME_BEATS]) {
      if (v >= t && !beats.has(t)) { beats.add(t); se('heart', t >= TAME_FROM ? 0.65 : 0.5); }
    }
    const k = stepAt(v, topStep);
    if (k > stepNow) {
      stepNow = k;
      se(k >= 3 ? 'kyuin' : 'pikiin', k >= 3 ? 0.6 : 0.5);
      if (k >= 2) shakeKey += 1;
    }
    peel = v;
    if (!readOnly) onProgress(v);
    if (v >= REVEAL_AT) reveal();
  }
  function reveal(): void {
    if (revealed || closing) return;
    revealed = true;
    peel = 1;
    if (!readOnly) onProgress(1);
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
    if (readOnly || kakuteiShowing || premiumShowing) return;
    startY = e.clientY;
    lastY = e.clientY;
    startPeel = peel;
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  }
  function onMove(e: PointerEvent): void {
    if (startY === null || readOnly) return;
    lastTouch = Date.now();
    const h = tileEl?.offsetHeight ?? 260;
    // 溜めの間は指の半分しかめくれない (スロー)。指の動いた分を足していく形にした
    const d = (lastY - e.clientY) / (h * 1.1);
    lastY = e.clientY;
    setPeel(peel + (tame && d > 0 ? d * 0.5 : d));
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
  let premiumTimer: ReturnType<typeof setTimeout> | undefined;
  function startKakutei(): void {
    if (!kakutei) return;
    kakuteiShowing = true;
    se('kyuin', 0.5);
    kakuteiTimer = setTimeout(() => { kakuteiShowing = false; }, 1100);
  }
  onMount(() => {
    if (!readOnly) onOpen();
    se('pikiin', 0.4);
    if (premium) {
      // プレミア: 虹の光線とアンミカーニバルのサビ 3 秒 (曲のファイルは git に入れない public/sounds/bgm/)。終わってから確定の帯と絞り
      playSound('/sounds/bgm/premium_sabi.mp3', 0.55);
      premiumTimer = setTimeout(() => { premiumShowing = false; startKakutei(); }, 2800);
    } else {
      startKakutei();
    }
    // 触られないまま 30 秒たったら一気にめくる (他の人を待たせ続けない)。他の人の画面は引いた人に合わせるので 60 秒
    idleTimer = setInterval(() => {
      if (revealed || closing) return;
      if (Date.now() - lastTouch > (readOnly ? 60000 : 30000)) { if (readOnly) close(); else setPeel(1); }
    }, 1000);
  });
  onDestroy(() => { clearTimeout(closeTimer); clearInterval(idleTimer); clearTimeout(kakuteiTimer); clearTimeout(premiumTimer); });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="sq" class:revealed class:bad={revealed && !good} class:tame role="dialog" aria-label={revealed ? `${text.word} ${text.tag}` : `${who} ${deka ? 'でかぽっち' : '白ぽっち'} 絞り中`}
  tabindex="-1" on:pointerdown={onDown} on:pointermove={onMove} on:pointerup={onUp} on:pointercancel={onUp} on:keydown={onKey}>
  {#if who}<div class="sq-who">{who}{readOnly ? ' が絞っています' : ''}</div>{/if}
  {#if premiumShowing}
    <div class="sq-rays" aria-hidden="true"></div>
    <div class="sq-premium" aria-hidden="true">アンミカーニバル</div>
  {/if}
  {#key shakeKey}<div class="sq-shake" class:go={shakeKey > 0}>
  <div class="sq-tile glow-{glowNow}" class:zoom={tame} bind:this={tileEl}>
    {#if deka}
      <img class="sq-pin" src={`/tiles/${deka === 'p1' ? 'Pin1' : 'Pin2'}.svg`} alt="" draggable="false" />
    {:else}
      <svg class="sq-face" viewBox="0 0 300 400" aria-hidden="true">{#if colorKnown}<circle cx="150" cy="200" r="24" fill={POCHI_DOT[color]} />{/if}</svg>
    {/if}
    <div class="sq-cover" style:clip-path={`inset(0 0 ${peel * 100}% 0)`}></div>
  </div>
  </div>{/key}
  {#if !revealed && !premiumShowing && !kakuteiShowing}
    <div class="sq-meter" aria-hidden="true">
      {#each STEP_GLOW as g, i}<span class="sq-pip" class:on={i <= stepNow} data-glow={g}></span>{/each}
    </div>
    {#if stepNow >= 0}{#key stepNow}<div class="sq-step" class:hot={stepNow >= 2}>{STEP_WORD[stepNow]}</div>{/key}{/if}
  {/if}
  {#if tame}<div class="sq-slow" aria-hidden="true">SLOW</div>{/if}
  {#if !revealed && !readOnly && !kakuteiShowing && !premiumShowing && peel < 0.05}<div class="sq-hint">下から上へ指で絞る</div>{/if}
  {#if kakuteiShowing}
    <div class="sq-band" class:grey={kakutei === 'bad'}><span class="sq-word">確定</span><span class="sq-tag">{kakutei === 'good' ? '正のぽっち' : '逆のぽっち'}</span></div>
  {/if}
  {#if revealed}
    {#if !good}<svg class="sq-crack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 40 L38 22 L41 8 M50 40 L66 25 L70 6 M50 40 L30 48 L10 44 M50 40 L72 52 L94 50 M50 40 L44 64 L36 90 M50 40 L60 66 L68 92" /></svg>{/if}
    <div class="sq-band reveal" class:grey={!good}><span class="sq-word">{text.word}</span><span class="sq-tag">{text.tag}</span></div>
  {/if}
</div>

<style>
  .sq { position: fixed; inset: 0; z-index: 9999; background: rgba(4, 8, 6, 0.78); touch-action: none; user-select: none; outline: none; cursor: grab; overflow: hidden; }
  .sq.bad { background: rgba(0, 0, 0, 0.8); }
  /* 横持ちでは牌が上まで来るので、名前は牌の左に出す (上に置くと牌に隠れる) */
  .sq-who { position: absolute; z-index: 2; left: max(16px, 3vw); top: 42%; transform: translateY(-50%); max-width: calc(50% - min(23vw, 105px) - 24px); overflow: hidden; text-overflow: ellipsis; padding: 3px 14px; background: #111; color: #fff; font: 700 clamp(13px, 2vw, 18px) 'Zen Kaku Gothic New', sans-serif; letter-spacing: 0.08em; white-space: nowrap; }
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
  .sq-tile.glow-blue { box-shadow: 0 10px 0 #c9bf9f, 0 0 0 7px #4a8cff, 0 0 70px 24px rgba(70, 140, 255, 0.9); }
  .sq-tile.glow-green { box-shadow: 0 10px 0 #c9bf9f, 0 0 0 7px #3bd17a, 0 0 70px 24px rgba(60, 220, 120, 0.9); }
  .sq-tile.zoom { transform: translate(-50%, -50%) scale(1.18); transition: transform 0.5s ease-out, box-shadow 0.3s; }
  .sq.tame { background: rgba(0, 0, 0, 0.93); }
  .sq-shake { position: absolute; inset: 0; pointer-events: none; }
  .sq-shake .sq-tile { pointer-events: auto; }
  .sq-shake.go { animation: sqShake 0.4s; }
  @keyframes sqShake { 0%, 100% { transform: none; } 20% { transform: translate(-10px, 6px); } 40% { transform: translate(9px, -7px); } 60% { transform: translate(-6px, -4px); } 80% { transform: translate(4px, 3px); } }
  /* 溜めで牌が 1.18 倍になっても重ならない様に、牌の半分の幅の 1.2 倍の外に置く */
  .sq-meter { position: absolute; left: calc(50% + min(23vw, 105px) * 1.2 + 18px); top: 42%; transform: translateY(-50%); display: flex; flex-direction: column-reverse; gap: 8px; }
  .sq-pip { width: clamp(18px, 3.6vw, 30px); height: clamp(18px, 3.6vw, 30px); border-radius: 7px; border: 2px solid rgba(255, 255, 255, 0.5); background: rgba(0, 0, 0, 0.4); }
  .sq-pip.on[data-glow='white'] { background: #fff; } .sq-pip.on[data-glow='blue'] { background: #4a8cff; } .sq-pip.on[data-glow='green'] { background: #3bd17a; }
  .sq-pip.on[data-glow='gold'] { background: #f2c23a; } .sq-pip.on[data-glow='rainbow'] { background: conic-gradient(#ff3b3b, #ffd23b, #3bff8a, #3bb8ff, #c63bff, #ff3b3b); }
  .sq-step { position: absolute; left: calc(50% + min(23vw, 105px) * 1.2 + 18px + clamp(18px, 3.6vw, 30px) + 12px); top: 42%; transform: translateY(-50%); white-space: nowrap;
    font-family: 'FX Kana', 'Zen Kaku Gothic New', sans-serif; font-size: clamp(26px, 6vw, 56px); color: #fff; -webkit-text-stroke: 4px #111; paint-order: stroke fill; animation: sqPop 0.3s cubic-bezier(0.2, 1.7, 0.4, 1) both; }
  .sq-step.hot { color: #ffe27a; }
  .sq-slow { position: absolute; left: max(16px, 3vw); top: max(16px, 4vh); font: 800 clamp(22px, 4vw, 40px) 'Zen Kaku Gothic New', sans-serif; letter-spacing: 0.2em; color: #fff; -webkit-text-stroke: 3px #000; paint-order: stroke fill; animation: sqBlink 0.5s steps(2) infinite; }
  .sq-rays { position: absolute; left: 50%; top: 42%; width: 220vmax; height: 220vmax; margin: -110vmax 0 0 -110vmax; border-radius: 50%; pointer-events: none;
    background: repeating-conic-gradient(#ff3b3b 0 6deg, transparent 6deg 12deg, #ffd23b 12deg 18deg, transparent 18deg 24deg, #3bff8a 24deg 30deg, transparent 30deg 36deg, #3bb8ff 36deg 42deg, transparent 42deg 48deg, #c63bff 48deg 54deg, transparent 54deg 60deg);
    -webkit-mask: radial-gradient(circle, #000 6%, transparent 50%); mask: radial-gradient(circle, #000 6%, transparent 50%); animation: sqSpin 5s linear infinite; opacity: 0.9; }
  .sq-premium { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); white-space: nowrap; z-index: 3; font-family: 'FX Kana', 'Zen Kaku Gothic New', sans-serif; font-size: clamp(34px, 10vw, 120px);
    background: linear-gradient(90deg, #ff3b3b, #ffd23b, #3bff8a, #3bb8ff, #c63bff); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 2px #fff;
    filter: drop-shadow(0 0 16px rgba(255, 255, 255, 0.8)); animation: sqPop 0.4s cubic-bezier(0.2, 1.7, 0.4, 1) both; }
  @keyframes sqPop { 0% { opacity: 0; transform: translate(var(--px, 0), -50%) scale(2); } 100% { opacity: 1; transform: translate(var(--px, 0), -50%) scale(1); } }
  .sq-premium { --px: -50%; }
  @keyframes sqSpin { to { transform: rotate(360deg); } }
  @keyframes sqBlink { 50% { opacity: 0.3; } }
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
  @media (prefers-reduced-motion: reduce) { .sq-band, .sq-word, .sq-crack path, .sq-shake.go, .sq-rays, .sq-slow { animation: none; } .sq-crack path { stroke-dashoffset: 0; } .sq-tile.glow-rainbow { animation: none; box-shadow: 0 10px 0 #c9bf9f, 0 0 0 7px #ff5ad1, 0 0 80px 30px rgba(120, 220, 255, 0.9); } }
</style>
