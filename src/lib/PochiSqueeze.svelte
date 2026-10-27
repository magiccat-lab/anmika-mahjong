<script lang="ts">
  // 白ぽっち ・ でかぽっちのムービー (2026-10-25 リョーの仕様「白ぽっち演出の作り直し」)。前の絞り (指で下から上へ) は廃止。
  // 牌は PUSH を押すまで伏せたまま。尺と中身は plan (pochiFx.rollPlan) と kakutei だけで決まり、当落そのものでは変えない。
  //  ① 引いた瞬間 (plan.opening): フリーズ (FreezeFx) ・ プレミア ・ 予告 3 種 ・ 無し    確定の帯 (kakutei があれば)
  //  ② 光りの段階: 白から 1 色ずつ上がって着いた色で脈打つ (plan.glow ・ pulse)。キリン柄 (plan.premium = kirin)
  //  ③ 発展 (光りが赤以上の時だけ): 暗転して牌が浮かび粒子 (plan.particle)    ④ 溜め: 光りが止まりひび (plan.crack)
  //  ⑤ PUSH を待つ (plan.push の見た目)。自分は押す ・ 20 秒で自動 PUSH。他の席は「待ち」(引いた人の reveal で結果へ)
  //  ⑥ 結果: 牌がめくれて色の帯。復活 (plan.premium = revive) は外れの帯 → 「まだや！」→ 本当の帯
  // 色 (color / revealColor) を読むのは ⑥ の結果の段だけ。それまでは DOM ・ class ・ style のどこにも色由来の物を出さない。
  // 何もしない画面を触れば PUSH まで飛ぶ (フリーズとプレミアの間は飛ばせない)。
  import { onMount, onDestroy } from 'svelte';
  import { playSound } from './prefs';
  import FreezeFx from './FreezeFx.svelte';
  import { DEFAULT_PLAN, DELAY_MS, FREEZE_MS, GLOW_ORDER, GLOW_STAGE_MS, KAKUTEI_MS, POCHI_DOT, POCHI_GOOD, PREMIUM_MS, PUSH_IDLE_MS, REMOTE_IDLE_MS,
    RESULT_MS, REVIVE_MISS_MS, REVIVE_WORD_MS, TEASER_MS, DEVELOP_MS, TAME_MS, develops, glowSteps, movieTimeline, pochiRevealText, shownGlow,
    type PochiColor, type PochiPlan } from './pochiFx';

  /** 引いた人の画面だけが持つ色。PUSH の後の結果の段でしか読まない */
  export let color: PochiColor | null = null;
  /** 他の人の画面に引いた人の reveal で届く色。届くまで null */
  export let revealColor: PochiColor | null = null;
  /** 引いた人が PUSH を押した (App 側の旗)。押す前は色を使わない */
  export let pushed = false;
  /** でかぽっちなら 'p1' / 'p2' */
  export let deka: 'p1' | 'p2' | null = null;
  export let who = '';
  export let kakutei: 'good' | 'bad' | null = null;
  export let plan: PochiPlan = DEFAULT_PLAN;
  export let readOnly = false;
  /** [牌譜再生] PUSH の段で待つ ms (null ならいつもの PUSH_IDLE_MS / REMOTE_IDLE_MS) */
  export let pushIdleMs: number | null = null;
  /** [牌譜再生] 他の席の分。reveal は記録に無いので、PUSH の段が過ぎたら記録の色で結果を出す */
  export let autoColor: PochiColor | null = null;
  /** 引いた人の画面が開いた時 (他の席へ「引いた」と plan を流す) */
  export let onOpen: () => void = () => {};
  /** 引いた人が PUSH を押した時 (他の席へ色を流す) */
  export let onPush: () => void = () => {};
  export let onClose: () => void = () => {};

  type Stage = 'opening' | 'kakutei' | 'glow' | 'develop' | 'tame' | 'push' | 'result';
  type RPhase = 'burst' | 'miss' | 'word' | 'reveal';
  // 光りの色 (番号は GLOW_ORDER の順。class 名には色の言葉を使わない)
  const GLOW_CSS = ['#ffffff', '#3a78ff', '#2ecc71', '#ff3b3b', '#f2c23a', 'conic-gradient(#ff3b3b, #ffd23b, #3bff8a, #3bb8ff, #c63bff, #ff3b3b)'];
  const PUSH_LOOK: Record<PochiPlan['push'], number> = { normal: 0, red: 1, gold: 2, rainbow: 3 };
  const tl = movieTimeline(plan, kakutei);
  const target = GLOW_ORDER.indexOf(shownGlow(plan, kakutei));
  const dev = develops(plan, kakutei);
  const isFreeze = plan.opening === 'freeze_black' || plan.opening === 'freeze_still';
  const isTeaser = plan.opening === 'bolt' || plan.opening === 'line' || plan.opening === 'mono';

  let stage: Stage = tl.openingMs > 0 ? 'opening' : kakutei ? 'kakutei' : 'glow';
  let rphase: RPhase = 'burst';
  let gl = -1;              // 光りの色の番号。-1 = まだ光らない
  let pulsing = false;
  let dark = false;         // blink: 一瞬消える
  let devSeen = false;      // 発展に入った (暗転 ・ 浮遊 ・ 溜め ・ ひび)
  let lampOn = false;
  let closing = false;
  let mounted = false;
  let localPushed = false;
  let resultColor: PochiColor | null = null;
  let resultGlow = -1;
  let flipped = false;      // 牌がめくれて顔が見える
  let fakeMiss = false;     // 復活の「外れに見せる」間
  let timers: ReturnType<typeof setTimeout>[] = [];
  let lampTimer: ReturnType<typeof setTimeout> | undefined;
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let resultTimers: ReturnType<typeof setTimeout>[] = [];
  let audios: HTMLAudioElement[] = [];

  // 試験 (Playwright) は録画に音が入らないので、鳴らした音と時刻を window.__seLog に残す (遅れの試験と録画の音入れ)
  function snd(path: string, vol: number): void {
    const a = playSound(path, vol);
    if (a) audios.push(a);
    if (typeof navigator !== 'undefined' && (navigator as any).webdriver) ((window as any).__seLog ??= []).push({ path, vol, at: Date.now() });
  }
  function se(name: string, vol = 0.6): void { snd(`/sounds/fx/${name}.mp3`, vol); }
  function stopSounds(): void {
    for (const a of audios) { try { a.pause(); } catch { /* 止まらなくても進める */ } }
    audios = [];
  }
  function lightLamp(): void { if (lampOn || closing) return; lampOn = true; se('kyuin', 0.7); }
  function later(fn: () => void, ms: number): void { timers.push(setTimeout(fn, ms)); }
  function clearStageTimers(): void { for (const t of timers) clearTimeout(t); timers = []; }
  function laterResult(fn: () => void, ms: number): void { resultTimers.push(setTimeout(fn, ms)); }

  // ---- ① 〜 ④ ----
  function enterStage(s: Stage): void {
    stage = s;
    if (s === 'kakutei') se('kyuin', 0.5);
    if (s === 'glow') startGlow();
    if (s === 'develop') devSeen = true;
    if (s === 'tame') { devSeen = true; se('heart', 0.65); }
  }
  function startGlow(): void {
    gl = 0;
    pulsing = false;
    const steps = glowSteps(GLOW_ORDER[target]);
    for (const st of steps) {
      later(() => { gl = GLOW_ORDER.indexOf(st.color); if (gl >= 4) se('kira', 0.5); }, st.at);
    }
    const stepsEnd = steps.length ? steps[steps.length - 1].at : 0;
    later(() => { pulsing = true; }, stepsEnd + 120);
    if (plan.pulse === 'blink') {
      // 脈打ちの代わりに、一瞬消えて虹で点け直す
      const darkAt = Math.min(stepsEnd + 500, GLOW_STAGE_MS - 700);
      later(() => { dark = true; }, darkAt);
      later(() => { dark = false; gl = 5; se('kira', 0.6); }, darkAt + 250);
    }
  }
  function startMovie(): void {
    // 引いた瞬間の音。フリーズは引いた音も鳴らさず、いきなり止まる (明けのキュインは FreezeFx が鳴らす)
    if (!isFreeze) {
      if (plan.delay) delayTimer = setTimeout(() => se('pikiin', 0.4), DELAY_MS);
      else se('pikiin', 0.4);
    }
    if (plan.opening === 'premium') snd('/sounds/bgm/premium_sabi.mp3', 0.55);
    else if (plan.opening === 'line') { se('kira', 0.6); se('gyuiin', 0.5); }
    else if (plan.opening === 'mono') { se('gashan', 0.4); se('kira', 0.7); }
    else if (plan.opening === 'bolt') { se('gashan', 0.6); se('gyuiin', 0.5); }
    // 先告知のランプは引いた直後 (フリーズの時は明けてから)
    if (plan.lamp === 'pre') lampTimer = setTimeout(lightLamp, isFreeze ? FREEZE_MS + 100 : 250);
    // 段の並び。尺 0 の段は飛ばす
    const seq: { s: Stage; ms: number }[] = [
      { s: 'opening', ms: tl.openingMs }, { s: 'kakutei', ms: tl.kakuteiMs }, { s: 'glow', ms: tl.glowMs },
      { s: 'develop', ms: tl.developMs }, { s: 'tame', ms: tl.tameMs },
    ];
    let at = 0;
    let first = true;
    for (const { s, ms } of seq) {
      if (ms <= 0) continue;
      if (first) { enterStage(s); first = false; } else { const t = at; later(() => enterStage(s), t); }
      at += ms;
    }
    later(enterPush, at);
  }

  // ---- ⑤ PUSH ----
  function enterPush(): void {
    if (stage === 'push' || stage === 'result') return;
    clearStageTimers();
    stage = 'push';
    if (gl < 0) gl = target;
    pulsing = true;
    clearTimeout(idleTimer);
    // 押されないままなら、自分は自動 PUSH (他の人を待たせない)。他の席は引いた人の reveal を待ち、来なければ閉じる
    idleTimer = setTimeout(() => {
      if (readOnly) { if (autoColor) startResult(autoColor); else close(); } else doPush();
    }, pushIdleMs ?? (readOnly ? REMOTE_IDLE_MS : PUSH_IDLE_MS));
  }
  function skip(): void {
    if (plan.lamp === 'pre') lightLamp();
    clearStageTimers();
    clearTimeout(delayTimer);
    stopSounds();
    devSeen = false;
    dark = false;
    gl = target;
    enterPush();
  }
  function doPush(): void {
    if (readOnly || localPushed || stage === 'result' || closing) return;
    localPushed = true;
    se('push', 0.6);
    onPush();
    startResult(color);
  }

  // ---- ⑥ 結果 (ここで初めて色を読む) ----
  function startResult(c: PochiColor | null): void {
    if (!c || stage === 'result' || closing) return;
    clearStageTimers();
    clearTimeout(idleTimer);
    clearTimeout(delayTimer);
    resultColor = c;
    const good = POCHI_GOOD[c];
    stage = 'result';
    pulsing = false;
    dark = false;
    devSeen = false;
    resultGlow = good ? 4 : -1;
    if (good && plan.premium === 'revive') {
      // 復活: まず外れに見せて、「まだや！」で本当の当たり
      rphase = 'miss'; flipped = true; fakeMiss = true;
      se('hazure', 0.6);
      laterResult(() => { rphase = 'word'; fakeMiss = false; se('gyuiin', 0.6); }, REVIVE_MISS_MS);
      laterResult(() => revealFinal(good), REVIVE_MISS_MS + REVIVE_WORD_MS);
    } else {
      revealFinal(good);
    }
  }
  function revealFinal(good: boolean): void {
    rphase = 'reveal'; flipped = true; fakeMiss = false;
    if (good) { se('kyuin', 0.6); snd('/sounds/se_a.mp3', 0.6); } else { se('hazure', 0.6); snd('/sounds/se_b.mp3', 0.6); }
    if (plan.lamp === 'post' && good) lampTimer = setTimeout(lightLamp, 350);
    closeTimer = setTimeout(close, RESULT_MS);
  }
  function close(): void {
    if (closing) return;
    closing = true;
    onClose();
  }

  $: if (mounted && !readOnly && pushed) startResult(color);
  $: if (mounted && readOnly && revealColor) startResult(revealColor);
  $: text = resultColor ? pochiRevealText(resultColor, !!deka) : null;
  $: fakeText = pochiRevealText('red', !!deka);
  $: good = resultColor ? POCHI_GOOD[resultColor] : false;
  $: skippable = (stage === 'opening' && !isFreeze && plan.opening !== 'premium') || stage === 'kakutei' || stage === 'glow' || stage === 'develop' || stage === 'tame';
  $: halo = stage === 'result' ? resultGlow : gl;
  $: label = stage === 'result' && rphase === 'reveal' && text ? `${text.word} ${text.tag}` : `${who} ${deka ? 'でかぽっち' : '白ぽっち'}`;

  function onDown(): void {
    if (stage === 'result') { if (rphase === 'reveal') close(); return; }
    if (skippable) skip();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (stage === 'result') { if (rphase === 'reveal') close(); } else if (stage === 'push') doPush(); else if (skippable) skip();
  }

  // 粒子 (発展の間だけ。位置は番号から決める)
  const SPECKS = Array.from({ length: 16 }, (_, i) => {
    const a = (i * 137.508 * Math.PI) / 180;
    const r = 70 + ((i * 37) % 60);
    return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r * 1.15), d: (i % 8) * 0.11, dur: 0.8 + (i % 5) * 0.12, s: 4 + (i % 4) * 2, h: (i * 23) % 360 };
  });
  // ひび (牌の 100 x 133 の中)
  const CRACK_A = 'M62 0 L55 22 L63 40 L50 62 L58 80 L47 105 L52 133';
  const CRACK_B = 'M0 55 L20 60 L30 52 L48 66 L66 58 L84 70 L100 64';
  const CRACK_ALL = [
    'M50 66 L30 40 L34 18 L22 0', 'M50 66 L72 44 L70 22 L84 0', 'M50 66 L22 72 L10 60 L0 62', 'M50 66 L80 78 L92 70 L100 74',
    'M50 66 L40 92 L28 108 L30 133', 'M50 66 L62 94 L74 112 L70 133', 'M30 40 L12 44 L0 36', 'M72 44 L90 40 L100 46', 'M40 92 L18 100 L8 118', 'M62 94 L86 100 L96 120',
    'M22 72 L26 52 L36 46 L44 54 L50 66', 'M80 78 L70 98 L58 100',
  ];
  $: cracks = plan.crack === 'one' ? [CRACK_A] : plan.crack === 'two' ? [CRACK_A, CRACK_B] : plan.crack === 'all' ? [CRACK_A, CRACK_B, ...CRACK_ALL] : [];
  $: showCracks = devSeen && (stage === 'tame' || stage === 'push');
  $: zoomed = devSeen && (stage === 'tame' || stage === 'push');
  $: frozen = devSeen && (stage === 'tame' || stage === 'push');

  onMount(() => {
    mounted = true;
    if (!readOnly) onOpen();
    if (readOnly && revealColor) { startResult(revealColor); return; }
    startMovie();
  });
  onDestroy(() => {
    clearStageTimers();
    for (const t of resultTimers) clearTimeout(t);
    clearTimeout(lampTimer); clearTimeout(delayTimer); clearTimeout(closeTimer); clearTimeout(idleTimer);
  });
  // 使わない定数を握っておく (尺の表は pochiFx が正)
  void PREMIUM_MS; void TEASER_MS; void KAKUTEI_MS; void DEVELOP_MS; void TAME_MS;
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="sq" class:dev={devSeen && stage !== 'result'} class:mono={stage === 'opening' && plan.opening === 'mono'} class:bad={stage === 'result' && rphase === 'reveal' && !good}
  data-testid="pochi-skip" data-stage={stage} role="dialog" aria-label={label} tabindex="-1" on:pointerdown={onDown} on:keydown={onKey}>
  {#if who}<div class="sq-who">{who}{readOnly ? ' が引いた' : ''}</div>{/if}
  {#if stage === 'opening' && isFreeze}<FreezeFx kind={plan.opening === 'freeze_still' ? 'still' : 'black'} durationMs={FREEZE_MS} />{/if}
  {#if lampOn}<div class="sq-edge" aria-hidden="true"><div class="sq-edge-run"></div></div>{/if}
  {#if stage === 'opening' && plan.opening === 'premium'}
    <div class="sq-rays" aria-hidden="true"></div>
    <div class="sq-premium" aria-hidden="true">アンミカーニバル</div>
  {/if}
  {#if stage === 'opening' && plan.opening === 'mono'}
    <div class="sq-mono" aria-hidden="true"><div class="sq-mono-scan"></div></div>
    <div class="sq-band teaser mono" aria-hidden="true"><span class="sq-word">ぽっちチャンス</span></div>
  {:else if stage === 'opening' && plan.opening === 'line'}
    <div class="sq-ci" aria-hidden="true"><div class="sq-ci-speed"></div><div class="sq-ci-line">白って 200 色あんねん</div><div class="sq-ci-sig">アン ミカ</div></div>
    <div class="sq-band teaser line" aria-hidden="true"><span class="sq-word">ぽっちチャンス</span></div>
  {:else if stage === 'opening' && plan.opening === 'bolt'}
    <svg class="sq-bolt" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M98 -2 L84 12 L89 15 L74 26 L79 29 L62 38 L66 40 L52 46" /></svg>
    <div class="sq-flash" aria-hidden="true"></div>
    <div class="sq-band teaser" aria-hidden="true"><span class="sq-word">ぽっちチャンス</span></div>
  {/if}
  {#if stage === 'develop' && plan.particle !== 'none'}
    <div class="sq-parts pt-{plan.particle}" aria-hidden="true">
      {#each SPECKS as p}<i style="--x:{p.x}px;--y:{p.y}px;--d:{p.d}s;--dur:{p.dur}s;--s:{p.s}px;--h:{p.h}"></i>{/each}
    </div>
  {/if}
  <div class="sq-tile gl-{halo}" class:zoom={zoomed} class:float={stage === 'develop'} class:burst={stage === 'result' && rphase !== 'miss' && rphase !== 'word'} class:flipped
    style="--gc:{halo >= 0 ? GLOW_CSS[halo] : 'transparent'};--ring:{halo >= 0 && halo < 5 ? GLOW_CSS[halo] : '#fff'}">
    <div class="sq-halo" class:pu-slow={pulsing && stage !== 'result' && plan.pulse === 'slow'} class:pu-fast={pulsing && stage !== 'result' && plan.pulse === 'fast'}
      class:pu-hold={pulsing && stage !== 'result' && (plan.pulse === 'hold' || plan.pulse === 'blink')} class:dark class:frozen class:rainbow={halo === 5}></div>
    {#if !flipped}
      <div class="sq-cover"></div>
    {:else if resultColor}
      {#if deka}
        <img class="sq-pin" src={`/tiles/${deka === 'p1' ? 'Pin1' : 'Pin2'}.svg`} alt="" draggable="false" />
      {:else}
        <svg class="sq-face" viewBox="0 0 300 400" aria-hidden="true"><circle cx="150" cy="200" r="30" fill={POCHI_DOT[fakeMiss ? 'red' : resultColor]} /></svg>
      {/if}
    {/if}
    {#if plan.premium === 'kirin' && stage === 'glow'}<div class="sq-kirin" aria-hidden="true"></div>{/if}
    {#if showCracks && cracks.length}
      <svg class="sq-cracks" viewBox="0 0 100 133" preserveAspectRatio="none" aria-hidden="true">
        {#each cracks as d, i}<path {d} style="animation-delay:{i * 0.07}s" />{/each}
      </svg>
    {/if}
    {#if stage === 'result' && rphase === 'burst'}<div class="sq-burst" aria-hidden="true"></div>{/if}
  </div>
  {#if stage === 'push'}
    <div class="sq-pushwrap">
      {#if readOnly}
        <button type="button" class="sq-push pk-{PUSH_LOOK[plan.push]}" data-testid="pochi-push" disabled aria-label={`${who} を待っています`}>待ち</button>
      {:else}
        <button type="button" class="sq-push pk-{PUSH_LOOK[plan.push]}" data-testid="pochi-push" on:pointerdown|stopPropagation on:click|stopPropagation={doPush}>PUSH</button>
      {/if}
    </div>
  {/if}
  {#if stage === 'kakutei'}
    <div class="sq-band" class:grey={kakutei === 'bad'}><span class="sq-word">確定</span><span class="sq-tag">{kakutei === 'good' ? '正のぽっち' : '逆のぽっち'}</span></div>
  {/if}
  {#if stage === 'result'}
    {#if rphase === 'miss'}
      <svg class="sq-crack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 40 L38 22 L41 8 M50 40 L66 25 L70 6 M50 40 L30 48 L10 44 M50 40 L72 52 L94 50 M50 40 L44 64 L36 90 M50 40 L60 66 L68 92" /></svg>
      <div class="sq-band reveal grey"><span class="sq-word">{fakeText.word}</span><span class="sq-tag">{fakeText.tag}</span></div>
    {:else if rphase === 'word'}
      <div class="sq-matada" aria-hidden="true">まだや！</div>
    {:else if rphase === 'reveal' && text}
      {#if !good}<svg class="sq-crack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 40 L38 22 L41 8 M50 40 L66 25 L70 6 M50 40 L30 48 L10 44 M50 40 L72 52 L94 50 M50 40 L44 64 L36 90 M50 40 L60 66 L68 92" /></svg>{/if}
      <div class="sq-band reveal" class:grey={!good}><span class="sq-word">{text.word}</span><span class="sq-tag">{text.tag}</span></div>
    {/if}
  {/if}
</div>

<style>
  .sq { position: fixed; inset: 0; z-index: 9999; background: rgba(4, 8, 6, 0.78); user-select: none; outline: none; overflow: hidden; transition: background 0.4s; }
  .sq.dev { background: rgba(0, 0, 0, 0.94); }
  .sq.bad { background: rgba(0, 0, 0, 0.8); }
  /* 横持ちでは牌が上まで来るので、名前は牌の左に出す (上に置くと牌に隠れる) */
  .sq-who { position: absolute; z-index: 2; left: max(16px, 3vw); top: 42%; transform: translateY(-50%); max-width: calc(50% - min(23vw, 105px) - 24px); overflow: hidden; text-overflow: ellipsis; padding: 3px 14px; background: #111; color: #fff; font: 700 clamp(13px, 2vw, 18px) 'Zen Kaku Gothic New', sans-serif; letter-spacing: 0.08em; white-space: nowrap; }
  .sq-tile { position: absolute; left: 50%; top: 42%; width: min(46vw, 210px); aspect-ratio: 3 / 4; transform: translate(-50%, -50%); border-radius: 14px;
    background: linear-gradient(#fffdf6, #efe8d2); border: 2px solid #d9cfae; box-shadow: 0 10px 0 #c9bf9f, 0 16px 34px rgba(0, 0, 0, 0.6); transition: transform 0.5s ease-out, box-shadow 0.3s; }
  .sq-tile:not(.gl--1) { box-shadow: 0 10px 0 #c9bf9f, 0 0 0 6px var(--ring, #fff); }
  .sq-tile.zoom { transform: translate(-50%, -50%) scale(1.18); }
  .sq-tile.float { animation: sqFloat 1.6s ease-in-out infinite; }
  @keyframes sqFloat { 0%, 100% { transform: translate(-50%, -50%) scale(1.08); } 50% { transform: translate(-50%, calc(-50% - 10px)) scale(1.1); } }
  .sq-tile.burst { animation: sqBurst 0.5s cubic-bezier(0.2, 1.6, 0.4, 1); }
  @keyframes sqBurst { 0% { transform: translate(-50%, -50%) scale(0.9); } 45% { transform: translate(-50%, -50%) scale(1.3); } 100% { transform: translate(-50%, -50%) scale(1); } }
  .sq-burst { position: absolute; inset: -30%; border-radius: 50%; background: radial-gradient(circle, #fff 0, rgba(255, 255, 255, 0.7) 30%, transparent 70%); animation: sqBurstFlash 0.5s ease-out forwards; pointer-events: none; z-index: 3; }
  @keyframes sqBurstFlash { from { opacity: 1; transform: scale(0.4); } to { opacity: 0; transform: scale(1.6); } }
  /* 光り: 牌の後ろの層。色は --gc。動かすのは opacity と transform だけ */
  .sq-halo { position: absolute; inset: -18px; border-radius: 30px; background: var(--gc, transparent); filter: blur(16px); opacity: 0.85; z-index: -1; pointer-events: none; transition: opacity 0.12s; }
  .sq-tile.gl--1 .sq-halo { opacity: 0; }
  .sq-halo.rainbow { animation: sqSpinHalo 2s linear infinite; }
  @keyframes sqSpinHalo { to { transform: rotate(360deg); } }
  .sq-halo.pu-slow { animation: sqPuSlow 1.8s ease-in-out infinite; }
  .sq-halo.pu-fast { animation: sqPuFast 0.42s ease-in-out infinite; }
  .sq-halo.pu-hold { opacity: 1; inset: -26px; }
  .sq-halo.rainbow.pu-slow { animation: sqPuSlow 1.8s ease-in-out infinite, sqSpinHalo 2s linear infinite; }
  .sq-halo.rainbow.pu-fast { animation: sqPuFast 0.42s ease-in-out infinite, sqSpinHalo 2s linear infinite; }
  .sq-halo.dark { opacity: 0.04; transition: opacity 0.05s; }
  .sq-halo.frozen, .sq-halo.frozen.rainbow { animation-play-state: paused; }
  @keyframes sqPuSlow { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
  @keyframes sqPuFast { 0%, 100% { opacity: 0.5; scale: 1; } 35% { opacity: 1; scale: 1.1; } 55% { opacity: 0.7; scale: 1.02; } 75% { opacity: 1; scale: 1.08; } }
  .sq-cover { position: absolute; inset: -2px; border-radius: 14px; background: url('/tiles/Back.svg') center / 100% 100%; pointer-events: none; }
  .sq-face, .sq-pin { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .sq-pin { transform: scale(0.68); }
  /* キリン柄: 牌の背に茶色の斑 (光りの段だけ) */
  .sq-kirin { position: absolute; inset: -2px; border-radius: 14px; pointer-events: none; mix-blend-mode: multiply; opacity: 0.85;
    background:
      radial-gradient(ellipse 18% 13% at 22% 18%, #7a4a1a 92%, transparent 100%), radial-gradient(ellipse 14% 17% at 62% 12%, #8a5520 92%, transparent 100%),
      radial-gradient(ellipse 17% 12% at 84% 30%, #7a4a1a 92%, transparent 100%), radial-gradient(ellipse 13% 16% at 38% 40%, #8a5520 92%, transparent 100%),
      radial-gradient(ellipse 19% 13% at 72% 52%, #7a4a1a 92%, transparent 100%), radial-gradient(ellipse 14% 15% at 16% 62%, #8a5520 92%, transparent 100%),
      radial-gradient(ellipse 16% 12% at 48% 70%, #7a4a1a 92%, transparent 100%), radial-gradient(ellipse 13% 15% at 84% 80%, #8a5520 92%, transparent 100%),
      radial-gradient(ellipse 17% 11% at 26% 88%, #7a4a1a 92%, transparent 100%), radial-gradient(ellipse 12% 14% at 62% 90%, #8a5520 92%, transparent 100%),
      #d9a85b; }
  /* ひび: 白と金の細い線 (顔は隠れたまま) */
  .sq-cracks { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; }
  .sq-cracks path { fill: none; stroke: #fff6c8; stroke-width: 1.4px; vector-effect: non-scaling-stroke; stroke-dasharray: 400; stroke-dashoffset: 400; animation: sqDraw 0.45s ease-out forwards; filter: drop-shadow(0 0 3px #f2c23a); }
  /* 粒子: 牌の真ん中 (42%) が原点 */
  .sq-parts { position: absolute; left: 50%; top: 42%; width: 0; height: 0; pointer-events: none; z-index: 1; }
  .sq-parts i { position: absolute; left: 0; top: 0; width: var(--s); height: var(--s); margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2); border-radius: 50%; background: #ffe9a0; box-shadow: 0 0 10px 3px rgba(255, 220, 120, 0.9); opacity: 0; animation-delay: var(--d); animation-duration: var(--dur); animation-iteration-count: infinite; animation-timing-function: ease-out; }
  .pt-float i { animation-name: sqFloatUp; }
  .pt-suck i { animation-name: sqSuck; background: #bfe6ff; box-shadow: 0 0 10px 3px rgba(140, 200, 255, 0.9); }
  .pt-rainbow i { animation-name: sqFloatUp; background: hsl(var(--h) 100% 65%); box-shadow: 0 0 10px 3px hsl(var(--h) 100% 65%); }
  @keyframes sqFloatUp { 0% { opacity: 0; transform: translate(var(--x), calc(var(--y) + 50px)); } 25% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--x), calc(var(--y) - 130px)); } }
  @keyframes sqSuck { 0% { opacity: 0; transform: translate(calc(var(--x) * 1.5), calc(var(--y) * 1.5)) scale(1); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(0, 0) scale(0.2); } }
  /* PUSH: 牌の右。名前は左 */
  .sq-pushwrap { position: absolute; z-index: 8; left: calc(50% + min(23vw, 105px) * 1.2 + 22px); top: 42%; transform: translateY(-50%); }
  .sq-push { width: clamp(84px, 19vmin, 132px); height: clamp(84px, 19vmin, 132px); border-radius: 50%; border: 4px solid #fff; cursor: pointer; font: 900 clamp(18px, 4.4vmin, 30px) 'Zen Kaku Gothic New', sans-serif; letter-spacing: 0.06em;
    color: #333; background: radial-gradient(circle at 35% 30%, #fff, #c9ccd2 75%); box-shadow: 0 6px 0 #6d717a, 0 0 24px rgba(255, 255, 255, 0.5); animation: sqPushIn 0.35s cubic-bezier(0.2, 1.7, 0.4, 1) both, sqPushBeat 1.1s ease-in-out 0.4s infinite; }
  .sq-push:active { transform: translateY(4px); box-shadow: 0 2px 0 #6d717a; }
  .sq-push.pk-1 { color: #fff; background: radial-gradient(circle at 35% 30%, #ff8a8a, #e0262a 75%); box-shadow: 0 6px 0 #7d1114, 0 0 28px rgba(255, 60, 60, 0.8); -webkit-text-stroke: 2px #7d1114; paint-order: stroke fill; }
  .sq-push.pk-2 { color: #fff; background: radial-gradient(circle at 35% 30%, #fff1a8, #e0a21c 75%); box-shadow: 0 6px 0 #7a5410, 0 0 30px rgba(255, 200, 70, 0.9); -webkit-text-stroke: 2px #7a5410; paint-order: stroke fill; }
  .sq-push.pk-3 { color: #fff; background: conic-gradient(#ff3b3b, #ffd23b, #3bff8a, #3bb8ff, #c63bff, #ff3b3b); box-shadow: 0 6px 0 #3a2a5a, 0 0 32px rgba(180, 140, 255, 0.9); -webkit-text-stroke: 3px #3a2a5a; paint-order: stroke fill; }
  .sq-push:disabled { cursor: default; opacity: 0.8; animation: sqPushIn 0.35s cubic-bezier(0.2, 1.7, 0.4, 1) both; font-size: clamp(16px, 3.6vmin, 24px); }
  @keyframes sqPushIn { from { opacity: 0; scale: 0.3; } to { opacity: 1; scale: 1; } }
  /* 鼓動は大きさでなく明るさで (大きさを動かすと押す瞬間に位置がずれる) */
  @keyframes sqPushBeat { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.18) drop-shadow(0 0 10px rgba(255, 255, 255, 0.9)); } }
  .sq-matada { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); z-index: 6; white-space: nowrap; font-family: 'FX Kana', 'Zen Kaku Gothic New', sans-serif; font-size: clamp(40px, 12vw, 130px); color: #ffe27a;
    -webkit-text-stroke: 6px #111; paint-order: stroke fill; text-shadow: 0 0 24px rgba(255, 200, 70, 0.9); animation: sqPop 0.3s cubic-bezier(0.2, 1.7, 0.4, 1) both; }
  .sq-rays { position: absolute; left: 50%; top: 42%; width: 220vmax; height: 220vmax; margin: -110vmax 0 0 -110vmax; border-radius: 50%; pointer-events: none;
    background: repeating-conic-gradient(#ff3b3b 0 6deg, transparent 6deg 12deg, #ffd23b 12deg 18deg, transparent 18deg 24deg, #3bff8a 24deg 30deg, transparent 30deg 36deg, #3bb8ff 36deg 42deg, transparent 42deg 48deg, #c63bff 48deg 54deg, transparent 54deg 60deg);
    -webkit-mask: radial-gradient(circle, #000 6%, transparent 50%); mask: radial-gradient(circle, #000 6%, transparent 50%); animation: sqSpin 5s linear infinite; opacity: 0.9; }
  .sq-premium { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); white-space: nowrap; z-index: 3; font-family: 'FX Kana', 'Zen Kaku Gothic New', sans-serif; font-size: clamp(34px, 10vw, 120px);
    background: linear-gradient(90deg, #ff3b3b, #ffd23b, #3bff8a, #3bb8ff, #c63bff); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 2px #fff;
    filter: drop-shadow(0 0 16px rgba(255, 255, 255, 0.8)); animation: sqPop 0.4s cubic-bezier(0.2, 1.7, 0.4, 1) both; }
  @keyframes sqPop { 0% { opacity: 0; scale: 2; } 100% { opacity: 1; scale: 1; } }
  @keyframes sqSpin { to { transform: rotate(360deg); } }
  /* 予告の稲妻 (上から牌の真ん中 = 42% へ) */
  .sq-bolt { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .sq-bolt path { fill: none; stroke: #fff; stroke-width: 7px; stroke-linejoin: round; vector-effect: non-scaling-stroke;
    stroke-dasharray: 2000; stroke-dashoffset: 2000; animation: sqBoltDraw 0.3s linear forwards, sqBoltFade 0.5s ease-out 2s forwards;
    filter: drop-shadow(0 0 8px #8fd0ff) drop-shadow(0 0 20px #4a8cff); }
  .sq-flash { position: absolute; inset: 0; background: #fff; opacity: 0; z-index: 5; pointer-events: none; animation: sqFlash 0.45s ease-out 0.25s; }
  /* [10-15「出てくるのが高速すぎて」] 予告の帯は稲妻が落ちきってから 0.5 秒かけて入り、字も 0.6 秒で座る */
  .sq-band.teaser { top: 70%; --h: clamp(60px, 13vh, 110px); --fs: calc(min(8vw, 76px, var(--h) * 0.6)); z-index: 6; animation-delay: 0.5s; animation-duration: 0.5s; }
  .sq-band.teaser .sq-word { animation-delay: 0.6s; animation-duration: 0.6s; }
  /* 決め台詞のカットイン: ピンクの斜めの帯が右から入り、1.8 秒で左へ抜ける。字は Dela Gothic One (CI Line) */
  .sq-ci { position: absolute; left: -10%; right: -10%; top: 42%; height: clamp(90px, 24vh, 200px); margin-top: calc(clamp(90px, 24vh, 200px) / -2); z-index: 6; overflow: hidden;
    display: flex; align-items: center; justify-content: center; transform: rotate(-6deg); pointer-events: none;
    background: repeating-linear-gradient(100deg, rgba(255, 255, 255, 0.07) 0 3px, transparent 3px 42px), linear-gradient(180deg, #120612 0 6%, #c2185b 6% 50%, #7b0e3c 50% 94%, #120612 94%);
    box-shadow: 0 0 0 4px #fff inset, 0 12px 34px rgba(0, 0, 0, 0.6); animation: sqCiIn 0.35s cubic-bezier(0.2, 0.9, 0.2, 1) both, sqCiOut 0.3s ease-in 1.8s forwards; }
  .sq-ci-speed { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, transparent 0 18px, rgba(255, 255, 255, 0.16) 18px 20px); }
  .sq-ci-line { position: relative; font-family: 'CI Line', 'FX Kana', 'Zen Kaku Gothic New', sans-serif; font-size: clamp(30px, 8.4vw, 96px); color: #fff; white-space: nowrap;
    -webkit-text-stroke: clamp(4px, 0.6vw, 7px) #120612; paint-order: stroke fill; text-shadow: 5px 5px 0 #3a0820; transform: skewX(-8deg); animation: sqCiWord 0.45s cubic-bezier(0.2, 1.6, 0.4, 1) 0.2s both; }
  .sq-ci-sig { position: absolute; right: 16%; bottom: 8%; font: 700 clamp(12px, 2.2vw, 24px) 'Zen Kaku Gothic New', sans-serif; color: #ffd1e6; letter-spacing: 0.2em; }
  .sq-band.teaser.line, .sq-band.teaser.line .sq-word { animation-delay: 2s; }
  @keyframes sqCiIn { from { transform: rotate(-6deg) translateX(110%); } to { transform: rotate(-6deg) translateX(0); } }
  @keyframes sqCiOut { to { transform: rotate(-6deg) translateX(-110%); } }
  @keyframes sqCiWord { 0% { opacity: 0; transform: skewX(-8deg) scale(2.2); } 100% { opacity: 1; transform: skewX(-8deg) scale(1); } }
  @keyframes sqBoltDraw { to { stroke-dashoffset: 0; } }
  @keyframes sqBoltFade { to { opacity: 0; } }
  @keyframes sqFlash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
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
  @media (prefers-reduced-motion: reduce) {
    .sq-band, .sq-word, .sq-crack path, .sq-cracks path, .sq-rays, .sq-ci-line, .sq-push, .sq-halo, .sq-tile.float, .sq-tile.burst, .sq-parts i, .sq-matada { animation: none; }
    .sq-crack path, .sq-cracks path { stroke-dashoffset: 0; }
  }
  /* [2026-10-15 fx10 L1] 告知ランプ = 画面の外周。点いた瞬間に白く光り、金の縁が脈打つ。
     影の大きさは動かさず、重ねた 2 枚の opacity だけを動かす (影を毎こま描き直すと録画もスマホも重い) */
  .sq-edge { position: absolute; inset: 0; z-index: 7; pointer-events: none;
    box-shadow: inset 0 0 0 6px #ffd23b, inset 0 0 70px 26px rgba(255, 170, 30, 0.8), inset 0 0 160px 40px rgba(255, 120, 0, 0.3); }
  .sq-edge::before { content: ''; position: absolute; inset: 0; box-shadow: inset 0 0 0 10px #fff3b0, inset 0 0 110px 44px rgba(255, 200, 60, 0.95);
    opacity: 0; animation: sqEdgePulse 0.6s ease-in-out 0.35s infinite alternate; will-change: opacity; }
  .sq-edge-run { position: absolute; inset: 0; box-shadow: inset 0 0 0 36px #fff, inset 0 0 220px 90px rgba(255, 255, 255, 0.9);
    animation: sqEdgeFlash 0.4s ease-out forwards; will-change: opacity; }
  @keyframes sqEdgePulse { to { opacity: 1; } }
  @keyframes sqEdgeFlash { to { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .sq-edge::before { animation: none; opacity: 0.6; } .sq-edge-run { animation: none; opacity: 0; } }
  /* [2026-10-15 fx5 V3] 白黒の予告: 幕を薄くして卓を見せ、卓の色を抜く。牌 (上の層) は色のまま光る */
  .sq.mono { background: rgba(4, 8, 6, 0.3); transition: background 0.2s; }
  .sq-mono { position: absolute; inset: 0; z-index: 1; backdrop-filter: grayscale(1) contrast(1.35) brightness(0.75); animation: sqMono 3s ease-out both; pointer-events: none; }
  .sq-mono-scan { position: absolute; left: 0; right: 0; height: 18%; top: -20%; background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.35), transparent); animation: sqScan 1.4s linear 0.2s 2; }
  @keyframes sqMono { 0% { opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes sqScan { 0% { top: -20%; } 100% { top: 105%; } }
  .sq-band.teaser.mono { filter: grayscale(1) contrast(1.4); }
</style>
