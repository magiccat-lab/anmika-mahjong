<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { CUTIN_TIER, cutinDurationMs, type CutinPayload } from './store';

  export let cutin: CutinPayload | null;

  const dispatch = createEventDispatcher<{ skip: { ts: number } }>();

  import { FX_ARTWORK, FX_LABELS } from './fxArtwork';
  export let artwork = FX_ARTWORK;

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
      <div class="fx-ring"></div>
      <img class="fx-word" src={artwork[cutin.id]} alt={FX_LABELS[cutin.id]} draggable="false" />
    </div>
  {/key}
{/if}

<style>
  /* Three elements including root. App alone owns finish/pump and watchdog. */
  .fx { position: fixed; inset: 0; z-index: 800; pointer-events: none;
    --fx-x: 28%; --fx-y: 73%; --word-shift: -50%; --entry: 0px; }
  .fx-skippable { pointer-events: auto; cursor: pointer; }
  .from-left { --fx-x: 5%; --fx-y: 45%; --word-shift: 0%; --entry: -12px; }
  .from-right { --fx-x: 95%; --fx-y: 45%; --word-shift: -100%; --entry: 12px; }
  .fx-word { position: absolute; left: var(--fx-x); top: var(--fx-y);
    width: clamp(86px, 13vw, 142px); height: 68px; object-fit: contain;
    padding: 5px 9px; box-sizing: border-box; background: #102b25ed;
    border-bottom: 1px solid #d9b453; opacity: 0;
    transform: translate(var(--word-shift), -50%);
    animation: wordIn calc(var(--fx-dur) - 100ms) cubic-bezier(.22,1,.36,1) 100ms forwards; }
  .fx-reach .fx-word { width: clamp(120px, 18vw, 180px); }
  .fx-heavy .fx-word { width: clamp(180px, 27vw, 250px); height: 76px; }
  .fx-ring { position: absolute; left: var(--fx-x); top: var(--fx-y);
    width: 92px; height: 92px; margin: -46px;
    border: 1px solid #d9b453; border-radius: 50%; opacity: 0;
    animation: ringOut calc(var(--fx-dur) - 100ms) ease-out 100ms forwards; }
  /* First 100ms let the accepted board change precede its caption. */
  @keyframes wordIn {
    0% { opacity: 0; transform: translate(calc(var(--word-shift) + var(--entry)), -40%) scale(.94); }
    28%, 78% { opacity: 1; transform: translate(var(--word-shift), -50%) scale(1); }
    100% { opacity: 0; transform: translate(var(--word-shift), -55%) scale(1); }
  }
  @keyframes ringOut { 0% { opacity: 0; transform: scale(.35); } 28% { opacity: .65; } 100% { opacity: 0; transform: scale(1.5); } }
  @media (prefers-reduced-motion: reduce) { .fx-ring { animation: none; } .fx-word { animation-name: quietWord; } }
  @keyframes quietWord { 0%, 100% { opacity: 0; } 28%, 78% { opacity: 1; } }
</style>
