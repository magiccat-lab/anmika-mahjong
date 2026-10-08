<script lang="ts">
  // [2026-10-09 遊真 C1] 「この席を待っている」残り時間の棒。席の札の下端に重ねる。
  // server の deadline [room seat 単位] の endsAt まで CSS animation で縮む。
  // 残り 10 秒を切ったら赤に変わる [delay を残り-10 秒にした 2 本目の animation]
  import { DEADLINE_WARN_MS, type OnlineDeadline } from './onlineDeadline';

  export let deadline: OnlineDeadline | null = null;
  /** この札の持ち主の room seat [席なし ・ 観戦は null] */
  export let roomSeat: number | null = null;

  // 時計は deadline を受けた時点で 1 回だけ読む [棒の進みは CSS が持つ]
  $: nowMs = deadline && roomSeat !== null ? performance.now() : 0;
  $: active = !!deadline && roomSeat !== null && deadline.seats.includes(roomSeat) && nowMs < deadline.endsAt;
  $: remainMs = active && deadline ? Math.max(0, deadline.endsAt - nowMs) : 0;
  $: fromRatio = active && deadline ? Math.min(1, remainMs / Math.max(1, deadline.totalMs)) : 0;
  $: urgentDelayMs = Math.max(0, remainMs - DEADLINE_WARN_MS);
</script>

{#if active && deadline}
  {#key deadline.endsAt}
    <div
      class="dl-bar"
      aria-hidden="true"
      style="--dl-ms: {Math.round(remainMs)}ms; --dl-from: {fromRatio.toFixed(3)}; --dl-urgent-delay: {Math.round(urgentDelayMs)}ms;"
    ><i></i></div>
  {/key}
{/if}

<style>
  .dl-bar {
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 1px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
    pointer-events: none;
  }
  .dl-bar i {
    display: block;
    width: 100%;
    height: 100%;
    background: #ffd060;
    transform-origin: left center;
    transform: scaleX(var(--dl-from));
    animation:
      dl-shrink var(--dl-ms) linear forwards,
      dl-urgent 1ms linear var(--dl-urgent-delay) forwards;
  }
  @keyframes dl-shrink {
    from { transform: scaleX(var(--dl-from)); }
    to { transform: scaleX(0); }
  }
  @keyframes dl-urgent {
    to { background: #ff5040; }
  }
</style>
