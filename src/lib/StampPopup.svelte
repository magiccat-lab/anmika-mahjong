
<script lang="ts">
  // スタンプ popup [seat 上 absolute 配置、 2.5s fade]
  // 親が relative position 持ってる前提で 上に被せる
  import { STAMP_LABELS, type StampId } from './store';
  export let stamp: { id: StampId; ts: number } | null;
</script>

{#if stamp}
  {#key stamp.ts}
    <div class="stamp-popup">
      <img class="stamp-img" src={`/stamps/stamp_${stamp.id}.png`} alt={STAMP_LABELS[stamp.id]} />
    </div>
  {/key}
{/if}

<style>
  .stamp-popup {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 500;
    pointer-events: none;
    animation: stampFade 2.5s ease-out forwards;
  }
  .stamp-img {
    width: 140px;
    height: 140px;
    opacity: 0.9;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4));
    user-select: none;
  }
  @keyframes stampFade {
    0% { opacity: 0; transform: translate(-50%, -30%) scale(0.5); }
    8% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
    16% { transform: translate(-50%, -50%) scale(1); }
    80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -60%) scale(0.95); }
  }
</style>
