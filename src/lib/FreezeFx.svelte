<script lang="ts">
  // [2026-10-15 fx6 の答え「パチ屋のフリーズもあっていい」→ fx7「これぽっちの演出に入れたい」] 白ぽっちを引いた瞬間に、
  // 画面と音が止まる「フリーズ」(当たりの確定。割合は pochiFx の FREEZE_RATE)。PochiSqueeze が予告の代わりに出す。
  // 止まっている間 (durationMs) は何も動かさない (ぽっちの演出の間は BGM も App が消している)。明けに白く光って「キュイン」が鳴り、絞りへ。
  //  - black: 画面がブラウン管を消した様に横の線に縮んで真っ暗になる
  //  - still: 卓がその場で止まり、色が抜けて走査線とノイズの帯が乗る (アニメも全部止める)
  import { onDestroy, onMount } from 'svelte';
  import { playSound } from './prefs';

  export let kind: 'black' | 'still' = 'black';
  export let durationMs = 1300;

  let paused: Animation[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (kind === 'still' && typeof document !== 'undefined' && 'getAnimations' in document) {
      // 卓で動いている物 (光る牌 ・ 札の明滅など) をその場で止める。自分の層の動きは止めない
      paused = document.getAnimations().filter((a) => {
        const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return a.playState === 'running' && !(el && el.closest('.fz'));
      });
      for (const a of paused) a.pause();
      // 色抜きは卓の根に掛ける (重ねた層の backdrop-filter は録画 ・ 一部の端末で効かなかった)
      document.body.classList.add('fz-still-on');
    }
    timer = setTimeout(() => { playSound('/sounds/fx/kyuin.mp3', 0.7); }, Math.max(0, durationMs - 120));
  });
  onDestroy(() => {
    if (timer !== null) clearTimeout(timer);
    for (const a of paused) { try { a.play(); } catch { /* 消えた要素は放っておく */ } }
    if (typeof document !== 'undefined') document.body.classList.remove('fz-still-on');
  });
</script>

<div class="fz fz-{kind}" style="--fz-dur: {durationMs}ms" aria-hidden="true">
  {#if kind === 'black'}
    <div class="fz-crt"></div>
  {:else}
    <div class="fz-scan"></div>
    <div class="fz-noise"></div>
  {/if}
  <div class="fz-flash"></div>
</div>

<style>
  .fz {
    position: fixed;
    inset: 0;
    z-index: 10050; /* 絞りの幕 (.sq 9999) の上 */
    pointer-events: auto; /* 止まっている間は卓を触らせない */
    overflow: hidden;
  }
  /* 暗転: 一瞬で黒。真ん中に白い横線が残って縮んで消える (0.32 秒) */
  .fz-black { background: #000; }
  .fz-crt {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 6px;
    margin-top: -3px;
    background: #fff;
    box-shadow: 0 0 18px 6px rgba(255, 255, 255, 0.8);
    animation: fzCrt 0.32s cubic-bezier(0.6, 0, 0.9, 0.4) both;
  }
  @keyframes fzCrt {
    0% { transform: scaleX(1) scaleY(30); opacity: 1; }
    35% { transform: scaleX(1) scaleY(1); opacity: 1; }
    85% { transform: scaleX(0.02) scaleY(1); opacity: 1; }
    100% { transform: scaleX(0); opacity: 0; }
  }
  /* 止め絵: 卓の上に色を抜く層、走査線、ときどき跳ねるノイズの帯 */
  :global(body.fz-still-on #app) { filter: grayscale(0.92) contrast(1.25) brightness(0.72); }
  .fz-scan {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(180deg, rgba(0, 0, 0, 0.18) 0 2px, transparent 2px 4px);
  }
  .fz-noise {
    position: absolute;
    left: 0;
    right: 0;
    height: 7%;
    background:
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.55) 0 3px, rgba(0, 0, 0, 0.35) 3px 7px, rgba(255, 255, 255, 0.2) 7px 12px);
    mix-blend-mode: screen;
    animation: fzNoise var(--fz-dur) steps(1, end) both;
  }
  @keyframes fzNoise {
    0% { top: 62%; opacity: 1; }
    9% { top: 18%; opacity: 0.8; }
    17% { top: 77%; opacity: 0; }
    46% { top: 34%; opacity: 1; }
    52% { top: 34%; opacity: 0; }
    78% { top: 55%; opacity: 0.9; }
    84%, 100% { opacity: 0; }
  }
  /* 明け: 最後の 0.12 秒で白く光る */
  .fz-flash {
    position: absolute;
    inset: 0;
    background: #fff;
    opacity: 0;
    animation: fzFlash var(--fz-dur) linear both;
  }
  @keyframes fzFlash {
    0%, 90% { opacity: 0; }
    96% { opacity: 1; }
    100% { opacity: 0.85; }
  }
  @media (prefers-reduced-motion: reduce) {
    .fz-crt, .fz-noise { animation: none; opacity: 0; }
  }
</style>
