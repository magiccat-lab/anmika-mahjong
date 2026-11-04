<script lang="ts">
  // [2026-11-04 隠し演出] フィーバー中の逆で 50 枚以上消えた時の暗転 [条件は lib/jikoSp.ts]。
  // [11-04 リョー B1] ツモった牌を見せずに真っ暗 → 雷が落ちる (曲のサビもここから) → 字は出さず、逆のぽっちが下から浮かび上がる → 明ける
  export let pochi: 'red' | 'yellow' = 'yellow';
  export let durationMs = 4500;
  export let boltMs = 600;
</script>

<div class="jk" style="--jk-dur: {durationMs}ms; --jk-bolt: {boltMs}ms" aria-hidden="true">
  <div class="jk-flash"></div>
  <svg class="jk-bolt" viewBox="0 0 120 400" preserveAspectRatio="xMidYMin meet">
    <path d="M70 0 L38 150 L66 156 L28 290 L58 294 L22 400 L96 236 L64 232 L104 108 L74 104 L96 0 Z" />
  </svg>
  <div class="jk-pochi" class:red={pochi === 'red'}>
    <div class="jk-tile"><span class="jk-dot"></span></div>
  </div>
</div>

<style>
  .jk {
    position: fixed;
    inset: 0;
    z-index: 10060; /* 絞りの幕 (.sq 9999) ・ フリーズ (.fz 10050) の上 */
    background: #000;
    pointer-events: auto;
    overflow: hidden;
    animation: jkOut var(--jk-dur) linear both;
  }
  /* 雷の光で画面全体が一瞬白くなり、2 度またたく */
  .jk-flash {
    position: absolute;
    inset: 0;
    background: #eef3ff;
    opacity: 0;
    animation: jkFlash 0.7s linear var(--jk-bolt) both;
  }
  .jk-bolt {
    position: absolute;
    left: 50%;
    top: 0;
    width: min(26vw, 200px);
    height: 78vh;
    transform: translateX(-46%);
    opacity: 0;
    animation: jkBolt 0.9s linear var(--jk-bolt) both;
  }
  .jk-bolt path { fill: #fdfdff; filter: drop-shadow(0 0 10px #9fc2ff) drop-shadow(0 0 28px #5f8dff); }
  /* ぽっち: 白の牌の真ん中の点が、下の闇から浮かび上がる */
  .jk-pochi {
    position: absolute;
    left: 50%;
    top: 50%;
    --pc: #f2c23a;
    --pg: rgba(242, 194, 58, 0.85);
    transform: translate(-50%, -50%);
    opacity: 0;
    animation: jkRise 1.7s cubic-bezier(0.2, 0.7, 0.2, 1) calc(var(--jk-bolt) + 0.9s) both;
  }
  .jk-pochi.red { --pc: #ff3b3b; --pg: rgba(255, 59, 59, 0.85); }
  .jk-tile {
    width: clamp(64px, 13vmin, 120px);
    aspect-ratio: 3 / 4;
    border-radius: 12px;
    background: linear-gradient(#fffdf6, #efe8d2);
    border: 2px solid #d9cfae;
    box-shadow: 0 8px 0 #9d9578, 0 0 46px 6px var(--pg);
    display: grid;
    place-items: center;
  }
  .jk-dot {
    width: 34%;
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fff 0, var(--pc) 45%);
    box-shadow: 0 0 18px 4px var(--pg);
    animation: jkBeat 1.1s ease-in-out calc(var(--jk-bolt) + 2.4s) infinite;
  }
  @keyframes jkFlash {
    0% { opacity: 0; }
    6% { opacity: 0.95; }
    18% { opacity: 0.05; }
    28% { opacity: 0.7; }
    45% { opacity: 0; }
    100% { opacity: 0; }
  }
  @keyframes jkBolt {
    0% { opacity: 0; clip-path: inset(0 0 100% 0); }
    8% { opacity: 1; clip-path: inset(0 0 0 0); }
    30% { opacity: 1; }
    40% { opacity: 0.3; }
    50% { opacity: 1; }
    100% { opacity: 0; clip-path: inset(0 0 0 0); }
  }
  @keyframes jkRise {
    from { opacity: 0; transform: translate(-50%, calc(-50% + 26vh)) scale(0.7); filter: blur(6px) brightness(0.2); }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: none; }
  }
  @keyframes jkBeat {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.12); }
  }
  /* 最後の 0.5 秒で明ける */
  @keyframes jkOut {
    0%, 89% { opacity: 1; }
    100% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .jk-flash { animation-duration: 0.01s; }
    .jk-dot { animation: none; }
  }
</style>
