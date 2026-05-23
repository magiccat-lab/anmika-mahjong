<script lang="ts">
  import { game as gameStore } from './store';
  import type { CutinPayload } from './store';

  export let cutin: CutinPayload | null;

  const LABELS: Record<CutinPayload['id'], string> = {
    reach: 'リーチ！',
    ron: 'ロン！',
    tsumo: 'ツモ！',
    fever: 'フィーバー！',
  };

  function seatClass(seat?: 0 | 1 | 2): string {
    if (seat === 1) return 'from-left';
    if (seat === 2) return 'from-right';
    return 'from-bottom';
  }

  // cutin が変わるたびに animation 終了後 [1.8s] に finish + 次の queue を play
  // 2026-05-16 fix: 旧 codex 2 周目で enqueue/finish のペアリングが App.svelte 側で
  // 配線されてなかった、 ここで self-contained に lifecycle を回す
  import { onDestroy } from 'svelte';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pumpTimer: ReturnType<typeof setTimeout> | undefined;
  $: if (cutin) {
    if (timer) clearTimeout(timer);
    const ts = cutin.ts;
    timer = setTimeout(() => {
      gameStore.finishCutin(ts);
      // 次の cutin を pump、 queue 残ってれば即 再生
      pumpTimer = setTimeout(() => gameStore.playNextCutin(), 30);
    }, 1850);
  }
  onDestroy(() => {
    if (timer) clearTimeout(timer);
    if (pumpTimer) clearTimeout(pumpTimer);
  });
</script>

{#if cutin}
  {#key cutin.ts}
    <div class="cutin-overlay cutin-{cutin.id} {seatClass(cutin.seat)}" aria-hidden="true">
      <div class="cutin-stripes"></div>
      <div class="cutin-band">
        <div class="cutin-text">{LABELS[cutin.id]}</div>
      </div>
      {#if cutin.id === 'fever'}
        <div class="cutin-flash"></div>
      {/if}
    </div>
  {/key}
{/if}

<style>
  .cutin-overlay {
    position: fixed;
    inset: 0;
    z-index: 800;
    pointer-events: none;
    display: grid;
    place-items: center;
    overflow: hidden;
    opacity: 0;
    animation: cutinFade 1.8s ease-in-out forwards;
  }

  .cutin-band {
    position: relative;
    width: min(100vw, 980px);
    min-height: clamp(120px, 23vh, 230px);
    display: grid;
    place-items: center;
    transform: skew(-9deg);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.38);
    animation: bandHit 1.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }

  .cutin-text {
    transform: skew(9deg);
    color: #fff;
    font-weight: 900;
    font-size: clamp(58px, 13vw, 172px);
    line-height: 1;
    text-shadow:
      0 5px 0 rgba(0, 0, 0, 0.34),
      0 0 18px rgba(255, 255, 255, 0.55),
      -4px -4px 0 rgba(0, 0, 0, 0.65),
      4px -4px 0 rgba(0, 0, 0, 0.65),
      -4px 4px 0 rgba(0, 0, 0, 0.65),
      4px 4px 0 rgba(0, 0, 0, 0.65);
    letter-spacing: 0;
    white-space: nowrap;
    animation: textPop 1.8s ease-out forwards;
  }

  .cutin-stripes {
    position: absolute;
    inset: -20%;
    opacity: 0.52;
    background:
      repeating-linear-gradient(
        115deg,
        rgba(255, 255, 255, 0),
        rgba(255, 255, 255, 0) 18px,
        rgba(255, 255, 255, 0.42) 19px,
        rgba(255, 255, 255, 0.42) 23px
      );
    animation: stripeRun 1.8s linear forwards;
  }

  .cutin-reach .cutin-band {
    background: linear-gradient(90deg, rgba(160, 108, 0, 0.92), rgba(255, 209, 44, 0.96), rgba(238, 134, 24, 0.92));
  }

  .cutin-ron .cutin-band {
    background: linear-gradient(90deg, rgba(103, 12, 24, 0.96), rgba(224, 33, 54, 0.97), rgba(105, 0, 26, 0.96));
  }

  .cutin-tsumo .cutin-band {
    background: linear-gradient(90deg, rgba(11, 63, 121, 0.96), rgba(17, 151, 211, 0.97), rgba(18, 83, 181, 0.96));
  }

  .cutin-fever {
    background: radial-gradient(circle at center, rgba(255, 255, 255, 0.36), rgba(255, 69, 104, 0.22) 28%, rgba(255, 174, 0, 0.18) 52%, transparent 74%);
  }

  .cutin-fever .cutin-band {
    background: linear-gradient(90deg, rgba(225, 31, 116, 0.95), rgba(255, 123, 35, 0.98), rgba(255, 225, 61, 0.95));
  }

  .cutin-flash {
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.5);
    mix-blend-mode: screen;
    animation: feverFlash 1.8s ease-out forwards;
  }

  .from-left .cutin-band { --slide-x: -42vw; --slide-y: 0; }
  .from-right .cutin-band { --slide-x: 42vw; --slide-y: 0; }
  .from-bottom .cutin-band { --slide-x: 0; --slide-y: 28vh; }
  .cutin-fever .cutin-band { --slide-x: 0; --slide-y: 0; }

  @keyframes cutinFade {
    0% { opacity: 0; }
    8% { opacity: 1; }
    78% { opacity: 1; }
    100% { opacity: 0; }
  }

  @keyframes bandHit {
    0% { transform: translate(var(--slide-x, 0), var(--slide-y, 0)) skew(-9deg) scale(0.86); }
    13% { transform: translate(0, 0) skew(-9deg) scale(1.04); }
    22% { transform: translate(0, 0) skew(-9deg) scale(1); }
    78% { transform: translate(0, 0) skew(-9deg) scale(1); }
    100% { transform: translate(calc(var(--slide-x, 0) * -0.22), calc(var(--slide-y, 0) * -0.18)) skew(-9deg) scale(0.96); }
  }

  @keyframes textPop {
    0% { transform: skew(9deg) scale(0.74); filter: blur(3px); }
    12% { transform: skew(9deg) scale(1.08); filter: blur(0); }
    24% { transform: skew(9deg) scale(1); }
    100% { transform: skew(9deg) scale(1); }
  }

  @keyframes stripeRun {
    0% { transform: translateX(-8%); }
    100% { transform: translateX(12%); }
  }

  @keyframes feverFlash {
    0% { opacity: 0; }
    8% { opacity: 0.8; }
    18% { opacity: 0; }
    32% { opacity: 0.42; }
    48% { opacity: 0; }
    100% { opacity: 0; }
  }
</style>
