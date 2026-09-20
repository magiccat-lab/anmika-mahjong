<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { CUTIN_TIER, cutinDurationMs, type CutinPayload } from './store';

  export let cutin: CutinPayload | null;

  const dispatch = createEventDispatcher<{ skip: { ts: number } }>();

  // [2026-09-20 リョー選択 E+F] 全幅の黒帯 + 巨大文字 (現行) をやめ、
  // 宣言した席の側に寄せた小さい帯 (案 F) と、その席から広がる光の輪 (案 E) にした。
  // 文字は読める最小限。卓の中央は覆わない (原則 2)。
  const LABELS: Record<CutinPayload['id'], string> = {
    reach: 'リーチ',
    ron: 'ロン',
    tsumo: 'ツモ',
    fever: 'フィーバー',
    kan: 'カン',
    pon: 'ポン',
  };

  /** 演出の起点。P1 が上家 (左端)、P2 が下家 (右端)、それ以外は自分 (下)。 */
  function seatClass(seat?: 0 | 1 | 2): string {
    if (seat === 1) return 'from-left';
    if (seat === 2) return 'from-right';
    return 'from-bottom';
  }

  $: tier = cutin ? CUTIN_TIER[cutin.id] : 'light';
  $: durationMs = cutinDurationMs(cutin?.id);
  // スキップできるのは 重 だけ (原則 6)。軽と中は 0.7〜1.2 秒で消えるので
  // 触れるようにすると打牌のタップを食う
  $: skippable = tier === 'heavy';

  function onSkip(): void {
    if (cutin && skippable) dispatch('skip', { ts: cutin.ts });
  }

  // [2026-07-23 Sol調査: ポッチ演出割り込み] finish/pump のタイマーは App.svelte が
  // 単一所有者。この component は表示と「スキップしたい」の通知だけで、
  // 自分では queue を進めない (二重管理で演出が食われた事故がある)
</script>

{#if cutin}
  {#key cutin.ts}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div
      class="fx fx-{cutin.id} fx-{tier} {seatClass(cutin.seat)}"
      class:fx-skippable={skippable}
      style="--fx-dur: {durationMs}ms"
      aria-hidden="true"
      on:click={onSkip}
    >
      <div class="fx-ring ring-a"></div>
      <div class="fx-ring ring-b"></div>
      <div class="fx-band"><span class="fx-text">{LABELS[cutin.id]}</span></div>
    </div>
  {/key}
{/if}

<style>
  /* 2026-09-20 演出ゼロベース再検討 (リョー選択 E+F)。
     原則: 事実が先・卓を隠さない・軽中重の3段・色は金1つ・transform と opacity だけ。
     mix-blend / filter / blur は使わない (スマホで一番重い描画だった) */
  .fx {
    position: fixed;
    inset: 0;
    z-index: 800;
    pointer-events: none;
    overflow: hidden;
    /* 起点。席ごとに上書きする */
    --fx-x: 50%;
    --fx-y: 76%;
    --accent: #d9b453;
  }
  .fx-skippable { pointer-events: auto; cursor: pointer; }

  /* 色は金 1 つ (原則 4)。カン/ポンの青緑は廃止した */
  .fx-fever { --accent: #e0a53e; }

  .from-left { --fx-x: 6%; --fx-y: 50%; --band-x: -16px; }
  .from-right { --fx-x: 94%; --fx-y: 50%; --band-x: 16px; }
  .from-bottom { --fx-x: 28%; --fx-y: 78%; --band-x: 0; }

  /* --- E 光の輪: 席から広がる。transform と opacity だけ --- */
  .fx-ring {
    position: absolute;
    left: var(--fx-x);
    top: var(--fx-y);
    width: 26vmin;
    height: 26vmin;
    margin: -13vmin 0 0 -13vmin;
    border: 1px solid var(--accent);
    border-radius: 50%;
    opacity: 0;
    transform: scale(0.25);
    animation: fxRing var(--fx-dur) cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  .ring-b { animation-delay: 120ms; }

  /* --- F 現行の圧縮版: 帯を 1/3 にして宣言席の側へ寄せる --- */
  .fx-band {
    position: absolute;
    left: var(--fx-x);
    top: var(--fx-y);
    transform: translate(-50%, -50%);
    padding: 0.28em 1.1em;
    border-left: 2px solid var(--accent);
    background: rgba(6, 8, 12, 0.82);
    opacity: 0;
    animation: fxBand var(--fx-dur) cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  .from-left .fx-band { transform: translate(-10%, -50%); }
  .from-right .fx-band { transform: translate(-90%, -50%); border-left: none; border-right: 2px solid var(--accent); }

  .fx-text {
    color: #f4f2ec;
    font-weight: 700;
    /* 現行は 46〜110px。読める最小限まで落として卓を隠さない */
    font-size: clamp(18px, 3.4vw, 30px);
    letter-spacing: 0.16em;
    padding-left: 0.16em;
    white-space: nowrap;
  }
  /* 重 (フィーバー) だけ一段大きい */
  .fx-heavy .fx-text { font-size: clamp(26px, 5vw, 46px); }
  .fx-heavy .fx-ring { width: 40vmin; height: 40vmin; margin: -20vmin 0 0 -20vmin; }

  @keyframes fxRing {
    0% { opacity: 0; transform: scale(0.25); }
    18% { opacity: 0.85; }
    100% { opacity: 0; transform: scale(1.9); }
  }

  @keyframes fxBand {
    0% { opacity: 0; transform: translate(calc(-50% + var(--band-x, 0px)), -50%); }
    14% { opacity: 1; transform: translate(-50%, -50%); }
    78% { opacity: 1; transform: translate(-50%, -50%); }
    100% { opacity: 0; transform: translate(-50%, -50%); }
  }
  /* 左右寄せは基準位置が違うので、帯の keyframe を席ごとに上書きする */
  .from-left .fx-band { animation-name: fxBandLeft; }
  .from-right .fx-band { animation-name: fxBandRight; }

  @keyframes fxBandLeft {
    0% { opacity: 0; transform: translate(calc(-10% - 16px), -50%); }
    14% { opacity: 1; transform: translate(-10%, -50%); }
    78% { opacity: 1; transform: translate(-10%, -50%); }
    100% { opacity: 0; transform: translate(-10%, -50%); }
  }
  @keyframes fxBandRight {
    0% { opacity: 0; transform: translate(calc(-90% + 16px), -50%); }
    14% { opacity: 1; transform: translate(-90%, -50%); }
    78% { opacity: 1; transform: translate(-90%, -50%); }
    100% { opacity: 0; transform: translate(-90%, -50%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .fx-ring { animation: none; opacity: 0; }
  }
</style>
