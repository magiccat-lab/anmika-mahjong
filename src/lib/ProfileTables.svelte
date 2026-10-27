<script lang="ts">
  // [2026-10-27 リョー「人別分析をオンミカのサイト上で見れるように」] 人別の運と腕 [対人戦だけ・全期間]。
  // /api/stats/profile の生カウントから率を出す。行と式は review ページ (anmika-profile1、リョー OK) と同じ
  import { onMount } from 'svelte';

  type Counts = { name: string } & Record<string, number>;
  type Row = [label: string, val: (p: Counts) => number, best: 1 | -1 | 0, show: (p: Counts) => string];

  const FEW = 30; // これより少ない対人戦の試合数の人は、緑の対象から外す

  let loading = true;
  let error: string | null = null;
  let players: Counts[] = [];
  let at = '';

  export async function load() {
    loading = true;
    error = null;
    try {
      const r = await fetch('/api/stats/profile', { credentials: 'include' });
      if (r.status === 401) {
        error = 'Discord ログインすると見れる';
        players = [];
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      players = data.players ?? [];
      at = data.at ?? '';
    } catch (e: any) {
      error = `読み込み失敗: ${e?.message ?? e}`;
    } finally {
      loading = false;
    }
  }
  onMount(load);

  const g = (p: Counts, f: string): number => p[f] ?? 0;
  const pct = (a: number, b: number): string => (b ? `${((100 * a) / b).toFixed(1)}%` : '―');
  const num = (v: number): string => `${v >= 0 ? '+' : ''}${v.toLocaleString()}`;
  const rate = (a: string, b: string) => (p: Counts) => (g(p, b) ? g(p, a) / g(p, b) : 0);
  const games = (p: Counts) => g(p, 'matches') + g(p, 'sitout');

  const money: Row[] = [
    ['対人戦の試合', (p) => g(p, 'matches'), 0, (p) => `${g(p, 'matches')}` + (g(p, 'sitout') ? ` (+抜け番${g(p, 'sitout')})` : '')],
    ['チップ収支', (p) => g(p, 'chip'), 1, (p) => num(g(p, 'chip'))],
    ['1試合あたり', (p) => g(p, 'chip') / games(p), 1, (p) => { const v = g(p, 'chip') / games(p); return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`; }],
    ['うちサイコロ', (p) => g(p, 'dice_chip'), 0, (p) => num(g(p, 'dice_chip'))],
    ['サイコロ以外', (p) => g(p, 'chip') - g(p, 'dice_chip'), 1, (p) => num(g(p, 'chip') - g(p, 'dice_chip'))],
  ];
  const luck: Row[] = [
    ['自分が振ったサイコロ', (p) => g(p, 'dice_own'), 0, (p) => num(g(p, 'dice_own'))],
    ['人が振ったサイコロ', (p) => g(p, 'dice_others'), 0, (p) => num(g(p, 'dice_others'))],
    ['振った回数', (p) => g(p, 'dice_n'), 0, (p) => `${g(p, 'dice_n')}`],
    ['投げた数', (p) => g(p, 'dice_rolls'), 0, (p) => `${g(p, 'dice_rolls')}`],
    ['当たり率 (平均5.6%)', () => 0, 0, (p) => `${pct(g(p, 'dice_hits'), g(p, 'dice_rolls'))} (${g(p, 'dice_hits')})`],
    ['ゾロ目率 (平均16.7%)', () => 0, 0, (p) => `${pct(g(p, 'dice_zoros'), g(p, 'dice_rolls'))} (${g(p, 'dice_zoros')})`],
    ['フィーバーリーチ / リーチ', () => 0, 0, (p) => `${pct(g(p, 'fever_riichi'), g(p, 'riichi'))} (${g(p, 'fever_riichi')})`],
    ['北を抜いた数 / 局', () => 0, 0, (p) => (g(p, 'rounds') ? (g(p, 'nuki') / g(p, 'rounds')).toFixed(2) : '―')],
  ];
  const skill: Row[] = [
    ['和了率', rate('wins', 'rounds'), 1, (p) => pct(g(p, 'wins'), g(p, 'rounds'))],
    ['放銃率', rate('deal_ins', 'rounds'), -1, (p) => pct(g(p, 'deal_ins'), g(p, 'rounds'))],
    ['平均打点', rate('points_won', 'wins'), 1, (p) => Math.floor(g(p, 'points_won') / Math.max(g(p, 'wins'), 1)).toLocaleString()],
    ['平均放銃点', rate('points_dealt_in', 'deal_ins'), -1, (p) => Math.floor(g(p, 'points_dealt_in') / Math.max(g(p, 'deal_ins'), 1)).toLocaleString()],
    ['リーチ率', rate('riichi', 'rounds'), 0, (p) => pct(g(p, 'riichi'), g(p, 'rounds'))],
    ['副露率', rate('furo_rounds', 'rounds'), 0, (p) => pct(g(p, 'furo_rounds'), g(p, 'rounds'))],
    ['平均順位', rate('place_sum', 'placed'), -1, (p) => (g(p, 'placed') ? (g(p, 'place_sum') / g(p, 'placed')).toFixed(2) : '―')],
    ['トップ率', rate('place1', 'placed'), 1, (p) => pct(g(p, 'place1'), g(p, 'placed'))],
    ['ラス率', rate('place3', 'placed'), -1, (p) => pct(g(p, 'place3'), g(p, 'placed'))],
    ['CPUと同じ牌を切った率', rate('dr_cpu_match', 'dr_evaluated'), 0, (p) => pct(g(p, 'dr_cpu_match'), g(p, 'dr_evaluated'))],
    ['降りる所で降りた率', rate('dr_folded', 'dr_fold_spots'), 0, (p) => pct(g(p, 'dr_folded'), g(p, 'dr_fold_spots'))],
  ];
  const tables: [string, Row[]][] = [
    ['チップの収支', money],
    ['運の数', luck],
    ['腕の数', skill],
  ];

  const few = (p: Counts) => g(p, 'matches') < FEW;
  // 行ごとの一番良い人 [同じ値なら先の人]。比べない行は null
  function bestOf([, val, best]: Row): string | null {
    let pick: Counts | null = null;
    for (const p of players) {
      if (few(p)) continue;
      if (!pick || (best > 0 ? val(p) > val(pick) : val(p) < val(pick))) pick = p;
    }
    return best && pick ? pick.name : null;
  }
</script>

{#if loading}
  <p class="note">読み込み中…</p>
{:else if error}
  <p class="note">{error}</p>
{:else if players.length === 0}
  <p class="note">まだ対人戦の記録がない</p>
{:else}
  <p class="meta">対人戦 (3席とも人) だけ・全期間{at ? ` · ${at.slice(5, 16).replace('T', ' ')} 時点` : ''}</p>
  {#each tables as [cap, rows] (cap)}
    <h3>{cap}</h3>
    <div class="wrap">
      <table>
        <thead>
          <tr>
            <th></th>
            {#each players as p (p.name)}
              <th>{p.name}{#if few(p)}<small>試合が少ない</small>{/if}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row[0])}
            {@const pick = bestOf(row)}
            <tr>
              <th scope="row">{row[0]}</th>
              {#each players as p (p.name)}
                <td class:best={p.name === pick} class:few={few(p)}>{row[3](p)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/each}
  <p class="note">緑の数は、対人戦{FEW}試合以上の人の中で一番良い所。比べる意味の薄い行 (リーチ率など) には付けていない</p>
{/if}

<style>
  .meta { font-size: 0.82rem; opacity: 0.92; margin: 6px 0 4px; }
  .note { padding: 8px 4px; opacity: 0.85; font-size: 0.82rem; }
  h3 { margin: 14px 0 6px; font-size: 1rem; color: #ffe9ad; }
  .wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
  }
  table { border-collapse: collapse; width: 100%; font-size: 0.86rem; }
  th, td { padding: 5px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); white-space: nowrap; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: none; }
  thead th { text-align: right; font-weight: 700; color: #ffe9ad; }
  thead th:first-child { position: sticky; left: 0; background: #153d28; }
  thead th small { display: block; font-weight: 400; font-size: 0.68rem; opacity: 0.7; color: #eef7ef; }
  tbody th {
    text-align: left;
    font-weight: 500;
    color: rgba(238, 247, 239, 0.85);
    position: sticky;
    left: 0;
    background: #153d28;
  }
  td { text-align: right; font-variant-numeric: tabular-nums; }
  td.few { opacity: 0.6; }
  td.best { color: #8fe3a1; font-weight: 700; background: rgba(143, 227, 161, 0.12); }
</style>
