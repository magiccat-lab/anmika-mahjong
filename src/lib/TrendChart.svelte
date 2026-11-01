<script lang="ts">
  // [2026-11-02 リョー「回ごとの推移とかも」] 対人戦の通し番号を横軸にした折れ線。y は 1 本だけ。
  // 指でなぞる・マウスを乗せると縦線と、その試合の時点の値の一覧が出る
  import type { Point } from './pvpStats';

  export type Series = { key: string; name: string; color: string; points: Point[] };

  export let series: Series[] = [];
  export let xMin = 1;
  export let xMax = 1;
  export let height = 260;
  export let yFmt: (v: number) => string = (v) => String(Math.round(v));
  export let invert = false; // 平均順位: 1 位を上に
  export let zero = false; // 0 の線を引く
  export let yFixed: [number, number] | null = null;
  export let xTitle: (x: number) => string = (x) => `${x}`;

  let width = 600;
  const M = { l: 48, r: 14, t: 10, b: 24 };

  $: vis = series.map((s) => ({ ...s, pts: s.points.filter((p) => p.x >= xMin && p.x <= xMax) }));
  $: [y0, y1] = yDomain(vis, yFixed, zero);
  $: iw = Math.max(10, width - M.l - M.r);
  $: ih = Math.max(10, height - M.t - M.b);
  $: sx = (x: number) => M.l + (xMax === xMin ? iw / 2 : ((x - xMin) / (xMax - xMin)) * iw);
  $: sy = (y: number) => {
    const f = y1 === y0 ? 0.5 : (y - y0) / (y1 - y0);
    return M.t + (invert ? f : 1 - f) * ih;
  };
  $: yTicks = niceTicks(y0, y1, 5);
  $: xTicks = niceTicks(xMin, xMax, Math.max(2, Math.floor(iw / 90))).filter((x) => Number.isInteger(x));

  function yDomain(v: typeof vis, fixed: [number, number] | null, z: boolean): [number, number] {
    if (fixed) return fixed;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of v) for (const p of s.pts) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (z) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.06;
    const t = niceTicks(lo - pad, hi + pad, 5);
    return [Math.min(t[0], lo - pad), Math.max(t[t.length - 1], hi + pad)];
  }

  function niceTicks(lo: number, hi: number, n: number): number[] {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / n;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  // 打っていない試合が GAP より続いた所は実線を切り、前の値のまま横に点線でつなぐ [斜めの線で嘘の傾きを見せない]
  const GAP = 5;
  // sx ・ sy を引数で渡す [幅が変わった時に線を引き直させる。関数の中で読むだけだと Svelte が気づかない]
  function paths(pts: Point[], fx: (x: number) => number, fy: (y: number) => number): { solid: string; gap: string } {
    const P = (x: number, y: number) => `${fx(x).toFixed(1)},${fy(y).toFixed(1)}`;
    let solid = '';
    let gap = '';
    pts.forEach((p, i) => {
      const prev = pts[i - 1];
      if (prev && p.x - prev.x > GAP) {
        gap += `M${P(prev.x, prev.y)}L${P(p.x, prev.y)}L${P(p.x, p.y)}`;
        solid += `M${P(p.x, p.y)}`;
      } else solid += `${i ? 'L' : 'M'}${P(p.x, p.y)}`;
    });
    return { solid, gap };
  }

  // その試合の時点の値 [その人がまだ打っていない試合は前の値のまま]
  function at(pts: Point[], x: number): Point | null {
    let found: Point | null = null;
    for (const p of pts) {
      if (p.x > x) break;
      found = p;
    }
    return found;
  }

  let hx: number | null = null;
  let svgEl: SVGSVGElement;
  function move(e: PointerEvent) {
    const r = svgEl.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < M.l - 6 || px > width - M.r + 6) {
      hx = null;
      return;
    }
    const f = Math.min(1, Math.max(0, (px - M.l) / iw));
    hx = Math.round(xMin + f * (xMax - xMin));
  }
  $: hover = hx == null
    ? []
    : vis
        .map((s) => ({ s, p: at(s.pts, hx!) }))
        .filter((o): o is { s: (typeof vis)[number]; p: Point } => o.p != null)
        .sort((a, b) => (invert ? a.p.y - b.p.y : b.p.y - a.p.y));
  $: tipLeft = hx != null && sx(hx) > width * 0.6;
</script>

<div class="chart" bind:clientWidth={width}>
  <svg
    bind:this={svgEl}
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    role="img"
    on:pointermove={move}
    on:pointerdown={move}
    on:pointerleave={() => (hx = null)}
  >
    {#each yTicks as t}
      <line class="grid" x1={M.l} x2={width - M.r} y1={sy(t)} y2={sy(t)} />
      <text class="tick" x={M.l - 6} y={sy(t)} dy="0.32em" text-anchor="end">{yFmt(t)}</text>
    {/each}
    {#if zero && y0 < 0 && y1 > 0}
      <line class="zero" x1={M.l} x2={width - M.r} y1={sy(0)} y2={sy(0)} />
    {/if}
    {#each xTicks as t}
      <text class="tick" x={sx(t)} y={height - 6} text-anchor="middle">{t}</text>
    {/each}
    {#each vis as s (s.key)}
      {#if s.pts.length > 1}
        {@const d = paths(s.pts, sx, sy)}
        {#if d.gap}
          <path d={d.gap} fill="none" stroke={s.color} stroke-width="1.5" stroke-dasharray="2 4" opacity="0.55" />
        {/if}
        <path d={d.solid} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      {:else if s.pts.length === 1}
        <circle cx={sx(s.pts[0].x)} cy={sy(s.pts[0].y)} r="3" fill={s.color} />
      {/if}
    {/each}
    {#if hx != null}
      <line class="cross" x1={sx(hx)} x2={sx(hx)} y1={M.t} y2={height - M.b} />
      {#each hover as o (o.s.key)}
        <circle cx={sx(o.p.x)} cy={sy(o.p.y)} r="4.5" fill={o.s.color} stroke="#10301f" stroke-width="2" />
      {/each}
    {/if}
  </svg>
  {#if hx != null && hover.length}
    <div class="tip" style="{tipLeft ? 'right' : 'left'}: {tipLeft ? width - sx(hx) + 10 : sx(hx) + 10}px">
      <div class="tip-title">{xTitle(hx)}</div>
      {#each hover as o (o.s.key)}
        <div class="tip-row">
          <span class="sw" style="background:{o.s.color}"></span>
          <span class="nm">{o.s.name}</span>
          <span class="val">{yFmt(o.p.y)}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chart { position: relative; width: 100%; min-width: 0; touch-action: pan-y; user-select: none; }
  svg { display: block; overflow: visible; }
  .grid { stroke: rgba(255, 255, 255, 0.08); stroke-width: 1; }
  .zero { stroke: rgba(255, 255, 255, 0.35); stroke-width: 1; }
  .cross { stroke: rgba(255, 255, 255, 0.45); stroke-width: 1; stroke-dasharray: 3 3; }
  .tick { fill: rgba(238, 247, 239, 0.62); font-size: 11px; font-variant-numeric: tabular-nums; }
  .tip {
    position: absolute;
    top: 6px;
    min-width: 150px;
    pointer-events: none;
    background: rgba(8, 24, 16, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 6px 9px;
    font-size: 0.78rem;
    color: #eef7ef;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    z-index: 2;
  }
  .tip-title { color: rgba(238, 247, 239, 0.75); margin-bottom: 3px; white-space: nowrap; }
  .tip-row { display: flex; align-items: center; gap: 6px; line-height: 1.5; }
  .sw { width: 10px; height: 3px; border-radius: 2px; flex: none; }
  .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .val { font-variant-numeric: tabular-nums; font-weight: 600; }
</style>
