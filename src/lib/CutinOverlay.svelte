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
      <div class="cutin-band">
        <div class="cutin-line line-top"></div>
        <div class="cutin-text">{LABELS[cutin.id]}</div>
        <div class="cutin-line line-bottom"></div>
        <div class="cutin-sheen"></div>
      </div>
      {#if cutin.id === 'fever'}
        <div class="cutin-flash"></div>
      {/if}
    </div>
  {/key}
{/if}

<style>
  /* 2026-07-20 リョー指摘 [ダサい/カラフル過ぎ] で刷新:
     原色グラデ帯+白ストライプ → 黒帯+差し色1色の静かな作りへ。
     表示時間 1.8s は App/store のタイマー [1850ms] と対なので変えない */
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

  .cutin-reach { --accent: #d9b453; }
  .cutin-ron { --accent: #d24054; }
  .cutin-tsumo { --accent: #5b9bd5; }
  .cutin-fever { --accent: #e09a3e; }

  .cutin-band {
    position: relative;
    width: 100vw;
    min-height: clamp(110px, 18vh, 170px);
    display: grid;
    grid-template-rows: auto 1fr auto;
    place-items: center;
    padding: 10px 0;
    overflow: hidden;
    background: linear-gradient(
      180deg,
      rgba(6, 8, 12, 0) 0%,
      rgba(6, 8, 12, 0.88) 16%,
      rgba(6, 8, 12, 0.88) 84%,
      rgba(6, 8, 12, 0) 100%
    );
    animation: bandIn 1.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }

  .cutin-line {
    width: min(66vw, 640px);
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    opacity: 0.85;
    animation: lineGrow 1.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }

  .cutin-text {
    color: #f4f2ec;
    font-weight: 800;
    font-size: clamp(46px, 8.5vw, 110px);
    line-height: 1.2;
    letter-spacing: 0.22em;
    padding-left: 0.22em;
    white-space: nowrap;
    text-shadow:
      0 1px 2px rgba(0, 0, 0, 0.8),
      0 0 26px color-mix(in srgb, var(--accent) 45%, transparent);
    animation: textIn 1.8s ease-out forwards;
  }

  /* 一度だけ通る控えめな光沢 */
  .cutin-sheen {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      100deg,
      transparent 42%,
      rgba(255, 255, 255, 0.09) 50%,
      transparent 58%
    );
    transform: translateX(-120%);
    animation: sheenSweep 1.0s ease-out 0.3s forwards;
  }

  .cutin-flash {
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.22);
    mix-blend-mode: screen;
    animation: feverFlash 1.8s ease-out forwards;
  }

  .from-left .cutin-band { --slide-x: -34vw; --slide-y: 0; }
  .from-right .cutin-band { --slide-x: 34vw; --slide-y: 0; }
  .from-bottom .cutin-band { --slide-x: 0; --slide-y: 22vh; }
  .cutin-fever .cutin-band { --slide-x: 0; --slide-y: 0; }

  @keyframes cutinFade {
    0% { opacity: 0; }
    8% { opacity: 1; }
    80% { opacity: 1; }
    100% { opacity: 0; }
  }

  @keyframes bandIn {
    0% { transform: translate(var(--slide-x, 0), var(--slide-y, 0)); }
    16% { transform: translate(0, 0); }
    82% { transform: translate(0, 0); }
    100% { transform: translate(calc(var(--slide-x, 0) * -0.12), calc(var(--slide-y, 0) * -0.1)); }
  }

  @keyframes textIn {
    0% { opacity: 0; letter-spacing: 0.34em; }
    14% { opacity: 1; letter-spacing: 0.22em; }
    100% { opacity: 1; letter-spacing: 0.22em; }
  }

  @keyframes lineGrow {
    0% { transform: scaleX(0); }
    18% { transform: scaleX(1); }
    100% { transform: scaleX(1); }
  }

  @keyframes sheenSweep {
    0% { transform: translateX(-120%); }
    100% { transform: translateX(120%); }
  }

  @keyframes feverFlash {
    0% { opacity: 0; }
    10% { opacity: 0.5; }
    24% { opacity: 0; }
    100% { opacity: 0; }
  }
</style>
