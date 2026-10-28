
<script lang="ts">
  import Tile from './Tile.svelte';
  import { BASE_POINT_TIER, natsuBasePoint } from './helpers';
  import { fulouTileFaceDown, type FulouMianzi } from './fulouDisplay';
  export let lastWinner: number | null;
  export let huleResult: any;
  export let baopai: string[];
  export let fubaopai: string[] | null = null;
  export let winnerLizhi: boolean = false;
  /** 点数移動 [P0, P1, P2] = after_defen - before_defen */
  export let defenDelta: [number, number, number] | null = null;
  /** 移動後の各家 defen */
  export let defenAfter: [number, number, number] | null = null;
  /** 上がった人の手牌 [副露 mianzi 含む、 ロン牌 末尾] */
  /** 席表示名 [オンラインはユーザー名、単体は P0/P1/P2] */
  export let names: string[] = ['P0', 'P1', 'P2'];
  export let winnerShoupai: string[] = [];
  export let winnerFulou: FulouMianzi[] = [];
  export let winnerHuapai: string[] = [];
  export let winnerNuki: number = 0;
  export let winnerNukiGold: number = 0;
  /** 金北強化未確定の間 冬めくり結果を隠す [リョー指示 2026-05-12: 結果見て強化選ばせない] */
  export let hideFuyuResult: boolean = false;
  /** アガリ牌 [ロン牌 / ツモ牌]、 null なら非表示 */
  export let agariPai: string | null = null;
  /** 'ron' | 'tsumo'、 null なら非表示 */
  export let agariType: 'ron' | 'tsumo' | null = null;
  /** ロン時の振込者 [tsumo の時は無視] */
  export let agariFrom: number | null = null;

  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';

  // 打点のカウントアップ [パネル登場後に回す]
  const defenTween = tweened(0, { duration: 900, easing: cubicOut });
  $: finalDefen = huleResult.defen3 ?? huleResult.defen ?? 0;
  $: defenTween.set(finalDefen);

  // 満貫級ラベル [総翻数ベース]
  function tierLabel(fanshu: number): string | null {
    if (fanshu >= 13) return '役満';
    if (fanshu >= 11) return '三倍満';
    if (fanshu >= 8) return '倍満';
    if (fanshu >= 6) return '跳満';
    if (fanshu >= 5) return '満貫';
    return null;
  }
  // [2026-10-09 リョー報告「表示満貫になってたし」] 夏で上げた段は翻に出ないので、基本点から段の名前を取る
  $: natsuBase = natsuBasePoint(huleResult);
  $: tier = (natsuBase !== null && BASE_POINT_TIER[natsuBase]?.label) || tierLabel(Number(huleResult.fanshu) || 0);
</script>

<section class="hule-panel">
  <div class="top-line">
    {#if agariType}
      <span class="agari-kind {agariType === 'ron' ? 'kind-ron' : 'kind-tsumo'}">
        {agariType === 'ron' ? 'ロン' : 'ツモ'}
      </span>
    {/if}
    <span class="winner">{lastWinner !== null ? (names[lastWinner] ?? `P${lastWinner}`) : ''} 和了</span>
    <span class="score">{huleResult.fu ?? 0}符 {huleResult.fanshu ?? 0}翻</span>
    {#if tier}<span class="tier-chip tier-{['役満', '五倍満', '六倍満'].includes(tier) ? 'yakuman' : 'big'}">{tier}</span>{/if}
    <span class="defen">{Math.round($defenTween).toLocaleString()}<span class="defen-unit">点</span></span>
  </div>

  <!-- [2026-10-29 サイバー B / P4] 打点と祝儀は別の枠。札の字は本物の要素 -->
  <div class="split-box box-score">
    <h3 class="box-tab"><span class="tab-ja">打点</span><span class="tab-en" lang="en">SCORE</span></h3>
    <div class="box-body">
    {#if defenDelta}
      <div class="payment-row">
        <span class="payment-label">点数移動:</span>
        {#each defenDelta as v, p}
          <span class="payment-cell {v > 0 ? 'gain' : (v < 0 ? 'loss' : 'zero')}">
            <span class="payment-player">{names[p] ?? `P${p}`}</span>
            <span class="payment-delta">{v > 0 ? '+' : (v === 0 ? '±' : '')}{v.toLocaleString()}</span>
            {#if defenAfter}<span class="payment-after">→ {defenAfter[p].toLocaleString()}</span>{/if}
          </span>
        {/each}
      </div>
    {/if}
    {#if huleResult.hupai}
      <div class="yaku-list">
        {#each huleResult.hupai as h}
          <span class="yaku-chip">{h.name} {h.fanshu ? `${h.fanshu === '*' ? '13' : (h.fanshu === '**' ? '26' : h.fanshu)}翻` : ''}</span>
        {/each}
      </div>
    {/if}
    <div class="dora-row">
      <span class="dora-label">表ドラ表:</span>
      {#each baopai.filter((b) => typeof b === 'string') as b}<Tile pai={b} size="sm" />{/each}
      {#if winnerLizhi && fubaopai}
        <span class="dora-label">裏ドラ表:</span>
        {#each fubaopai.filter((b) => typeof b === 'string') as b}<Tile pai={b} size="sm" />{/each}
      {/if}
    </div>
    {#if agariPai && agariType}
      <div class="agari-row">
        <span class="agari-label">
          {#if agariType === 'ron'}
            ロン牌
            {#if agariFrom !== null}<span class="agari-from">[{names[agariFrom] ?? `P${agariFrom}`} 振込]</span>{/if}
          {:else}
            ツモ牌
            {#if lastWinner !== null}<span class="agari-from">[{names[lastWinner] ?? `P${lastWinner}`} 自摸]</span>{/if}
          {/if}
          :
        </span>
        <span class="agari-tile-wrap"><Tile pai={agariPai} size="lg" /></span>
      </div>
    {/if}
    {#if winnerShoupai.length > 0}
      <div class="winner-hand">
        <span class="winner-hand-label">手牌:</span>
        {#each winnerShoupai as t}<Tile pai={t} size="sm" />{/each}
        {#each winnerFulou as m}
          <span class="fulou-mianzi">
            {#each m.tiles as t, i}
              {#if i === m.rotateIdx && m.kakanTile}
                <span class="kakan-col">
                  <span class="rot-tile"><Tile pai={m.kakanTile} size="sm" /></span>
                  <span class="rot-tile"><Tile pai={t} size="sm" /></span>
                </span>
              {:else if i === m.rotateIdx}
                <span class="rot-tile"><Tile pai={t} size="sm" /></span>
              {:else}
                <Tile pai={t} size="sm" face={fulouTileFaceDown(m, i) ? 'down' : 'up'} />
              {/if}
            {/each}
          </span>
        {/each}
        {#if winnerHuapai.length > 0 || winnerNuki > 0 || winnerNukiGold > 0}
          <span class="winner-hua">
            {#each winnerHuapai as t}<Tile pai={t} size="sm" />{/each}
            {#each Array(winnerNuki) as _, i}<Tile pai="z4" size="sm" />{/each}
            {#each Array(winnerNukiGold) as _, i}<Tile pai="gN" size="sm" />{/each}
          </span>
        {/if}
      </div>
    {/if}
    </div>
  </div>

  <div class="split-box box-chip">
    <h3 class="box-tab"><span class="tab-ja">祝儀</span><span class="tab-en" lang="en">CHIP</span></h3>
    <div class="box-body">
    {#if huleResult.shuvariUsedThisRound}
      <div class="shuvari-used">⚡ シュバ棒使用 [祝儀 ×2 適用]</div>
    {/if}
    {#if huleResult.fuyuLog?.length}
      <div class="fuyu-row">
        <span class="fuyu-label">冬めくり:</span>
        {#if hideFuyuResult}
          <span class="fuyu-hidden">[金北強化決定後に表示]</span>
        {:else}
          {#each huleResult.fuyuLog as fl}
            <span class="fuyu-tile {fl.hit > 0 ? 'fuyu-hit' : 'fuyu-miss'}">
              <Tile pai={fl.pai} size="sm" />
              <span class="fuyu-mark {fl.hit > 0 ? 'hit' : 'miss'}">{fl.hit > 0 ? `+${fl.hit}` : '×'}</span>
            </span>
          {/each}
          <span class="fuyu-sum">合計 {huleResult.fuyuLog.reduce((a: number, f: any) => a + f.hit, 0)} 枚</span>
        {/if}
      </div>
    {/if}
    <slot name="chip" />
    </div>
  </div>
</section>

<style>
  /* [2026-10-29 サイバー B / P4] 暗い板。打点 [線の色] と祝儀 [差し色の赤] は別の枠に分ける。
     字は折り返さない [nowrap]、長い物は空白と括弧の所だけで折る [keep-all]。大きさは clamp で幅に合わせて縮める */
  section.hule-panel {
    border: 1px solid var(--cy-line);
    background: var(--cy-panel-solid);
    padding: 10px 14px;
    border-radius: 0;
    margin: 12px 0;
    color: var(--cy-ink);
  }
  .top-line {
    display: flex;
    align-items: center;
    gap: 8px 14px;
    flex-wrap: wrap;
    padding: 6px 4px 12px;
    border-bottom: 1px solid var(--cy-dim);
    margin-bottom: 4px;
  }
  .agari-kind {
    display: inline-flex;
    align-items: center;
    padding: 4px 16px;
    clip-path: var(--cy-cut-s);
    background: var(--cy-line);
    color: var(--cy-on-line);
    font-family: var(--cy-font-label);
    font-size: clamp(15px, 4.2vw, 18px);
    font-weight: 700;
    letter-spacing: 0.2em;
    white-space: nowrap;
    animation: kindStamp 0.4s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  .winner {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 800;
    color: var(--cy-ink);
    font-size: clamp(17px, 5vw, 26px);
  }
  .score {
    color: var(--cy-sub-ink);
    font-size: clamp(14px, 4vw, 20px);
    font-weight: 600;
    white-space: nowrap;
  }
  .tier-chip {
    padding: 3px 12px;
    clip-path: var(--cy-cut-s);
    font-size: clamp(13px, 3.6vw, 15px);
    font-weight: 700;
    letter-spacing: 0.15em;
    white-space: nowrap;
    color: #fff;
    animation: kindStamp 0.45s 0.25s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  .tier-big { background: var(--cy-hot); }
  .tier-yakuman { background: linear-gradient(120deg, var(--cy-hot), #ffb13b); color: #1a0a02; }
  .defen {
    margin-left: auto;
    font-weight: 800;
    font-size: clamp(18px, 5.6vw, 28px);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .defen-unit { font-family: var(--cy-font-label); font-size: 0.55em; font-weight: 700; margin-left: 4px; color: var(--cy-sub-ink); text-shadow: none; }
  @keyframes kindStamp {
    0% { transform: scale(1.9); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }

  /* 打点 ・ 祝儀の枠。左上の札が枠の種類 */
  .split-box {
    --tone: var(--cy-line);
    --tone-ink: var(--cy-on-line);
    position: relative;
    margin: 20px 0 6px;
    padding: 26px clamp(8px, 2.4vw, 14px) 12px;
    border: 1px solid var(--tone);
    background: color-mix(in srgb, var(--tone) 6%, var(--cy-panel-solid));
    box-shadow: inset 0 0 28px color-mix(in srgb, var(--tone) 14%, transparent);
    clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
    min-width: 0;
  }
  .box-chip { --tone: var(--cy-hot); --tone-ink: #fff; background: color-mix(in srgb, var(--tone) 7%, var(--cy-panel-solid)); }
  .box-tab {
    position: absolute;
    top: 0;
    left: 0;
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 0.9em;
    padding: 3px 18px 3px 12px;
    clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
    background: var(--tone);
    color: var(--tone-ink);
    font-family: var(--cy-font-label);
    font-size: 13px;
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: 0.18em;
    white-space: nowrap;
  }
  .tab-en { letter-spacing: 0.22em; }
  .box-body { min-width: 0; }

  .yaku-list { margin: 8px 0 2px; display: flex; flex-wrap: wrap; gap: 6px; }
  .yaku-chip {
    max-width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--cy-dim);
    background: var(--cy-faint);
    padding: 4px 12px;
    font-size: clamp(13px, 3.6vw, 17px);
    font-weight: 700;
    color: var(--cy-ink);
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
  .dora-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .dora-label { font-size: clamp(12px, 3.4vw, 16px); color: var(--cy-sub-ink); margin-right: 2px; font-weight: 700; white-space: nowrap; }
  .fuyu-row { display: flex; align-items: center; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
  .fuyu-hidden { font-size: 13px; color: var(--cy-sub-ink); }
  .fuyu-label { font-size: clamp(12px, 3.4vw, 16px); color: var(--cy-sub-ink); font-weight: 700; white-space: nowrap; }
  .fuyu-tile { display: inline-flex; align-items: center; gap: 2px; padding: 2px 4px; border: 1px solid var(--cy-dim); }
  .fuyu-tile.fuyu-hit { background: color-mix(in srgb, var(--cy-line) 16%, transparent); border-color: var(--cy-line); }
  .fuyu-tile.fuyu-miss { background: color-mix(in srgb, var(--cy-hot) 12%, transparent); border-color: color-mix(in srgb, var(--cy-hot) 55%, transparent); }
  .fuyu-mark { font-size: 18px; font-weight: bold; }
  .fuyu-mark.hit { color: var(--cy-pt); }
  .fuyu-mark.miss { font-size: 22px; color: var(--cy-hot); }
  .fuyu-sum { font-size: clamp(12px, 3.4vw, 16px); color: var(--cy-line); font-weight: 700; margin-left: 8px; white-space: nowrap; }

  .payment-row { display: flex; gap: 8px 10px; align-items: center; margin-top: 8px; flex-wrap: wrap; font-size: 15px; }
  .payment-label { flex: 0 0 100%; text-align: left; color: var(--cy-sub-ink); font-size: clamp(12px, 3.4vw, 16px); font-weight: 700; white-space: nowrap; }
  .payment-cell {
    flex: 1 1 190px;
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 5px 12px;
    background: color-mix(in srgb, var(--cy-line) 6%, transparent);
    border: 1px solid var(--cy-dim);
    font-weight: 700;
    white-space: nowrap;
    font-variant-numeric: normal;
  }
  .payment-cell .payment-player { font-size: 12px; color: var(--cy-sub-ink); font-weight: 800; }
  .payment-cell .payment-delta { font-size: clamp(14px, 4vw, 18px); }
  .payment-cell .payment-after { font-size: clamp(11px, 3vw, 13px); color: var(--cy-sub-ink); font-weight: 600; }
  .payment-cell.gain { color: var(--cy-pt); border-color: color-mix(in srgb, var(--cy-pt) 60%, transparent); }
  .payment-cell.loss { color: var(--cy-hot); border-color: color-mix(in srgb, var(--cy-hot) 60%, transparent); background: color-mix(in srgb, var(--cy-hot) 8%, transparent); }
  .payment-cell.zero { color: var(--cy-sub-ink); }

  .winner-hand { display: flex; gap: 3px; align-items: center; margin-top: 12px; flex-wrap: wrap; padding: 6px; background: rgba(0, 0, 0, 0.35); border: 1px solid var(--cy-faint); }
  .winner-hand-label { font-size: clamp(13px, 3.6vw, 14px); color: var(--cy-sub-ink); font-weight: 700; margin-right: 8px; white-space: nowrap; }
  .fulou-mianzi { display: inline-flex; gap: 1px; padding: 0 4px; border-left: 1px dashed var(--cy-dim); align-items: flex-end; }
  .fulou-mianzi .rot-tile { display: inline-block; transform: rotate(90deg); transform-origin: center; margin: 0 4px; }
  .fulou-mianzi .kakan-col { display: inline-flex; flex-direction: column; align-items: center; }
  .fulou-mianzi .kakan-col .rot-tile { margin: -4px 4px; }
  .winner-hua { display: inline-flex; gap: 1px; padding: 0 4px; border-left: 1px solid var(--cy-line); }
  .shuvari-used { font-size: clamp(14px, 3.8vw, 16px); font-weight: 700; color: var(--cy-hot); margin: 4px 0; word-break: keep-all; overflow-wrap: anywhere; }
  .agari-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    margin-top: 12px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--cy-line) 8%, transparent);
    border: 1px solid var(--cy-dim);
  }
  .agari-label { font-size: clamp(14px, 3.8vw, 16px); font-weight: 700; color: var(--cy-line); }
  .agari-from { font-size: 12px; color: var(--cy-sub-ink); margin-left: 4px; font-weight: 500; white-space: nowrap; }
  .agari-tile-wrap { display: inline-flex; padding: 2px 4px; background: #fff; }
</style>
