<script lang="ts">
  // [2026-10-15 fx6 の答え「色紙の紙吹雪やパチ屋のフリーズもあっていい」→ fx7 で「左右から噴き上げる」(C2 a)。上から降る (C1) はやめ]
  // 重い演出 (フィーバー ・ 八華四北) と天和の帯で、左右の下の角から噴き上げ、上で開いてひらひら落ちる。
  // 卓は止めず、触れても素通り (pointer-events: none)。1 回 3.2 秒で消える。
  // 紙は長方形を縦に回して (幅を cos で縮めて) 表と裏の色で翻る様に見せる。canvas 1 枚なので DOM は増えない
  import { onDestroy, onMount } from 'svelte';

  export let durationMs = 3200;

  const COLORS = ['#e53935', '#fdd835', '#1e88e5', '#43a047', '#ec407a', '#fb8c00', '#ffffff', '#f2d27a'];
  type Piece = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; flip: number; vf: number; sway: number; color: string; back: string; born: number };

  let canvas: HTMLCanvasElement;
  let raf = 0;
  let pieces: Piece[] = [];
  let t0 = 0;
  let last = 0;

  function shade(hex: string): string {
    const n = parseInt(hex.slice(1), 16);
    const k = 0.72;
    const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
    return `rgb(${r},${g},${b})`;
  }

  function piece(x: number, y: number, vx: number, vy: number, unit: number, born: number): Piece {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    return {
      x, y, vx, vy,
      w: unit * (0.9 + Math.random() * 0.5), h: unit * (1.5 + Math.random() * 0.7),
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 6,
      flip: Math.random() * Math.PI * 2, vf: 6 + Math.random() * 8,
      sway: Math.random() * Math.PI * 2, color, back: shade(color), born,
    };
  }

  function spawn(W: number, H: number): void {
    const unit = Math.max(6, Math.min(W, H) * 0.016);
    pieces = [];
    // 左右の下の角から 2 回ずつ噴き上げる (0 秒と 0.35 秒)
    for (const burst of [0, 350]) {
      for (const side of [0, 1]) {
        for (let i = 0; i < 55; i += 1) {
          const ang = 0.12 + Math.random() * 0.42; // 真上から内側へ倒す角度
          const sp = H * (1.8 + Math.random() * 0.9); // 上の 3 分の 1 まで届く
          pieces.push(piece(side === 0 ? -unit : W + unit, H + unit, (side === 0 ? 1 : -1) * Math.sin(ang) * sp,
            -Math.cos(ang) * sp, unit, burst + Math.random() * 120));
        }
      }
    }
  }

  function frame(now: number): void {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    if (!t0) { t0 = now; spawn(W, H); }
    const t = now - t0;
    // 録画中などでコマが落ちても同じ速さで落ちる様に、前のコマからの実時間で進める
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 最後の 0.45 秒で薄くして消す
    ctx.globalAlpha = Math.max(0, Math.min(1, (durationMs - t) / 450));
    const g = H * 1.1;
    for (const p of pieces) {
      if (t < p.born) continue;
      // 空気の抵抗: 噴き上げた紙は上で止まり、ひらひら落ちる
      p.vy += g * dt;
      const drag = Math.pow(0.975, dt * 60);
      p.vx *= Math.pow(0.985, dt * 60); p.vy *= drag;
      // 落ちる速さの上限 (ひらひら落ちる速さ)
      const fall = H * 0.32;
      if (p.vy > fall) p.vy = fall;
      p.sway += dt * 3;
      p.x += (p.vx + Math.sin(p.sway) * H * 0.04) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += p.vf * dt;
      const c = Math.cos(p.flip);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.max(0.08, Math.abs(c)));
      ctx.fillStyle = c >= 0 ? p.color : p.back;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < durationMs) raf = requestAnimationFrame(frame);
  }

  onMount(() => { raf = requestAnimationFrame(frame); });
  onDestroy(() => cancelAnimationFrame(raf));
</script>

<canvas class="confetti" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .confetti {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    z-index: 805;
    pointer-events: none;
  }
</style>
