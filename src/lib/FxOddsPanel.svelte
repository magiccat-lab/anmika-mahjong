<script lang="ts">
  // 演出一覧 (2026-10-15 リョー「演出別の%とか出してほしい。トップページに演出一覧ってボタン押してそこから見れるようにページ出して。
  // 無演出でも出ると思うけどその確率も」)。数は fxOdds が本番の演出の関数から数えた物で、手で書いていない。
  // 出る割合 = その演出が出る割合、当たり = 出た時に当たりだった割合 (パチスロの信頼度)。無演出の行は灰色の札
  import { diceBallRows, diceReachRows, pct, pochiOpeningRows, pochiStepRows, pochiTeaserGlowRows, type OddsRow } from './fxOdds';
  import { CUTIN_TIER_DURATION_MS } from './store';

  export let onClose: () => void = () => {};

  const sec = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;
  const sections: { title: string; lead: string; rows: OddsRow[]; hitLabel: string }[] = [
    { title: '白ぽっち: 引いた瞬間', lead: 'リーチ中に自分で白ぽっちを引いた時、どれか 1 つが必ず出ます。予告の無い引きはありません', rows: pochiOpeningRows(), hitLabel: '当たり' },
    { title: '白ぽっち: 稲妻と決め台詞の光り', lead: '稲妻 ・ 決め台詞の光りの色は、絞りの光りが上がる所と同じです', rows: pochiTeaserGlowRows(), hitLabel: '当たり' },
    { title: '白ぽっち: 絞りの光り (ステップアップ)', lead: '絞ると光りが白 → 青 → 緑 → 金 → 虹と上がります。どこで止まるか。白のままが無演出です', rows: pochiStepRows(), hitLabel: '当たり' },
    { title: 'サイコロチャンス: 玉の色', lead: '1 振りごと。宣言した 2 つの目がそろえば当たり、ゾロ目はリプレイ', rows: diceBallRows(), hitLabel: '当たり' },
    { title: 'サイコロチャンス: リーチ', lead: '1 振りごと。宣言した目が 1 個目に出るとリーチ', rows: diceReachRows(), hitLabel: '当たり' },
  ];
  // 条件を満たすと必ず出る演出 (割合は 100%)
  const always: [string, string, string][] = [
    ['リーチ ・ ポン ・ カン', '宣言した時', `軽 ${sec(CUTIN_TIER_DURATION_MS.light)}`],
    ['ツモ ・ ロン', '和了った時', `中 ${sec(CUTIN_TIER_DURATION_MS.mid)}`],
    ['フィーバー', 'フィーバーを宣言した時', `重 ${sec(CUTIN_TIER_DURATION_MS.heavy)} ・ 紙吹雪`],
    ['四華 ・ 四北 ・ 八華 ・ 四華四北', '華と北がそろった時', `中 ${sec(CUTIN_TIER_DURATION_MS.mid)}`],
    ['八華四北', '華 8 枚と北 4 枚がそろった時', `重 ${sec(CUTIN_TIER_DURATION_MS.heavy)} ・ 紙吹雪`],
    ['役の帯 (一発 ・ 槍槓 ・ 嶺上開花 ・ 海底摸月 ・ 河底撈魚)', 'その役で和了った時', `中 ${sec(CUTIN_TIER_DURATION_MS.mid)}`],
    ['役の帯 (天和 ・ 地和)', 'その役で和了った時', `中 ${sec(CUTIN_TIER_DURATION_MS.mid)} ・ 紙吹雪`],
    ['N 連続の札', 'フィーバー中に同じ人が続けて和了った時', '2 連続 金 ・ 3 連続 赤 ・ 4 連続から 虹'],
    ['良い牌の光', '自分が赤 5 ・ 金 ・ 虹 ・ 華を引いた時', '1.4 秒'],
    ['溜め (暗くしてスロー)', '白ぽっちを点がのぞく手前まで絞った時', '毎回'],
    ['確定の帯', '見えている牌で白ぽっちの正 ・ 逆が決まっている時', '1.1 秒'],
  ];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" on:click|self={onClose}>
  <div class="panel" role="dialog" aria-label="演出一覧">
    <div class="head">
      <h2>演出一覧</h2>
      <button class="close" on:click={onClose}>閉じる</button>
    </div>
    <p class="lead">出る割合はその演出が出る割合、当たりは出た時に当たりだった割合 (パチスロの信頼度) です。
      白ぽっちは見えている牌にまだ白ぽっちが 1 枚も出ていない時 (当たりが 4 色中 2 色の 50%) の数です。</p>
    <div class="body">
      {#each sections as s}
        <h3>{s.title}</h3>
        <p class="sub">{s.lead}</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>演出</th><th class="num">出る割合</th><th class="num">{s.hitLabel}</th></tr></thead>
            <tbody>
              {#each s.rows as r}
                <tr class:none={r.none}>
                  <td class="name">{r.name}{#if r.none}<span class="tag">無演出</span>{/if}{#if r.note}<span class="memo">{r.note}</span>{/if}</td>
                  <td class="num">{pct(r.rate)}</td>
                  <td class="num" class:sure={r.hit === 1}>{r.hit === 1 ? '確定' : pct(r.hit)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}
      <h3>条件を満たすと必ず出る演出</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>演出</th><th>出る時</th></tr></thead>
          <tbody>
            {#each always as a}
              <tr><td class="name">{a[0]}<span class="memo">{a[2]}</span></td><td>{a[1]}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 60; padding: 16px; box-sizing: border-box;
  }
  .panel {
    width: min(820px, 100%); max-height: 88vh; display: flex; flex-direction: column;
    background: #1c2a22; color: #e8f0ea;
    border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 12px;
    padding: 14px 16px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }
  .head { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
  h2 { margin: 0; font-size: 1.1rem; color: #ffe9ad; }
  .close { background: #345; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  .lead { margin: 8px 0; font-size: 12px; line-height: 1.55; color: #9fb3a6; }
  .body { overflow: auto; padding-right: 4px; }
  h3 { font-size: 1rem; margin: 14px 0 4px; color: #ffe9ad; border-bottom: 1px solid rgba(255, 233, 173, 0.25); padding-bottom: 3px; }
  .sub { margin: 2px 0 6px; font-size: 12px; color: #cfe3d5; }
  .table-wrap { overflow-x: auto; margin: 4px 0 10px; }
  table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
  th, td { border: 1px solid rgba(255, 255, 255, 0.15); padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: rgba(255, 233, 173, 0.12); color: #ffe9ad; white-space: nowrap; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sure { color: #ffd75a; font-weight: 700; }
  .name { min-width: 9em; }
  .memo { display: block; margin-top: 2px; font-size: 11px; color: #a9bdb0; }
  tr.none td { color: #a9b5ad; }
  .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 3px; background: #4a5650; color: #e8f0ea; font-size: 10px; vertical-align: 1px; }
</style>
