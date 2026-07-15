<script lang="ts">
  // 内製サイコロ [CSS 3D cube、2026-07-15 リョー指示でdice-box(WebGL物理)を置換]
  // 出目はロジック/サーバー側で確定済み。コレは表示専用の演出。
  // rolling 中はタンブル回転、rolling 解除で value の面を正面に向けて ease-out。
  export let value: number = 1;
  export let rolling: boolean = false;
  export let size: number = 56;

  // 各面を正面に向けるための cube 回転 [X, Y deg]
  // 面配置: 1=前 6=後 3=右 4=左 2=上 5=下 [和サイコロ: 1赤・天面2]
  const FACE_ROT: Record<number, [number, number]> = {
    1: [0, 0],
    2: [-90, 0],
    3: [0, -90],
    4: [0, 90],
    5: [90, 0],
    6: [0, 180],
  };
  // 止まる時に全周回転を足して「転がって止まる」見た目にする
  const TURNS = 2;
  $: settle = FACE_ROT[value] ?? FACE_ROT[1];
  $: settleX = settle[0] - 360 * TURNS;
  $: settleY = settle[1] + 360 * TURNS;

  // 3x3 grid での pip 配置 [cell index 0-8]
  const PIPS: Record<number, number[]> = {
    1: [4],
    2: [2, 6],
    3: [2, 4, 6],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const FACES = [1, 2, 3, 4, 5, 6];
  const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
</script>

<div class="scene" style="--size:{size}px">
  <div
    class="cube"
    class:rolling
    style="--sx:{settleX}deg; --sy:{settleY}deg"
  >
    {#each FACES as face}
      <div class="face face-{face}">
        {#each CELLS as cell}
          <span
            class="pip"
            class:on={PIPS[face].includes(cell)}
            class:ichi={face === 1 && cell === 4}
          ></span>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .scene {
    width: var(--size);
    height: var(--size);
    perspective: calc(var(--size) * 5);
  }
  .cube {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
    transform: rotateX(var(--sx)) rotateY(var(--sy));
    transition: transform 0.55s cubic-bezier(0.2, 0.75, 0.3, 1.04);
  }
  .cube.rolling {
    transition: none;
    animation: tumble 0.5s linear infinite;
  }
  @keyframes tumble {
    0%   { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); }
    25%  { transform: rotateX(120deg) rotateY(80deg) rotateZ(30deg); }
    50%  { transform: rotateX(240deg) rotateY(170deg) rotateZ(60deg); }
    75%  { transform: rotateX(300deg) rotateY(270deg) rotateZ(90deg); }
    100% { transform: rotateX(360deg) rotateY(360deg) rotateZ(120deg); }
  }
  .face {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    place-items: center;
    padding: calc(var(--size) * 0.12);
    box-sizing: border-box;
    background: linear-gradient(145deg, #ffffff 0%, #f2efe6 100%);
    border: 1px solid #c9c2ae;
    border-radius: calc(var(--size) * 0.16);
    backface-visibility: hidden;
  }
  .face-1 { transform: translateZ(calc(var(--size) / 2)); }
  .face-6 { transform: rotateY(180deg) translateZ(calc(var(--size) / 2)); }
  .face-3 { transform: rotateY(90deg) translateZ(calc(var(--size) / 2)); }
  .face-4 { transform: rotateY(-90deg) translateZ(calc(var(--size) / 2)); }
  .face-2 { transform: rotateX(90deg) translateZ(calc(var(--size) / 2)); }
  .face-5 { transform: rotateX(-90deg) translateZ(calc(var(--size) / 2)); }
  .pip {
    width: calc(var(--size) * 0.16);
    height: calc(var(--size) * 0.16);
    border-radius: 50%;
    visibility: hidden;
  }
  .pip.on {
    visibility: visible;
    background: radial-gradient(circle at 35% 30%, #3a3a3a, #111);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
  }
  .pip.on.ichi {
    width: calc(var(--size) * 0.34);
    height: calc(var(--size) * 0.34);
    background: radial-gradient(circle at 35% 30%, #e05050, #b01818);
  }
</style>
