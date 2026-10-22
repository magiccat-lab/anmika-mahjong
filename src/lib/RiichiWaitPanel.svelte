<script lang="ts">
  // [2026-10-22 先輩「リーチ時の待ち牌サジェストも出してあげたいね」]
  // リーチの宣言牌を選ぶ間、候補ごとに「切ったら何待ちか ・ あと何枚見えていないか」を手牌の上に出す。
  // 数は自分の視点 [自分の手牌 ・ 河 ・ 副露 ・ ドラ表示 ・ 抜き北] で数えたもの。他家の手牌は含まない。
  import Tile from './Tile.svelte';
  import { lizhiPaiLabel } from './lizhiUi';
  import type { RiichiWaitSuggestion } from './riichiWaitSuggest';

  export let suggestions: RiichiWaitSuggestion[] = [];
  /** 手牌の候補牌にカーソルを乗せている牌 [PC のみ。見ている行を強調する] */
  export let activePai: string | null = null;

  const strip = (pai: string) => pai.replace(/[_*]$/, '');
</script>

<div class="riichi-wait-panel" role="region" aria-label="リーチ宣言牌ごとの待ち牌と残り枚数">
  <div class="rw-title">切る牌ごとの待ち [自分から見てあと何枚]</div>
  {#each suggestions as s (s.pai)}
    <div class="rw-row" class:active={activePai !== null && strip(activePai) === strip(s.pai)}
         data-riichi-wait={strip(s.pai)} data-total={s.total}>
      <span class="rw-cut" title={`${lizhiPaiLabel(s.pai)}を切る`}>
        <Tile pai={strip(s.pai)} size="sm" /><span class="rw-cut-label">切り</span>
      </span>
      <span class="rw-arrow" aria-hidden="true">→</span>
      {#if s.waits.length === 0}
        <span class="rw-none">待ちを数えられません</span>
      {:else}
        <span class="rw-waits">
          {#each s.waits as w (w.tile)}
            <span class="rw-wait" class:rw-zero={w.unseen === 0} data-unseen={w.unseen ?? 'any'}
                  title={w.unseen === null ? 'ぽっちは何にでもなるので枚数は数えません' : `${lizhiPaiLabel(w.tile)} あと${w.unseen}枚`}>
              <Tile pai={w.tile} size="sm" />
              <span class="rw-count">{w.unseen === null ? 'ぽっち' : `×${w.unseen}`}</span>
            </span>
          {/each}
        </span>
        <span class="rw-total">計 {s.total} 枚</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  /* main.mode-single * { color: inherit } に負けないよう、字の色は !important で決める */
  .riichi-wait-panel {
    box-sizing: border-box;
    max-width: min(560px, calc(100vw - 16px));
    padding: 6px 8px;
    border: 2px solid #d4a63a;
    border-radius: 10px;
    background: rgba(18, 28, 38, 0.96);
    color: #f4ecd6 !important;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
    font-size: 12px;
    line-height: 1.3;
  }
  .rw-title { color: #e8c96a !important; font-weight: 700; font-size: 11px; margin-bottom: 3px; }
  .rw-row {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px;
    padding: 2px 4px; border-radius: 6px; border: 1px solid transparent;
  }
  .rw-row.active { background: rgba(212, 166, 58, 0.22); border-color: #d4a63a; }
  .rw-cut { display: inline-flex; align-items: center; gap: 2px; }
  .rw-cut-label, .rw-arrow, .rw-count, .rw-total, .rw-none { color: #f4ecd6 !important; }
  .rw-arrow { opacity: 0.7; }
  .rw-waits { display: inline-flex; flex-wrap: wrap; gap: 4px; }
  .rw-wait { display: inline-flex; align-items: center; gap: 1px; padding: 1px 3px; border-radius: 5px; background: rgba(255, 255, 255, 0.1); }
  .rw-count { font-weight: 700; font-size: 13px; }
  .rw-wait.rw-zero { opacity: 0.45; }
  .rw-total { font-size: 11px; opacity: 0.85; margin-left: auto; }
  .rw-none { opacity: 0.7; }
</style>
