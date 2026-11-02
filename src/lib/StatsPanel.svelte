<script lang="ts">
  // [2026-07-23 リョー要望] 戦績パネル。
  // [2026-11-02 リョー「対人戦のみにして、全画面でちゃんと見れるように整理して。あと指標とか色々出して」
  //  「あと回ごとの推移とかも」] 対人戦 [3 席とも人] だけの全画面。/api/stats/pvp の 1 試合 1 行から
  // まとめ ・ 推移 ・ 試合 ・ 相性を数える [数え方は pvpStats.ts]。運と腕は前からの表
  import { onMount } from 'svelte';
  import { utcToJst } from './jstTime';
  import ProfileTables from './ProfileTables.svelte';
  import TrendChart from './TrendChart.svelte';
  import {
    aggregate, byDay, cumulativeChips, headToHead, rolling, ROLL_LABEL,
    type PlayerAgg, type PvpMatch, type RollKey,
  } from './pvpStats';

  export let onClose: () => void = () => {};

  // 人の色は試合が多い順に固定 [dataviz の並び。緑の地で見えない 6 番の緑だけ飛ばした。8 人目からは灰]
  const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767'];
  const OTHER = '#8f9a92';
  const FEW = 30; // これより少ない人は「一番良い」の緑から外す

  type Tab = 'sum' | 'trend' | 'games' | 'vs' | 'profile';
  let tab: Tab = 'sum';
  let loading = true;
  let error: string | null = null;
  let matches: PvpMatch[] = [];
  let names: Record<string, string> = {};
  let effectiveSince = '';

  async function load() {
    loading = true;
    error = null;
    try {
      const r = await fetch('/api/stats/pvp', { credentials: 'include' });
      if (r.status === 401) {
        error = 'Discord ログインすると見れる';
        matches = [];
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      matches = data.matches ?? [];
      names = data.names ?? {};
      effectiveSince = data.effective_since ?? '';
    } catch (e: any) {
      error = `読み込み失敗: ${e?.message ?? e}`;
    } finally {
      loading = false;
    }
  }
  onMount(load);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  $: all = aggregate(matches, names);
  // 席に着いた人だけ列にする [抜け番だけの人は試合に出ていない]
  $: players = all.filter((p) => p.games > 0);
  $: color = Object.fromEntries(players.map((p, i) => [p.uid, PALETTE[i] ?? OTHER]));
  $: N = matches.length;

  // ---- 書式 ----
  const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '―');
  const sgn = (v: number, d = 0) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}` : '―');
  const int = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : '―');
  const div = (a: number, b: number) => (b > 0 ? a / b : NaN);
  const few = (p: PlayerAgg) => p.games < FEW;

  // ---- まとめの表 [行 = 指標、列 = 人] ----
  type Row = { label: string; val: (p: PlayerAgg) => number; best: 1 | -1 | 0; show: (p: PlayerAgg) => string; note?: string };
  const groups: { cap: string; rows: Row[] }[] = [
    {
      cap: '成績',
      rows: [
        { label: '試合数', val: (p) => p.games, best: 0, show: (p) => `${p.games}` },
        { label: '局数', val: (p) => p.rounds, best: 0, show: (p) => `${p.rounds}` },
        { label: '平均順位', val: (p) => div(p.placeSum, p.placed), best: -1, show: (p) => (p.placed ? (p.placeSum / p.placed).toFixed(2) : '―') },
        { label: 'トップ率', val: (p) => div(p.place[0], p.placed), best: 1, show: (p) => pct(p.place[0], p.placed) },
        { label: '2着率', val: (p) => div(p.place[1], p.placed), best: 0, show: (p) => pct(p.place[1], p.placed) },
        { label: 'ラス率', val: (p) => div(p.place[2], p.placed), best: -1, show: (p) => pct(p.place[2], p.placed) },
        { label: '最長連続トップ', val: (p) => p.topStreak, best: 1, show: (p) => `${p.topStreak}` },
        { label: '最長ラス回避', val: (p) => p.lastAvoidStreak, best: 1, show: (p) => `${p.lastAvoidStreak}` },
      ],
    },
    {
      cap: 'チップ',
      rows: [
        { label: '収支', val: (p) => p.chipTotal, best: 1, show: (p) => sgn(p.chipTotal) },
        { label: '1試合平均', val: (p) => div(p.chipTotal, p.chipMatches), best: 1, show: (p) => sgn(div(p.chipTotal, p.chipMatches), 1) },
        { label: 'プラスの率', val: (p) => div(p.chipPlus, p.chipMatches), best: 1, show: (p) => pct(p.chipPlus, p.chipMatches) },
        { label: '一番勝った試合', val: (p) => p.chipBest, best: 1, show: (p) => sgn(p.chipBest) },
        { label: '一番負けた試合', val: (p) => p.chipWorst, best: 1, show: (p) => sgn(p.chipWorst) },
        { label: '直近10試合', val: (p) => p.chipLast10, best: 1, show: (p) => sgn(p.chipLast10) },
        // [2026-11-02 リョー「上がり1回の祝儀がマイナスなの変じゃない？」] hule は人の和了で払った分も入る
        // 差し引きだった。自分の和了の分 [÷ 和了] と払った分 [÷ 試合] に分ける
        { label: '和了1回の祝儀', val: (p) => div(p.huleWon, p.wins), best: 1, show: (p) => sgn(div(p.huleWon, p.wins), 1) },
        { label: '人の和了で払った祝儀 / 試合', val: (p) => div(p.hule - p.huleWon, p.games), best: 1, show: (p) => sgn(div(p.hule - p.huleWon, p.games), 1) },
      ],
    },
    {
      cap: '和了と放銃',
      rows: [
        { label: '和了率', val: (p) => div(p.wins, p.rounds), best: 1, show: (p) => pct(p.wins, p.rounds) },
        { label: '放銃率', val: (p) => div(p.dealIns, p.rounds), best: -1, show: (p) => pct(p.dealIns, p.rounds) },
        { label: '和了 ÷ 放銃', val: (p) => div(p.wins, p.dealIns), best: 1, show: (p) => (p.dealIns ? (p.wins / p.dealIns).toFixed(2) : '―') },
        { label: 'ツモ和了の割合', val: (p) => div(p.tsumo, p.wins), best: 0, show: (p) => pct(p.tsumo, p.wins) },
        { label: '平均打点', val: (p) => div(p.pointsWon, p.wins), best: 1, show: (p) => int(div(p.pointsWon, p.wins)) },
        { label: '平均放銃点', val: (p) => div(p.pointsDealt, p.dealIns), best: -1, show: (p) => int(div(p.pointsDealt, p.dealIns)) },
        { label: '1局の和了点 − 放銃点', val: (p) => div(p.pointsWon - p.pointsDealt, p.rounds), best: 1, show: (p) => sgn(div(p.pointsWon - p.pointsDealt, p.rounds)) },
      ],
    },
    {
      cap: '打ち方',
      rows: [
        { label: 'リーチ率', val: (p) => div(p.riichi, p.rounds), best: 0, show: (p) => pct(p.riichi, p.rounds) },
        { label: 'フィーバーリーチ率', val: (p) => div(p.fever, p.rounds), best: 0, show: (p) => pct(p.fever, p.rounds) },
        { label: '副露率', val: (p) => div(p.furo, p.rounds), best: 0, show: (p) => pct(p.furo, p.rounds) },
        { label: '北抜き / 局', val: (p) => div(p.nuki, p.rounds), best: 0, show: (p) => (p.rounds ? (p.nuki / p.rounds).toFixed(2) : '―') },
        { label: '暗槓', val: (p) => p.ankan, best: 0, show: (p) => `${p.ankan}` },
      ],
    },
    {
      cap: '持ち点 (終局)',
      rows: [
        { label: '平均', val: (p) => div(p.defenSum, p.defenN), best: 1, show: (p) => int(div(p.defenSum, p.defenN)) },
        { label: '最高', val: (p) => p.defenBest, best: 1, show: (p) => int(p.defenBest) },
      ],
    },
  ];
  function bestOf(row: Row, ps: PlayerAgg[]): string | null {
    if (!row.best) return null;
    let pick: PlayerAgg | null = null;
    for (const p of ps) {
      if (few(p) || !Number.isFinite(row.val(p))) continue;
      if (!pick || (row.best > 0 ? row.val(p) > row.val(pick) : row.val(p) < row.val(pick))) pick = p;
    }
    return pick?.uid ?? null;
  }

  // ---- 推移 ----
  let range: 'all' | 100 | 30 = 'all';
  let rollKey: RollKey = 'place';
  let win = 20;
  let hidden: Record<string, boolean> = {};
  $: xMax = Math.max(1, N);
  $: xMin = range === 'all' ? 1 : Math.max(1, N - range + 1);
  $: shown = players.filter((p) => !hidden[p.uid]);
  $: chipSeries = shown.map((p) => ({ key: p.uid, name: p.name, color: color[p.uid], points: cumulativeChips(matches, p.uid) }));
  $: rollSeries = shown.map((p) => ({ key: p.uid, name: p.name, color: color[p.uid], points: rolling(matches, p.uid, rollKey, win) }));
  $: rollFmt = rollKey === 'place'
    ? (v: number) => v.toFixed(2)
    : rollKey === 'chip'
      ? (v: number) => sgn(v)
      : (v: number) => `${(v * 100).toFixed(0)}%`;
  const xTitle = (x: number) => {
    const m = matches[x - 1];
    return m ? `${x} 試合目 · ${utcToJst(m.at).slice(5)} · ${m.room}-${m.no}` : `${x} 試合目`;
  };

  // ---- 試合 ----
  let dayLimit = 10;
  $: days = byDay(matches);
  const weekday = (d: string) => '日月火水木金土'[new Date(`${d}T12:00:00Z`).getUTCDay()];
</script>

<svelte:window on:keydown={onKey} />

<div class="stats-full" role="dialog" aria-label="戦績 (対人戦)">
  <header class="head">
    <div class="title-row">
      <h2>戦績 <span class="sub">対人戦</span></h2>
      <span class="meta">
        {#if !loading && !error}
          {N}試合 · {players.length}人 · {effectiveSince ? `${utcToJst(effectiveSince)} から` : '全期間'}
        {/if}
      </span>
      <button class="btn" on:click={load} aria-label="読み直す">↻</button>
      <button class="btn close" on:click={onClose}>✕ 閉じる</button>
    </div>
    <nav class="tabs" role="tablist">
      {#each [['sum', 'まとめ'], ['trend', '推移'], ['games', '試合'], ['vs', '相性'], ['profile', '運と腕']] as [k, label] (k)}
        <button role="tab" aria-selected={tab === k} class:on={tab === k} on:click={() => (tab = k as Tab)}>{label}</button>
      {/each}
    </nav>
  </header>

  <main class="body">
    {#if tab === 'profile'}
      <div class="narrow"><ProfileTables /></div>
    {:else if loading}
      <p class="note">読み込み中…</p>
    {:else if error}
      <p class="note">{error}</p>
    {:else if players.length === 0}
      <p class="note">まだ対人戦の記録がない。3 人とも人で最後まで打つと試合ごとに貯まる</p>
    {:else if tab === 'sum'}
      <div class="scroll-x">
        <table class="grid-table">
          <thead>
            <tr>
              <th class="corner"></th>
              {#each players as p (p.uid)}
                <th class="pcol" class:few={few(p)}>
                  <span class="dot" style="background:{color[p.uid]}"></span>{p.name}
                  <small>{p.games}試合{few(p) ? ' · 少なめ' : ''}</small>
                </th>
              {/each}
            </tr>
          </thead>
          {#each groups as g (g.cap)}
            <tbody>
              <tr class="cap"><th colspan={players.length + 1}>{g.cap}</th></tr>
              {#each g.rows as row (row.label)}
                {@const pick = bestOf(row, players)}
                <tr>
                  <th scope="row">{row.label}</th>
                  {#each players as p (p.uid)}
                    <td class:best={p.uid === pick} class:few={few(p)}>{row.show(p)}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          {/each}
        </table>
      </div>
      <p class="note small">緑は {FEW} 試合以上の人の中で一番良い所 (リーチ率など良し悪しの無い行には付けない)。チップは抜け番のサイコロの分も入る</p>
    {:else if tab === 'trend'}
      <div class="controls">
        <div class="seg" role="group" aria-label="範囲">
          {#each [['all', '全部'], [100, '直近100'], [30, '直近30']] as [k, label] (k)}
            <button class:on={range === k} on:click={() => (range = k as typeof range)}>{label}</button>
          {/each}
        </div>
        <div class="legend">
          {#each players as p (p.uid)}
            <button class="lg" class:off={hidden[p.uid]} on:click={() => (hidden = { ...hidden, [p.uid]: !hidden[p.uid] })}>
              <span class="sw" style="background:{color[p.uid]}"></span>{p.name}
            </button>
          {/each}
        </div>
      </div>
      <div class="charts">
        <section class="card">
          <h3>チップの累計 <small>横は対人戦の通し番号</small></h3>
          <TrendChart series={chipSeries} {xMin} {xMax} zero yFmt={(v) => sgn(v)} {xTitle} />
        </section>
        <section class="card">
          <h3>
            直近{win}試合の{ROLL_LABEL[rollKey]}
            <small>{rollKey === 'place' ? '上ほど良い' : ''}</small>
          </h3>
          <div class="seg small" role="group" aria-label="指標">
            {#each Object.entries(ROLL_LABEL) as [k, label] (k)}
              <button class:on={rollKey === k} on:click={() => (rollKey = k as RollKey)}>{label}</button>
            {/each}
            <span class="gap"></span>
            {#each [10, 20, 50] as w (w)}
              <button class:on={win === w} on:click={() => (win = w)}>{w}試合</button>
            {/each}
          </div>
          <TrendChart
            series={rollSeries}
            {xMin}
            {xMax}
            invert={rollKey === 'place'}
            yFixed={rollKey === 'place' ? [1, 3] : null}
            zero={rollKey === 'chip'}
            yFmt={rollFmt}
            {xTitle}
          />
        </section>
      </div>
      <p class="note small">線は {win} 試合打った所から。打っていない試合が続いた所は前の値のまま点線。数字の一覧は「試合」タブ</p>
    {:else if tab === 'games'}
      <div class="scroll-x">
        <table class="grid-table games">
          <thead>
            <tr>
              <th class="corner">試合</th>
              {#each players as p (p.uid)}
                <th class="pcol"><span class="dot" style="background:{color[p.uid]}"></span>{p.name}</th>
              {/each}
            </tr>
          </thead>
          {#each days.slice(0, dayLimit) as d (d.day)}
            <tbody>
              <tr class="day">
                <th scope="row">{d.day.slice(5).replace('-', '/')} ({weekday(d.day)}) <small>{d.matches.length}試合</small></th>
                {#each players as p (p.uid)}
                  <td class:plus={(d.chips[p.uid] ?? 0) > 0} class:minus={(d.chips[p.uid] ?? 0) < 0}>
                    {p.uid in d.chips ? sgn(d.chips[p.uid]) : ''}
                  </td>
                {/each}
              </tr>
              {#each d.matches as { m, idx } (m.id)}
                <tr>
                  <th scope="row" class="mrow">
                    <span class="idx">#{idx}</span> {utcToJst(m.at).slice(11)} <small>{m.room}-{m.no}</small>
                  </th>
                  {#each players as p (p.uid)}
                    {@const r = m.p[p.uid]}
                    {@const c = m.chips[p.uid]}
                    <td>
                      {#if r}
                        <span class="pl p{r.placement}">{r.placement ?? '-'}着</span>
                        <span class:plus={c > 0} class:minus={c < 0}>{sgn(c ?? 0)}</span>
                      {:else if c != null}
                        <span class="sit">抜け {sgn(c)}</span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          {/each}
        </table>
      </div>
      {#if days.length > dayLimit}
        <button class="btn more" on:click={() => (dayLimit += 10)}>前の日も見る ({days.length - dayLimit}日)</button>
      {/if}
    {:else if tab === 'vs'}
      <div class="scroll-x">
        <table class="grid-table vs">
          <thead>
            <tr>
              <th class="corner">行の人が<br />列の人より上</th>
              {#each players as b (b.uid)}
                <th class="pcol"><span class="dot" style="background:{color[b.uid]}"></span>{b.name}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each players as a (a.uid)}
              <tr>
                <th scope="row"><span class="dot" style="background:{color[a.uid]}"></span>{a.name}</th>
                {#each players as b (b.uid)}
                  {@const h = a.uid === b.uid ? null : headToHead(matches, a.uid, b.uid)}
                  <td class:self={!h} class:good={h && h.n >= 10 && h.above / h.n >= 0.6} class:bad={h && h.n >= 10 && h.above / h.n <= 0.4}>
                    {#if h && h.n}
                      <b>{pct(h.above, h.n)}</b>
                      <small>{h.n}卓 · {sgn(h.chipDiff)}</small>
                    {:else if h}
                      <small>同卓なし</small>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="note small">同じ卓で打った試合のうち、行の人が列の人より上の着順だった率。下の数は同卓の数と、その試合でのチップの差 (行 − 列)。10 卓以上で 6 割超えは緑、4 割以下は赤</p>
    {/if}
  </main>
</div>

<style>
  .stats-full {
    position: fixed;
    inset: 0;
    z-index: 500;
    display: flex;
    flex-direction: column;
    background: #10301f;
    color: #eef7ef;
    height: 100vh;
    height: 100dvh;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    box-sizing: border-box;
  }
  .head {
    flex: none;
    padding: 8px 14px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    background: #0d281a;
  }
  .title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  h2 { margin: 2px 0; font-size: 1.2rem; color: #ffe9ad; }
  h2 .sub { font-size: 0.8rem; font-weight: 600; color: rgba(238, 247, 239, 0.72); margin-left: 4px; }
  .meta { flex: 1; font-size: 0.8rem; color: rgba(238, 247, 239, 0.72); font-variant-numeric: tabular-nums; }
  .btn {
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    border-radius: 8px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 0.88rem;
  }
  .tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; margin-top: 4px; }
  .tabs button {
    flex: none;
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: rgba(238, 247, 239, 0.72);
    padding: 7px 12px 6px;
    font-size: 0.92rem;
    cursor: pointer;
  }
  .tabs button.on { color: #ffe9ad; border-bottom-color: #ffe9ad; font-weight: 700; }
  .body { flex: 1; overflow: auto; padding: 12px 14px 24px; -webkit-overflow-scrolling: touch; }
  .narrow { max-width: 900px; }
  .note { color: rgba(238, 247, 239, 0.85); padding: 8px 2px; }
  .note.small { font-size: 0.76rem; color: rgba(238, 247, 239, 0.62); }

  /* 表 [1 列目は横に流しても残す] */
  .scroll-x { overflow-x: auto; max-width: 100%; }
  .grid-table { border-collapse: separate; border-spacing: 0; font-size: 0.86rem; font-variant-numeric: tabular-nums; min-width: 100%; }
  .grid-table th, .grid-table td { padding: 5px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); white-space: nowrap; }
  .grid-table td { text-align: right; }
  .grid-table thead th { position: sticky; top: 0; z-index: 2; background: #0d281a; font-weight: 700; text-align: right; vertical-align: bottom; }
  .grid-table th[scope='row'], .grid-table .corner {
    position: sticky;
    left: 0;
    z-index: 1;
    background: #10301f;
    text-align: left;
    font-weight: 500;
    color: rgba(238, 247, 239, 0.85);
  }
  .grid-table thead .corner { z-index: 3; background: #0d281a; font-size: 0.72rem; font-weight: 500; color: rgba(238, 247, 239, 0.6); }
  .pcol small { display: block; font-size: 0.68rem; font-weight: 400; color: rgba(238, 247, 239, 0.6); }
  .pcol.few { color: rgba(238, 247, 239, 0.7); }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
  tr.cap th {
    text-align: left;
    color: #ffe9ad;
    font-size: 0.78rem;
    letter-spacing: 0.05em;
    padding-top: 12px;
    background: transparent;
    position: sticky;
    left: 0;
  }
  td.best { color: #8fe3a1; font-weight: 700; background: rgba(143, 227, 161, 0.12); }
  td.few { color: rgba(238, 247, 239, 0.6); }
  .plus { color: #8fe3a1; }
  .minus { color: #ff9d9d; }

  /* 試合 */
  .games tr.day th, .games tr.day td { background: #16402a; font-weight: 700; border-top: 1px solid rgba(255, 255, 255, 0.14); }
  .games tr.day th small { font-weight: 400; color: rgba(238, 247, 239, 0.6); margin-left: 4px; }
  .mrow { font-size: 0.8rem; }
  .mrow .idx { color: rgba(238, 247, 239, 0.5); margin-right: 4px; }
  .mrow small { color: rgba(238, 247, 239, 0.55); margin-left: 4px; }
  .pl { display: inline-block; min-width: 2.4em; margin-right: 6px; color: rgba(238, 247, 239, 0.8); }
  .pl.p1 { color: #ffe9ad; font-weight: 700; }
  .sit { color: rgba(238, 247, 239, 0.5); font-size: 0.78rem; }
  .more { margin-top: 10px; }

  /* 相性 */
  .vs td { text-align: center; min-width: 88px; }
  .vs td b { display: block; font-size: 0.95rem; }
  .vs td small { font-size: 0.68rem; color: rgba(238, 247, 239, 0.6); }
  .vs td.self { background: rgba(255, 255, 255, 0.04); }
  .vs td.good b { color: #8fe3a1; }
  .vs td.bad b { color: #ff9d9d; }

  /* 推移 */
  .controls { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-bottom: 10px; }
  .seg { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .seg button, .lg {
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
    border-radius: 999px;
    padding: 4px 11px;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .seg button.on { background: rgba(255, 233, 173, 0.18); border-color: #ffe9ad; color: #ffe9ad; font-weight: 700; }
  .seg.small button { font-size: 0.76rem; padding: 3px 9px; }
  .seg .gap { width: 8px; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px; }
  .lg { display: inline-flex; align-items: center; gap: 6px; }
  .lg .sw { width: 14px; height: 3px; border-radius: 2px; }
  .lg.off { opacity: 0.4; text-decoration: line-through; }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr)); gap: 12px; }
  .card { border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px; padding: 10px 12px 6px; background: rgba(255, 255, 255, 0.03); min-width: 0; }
  .card h3 { margin: 0 0 6px; font-size: 0.95rem; color: #eef7ef; }
  .card h3 small { font-weight: 400; font-size: 0.72rem; color: rgba(238, 247, 239, 0.6); margin-left: 6px; }
  .card .seg { margin-bottom: 6px; }

  @media (max-width: 560px) {
    .head { padding: 6px 10px 0; }
    .body { padding: 10px 8px 20px; }
    .grid-table { font-size: 0.8rem; }
    .grid-table th, .grid-table td { padding: 4px 7px; }
    .meta { flex-basis: 100%; order: 3; }
  }
  @media (max-height: 460px) {
    .head { padding-top: 4px; }
    h2 { font-size: 1rem; }
    .tabs button { padding: 4px 10px 4px; }
  }
</style>
