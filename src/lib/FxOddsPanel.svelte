<script lang="ts">
  // 演出一覧 (2026-10-15 リョー「演出別の%とか出してほしい。トップページに演出一覧ってボタン押してそこから見れるようにページ出して。
  // 無演出でも出ると思うけどその確率も」)。数は fxOdds が本番の演出の関数から数えた物で、手で書いていない。
  // 出る割合 = その演出が出る割合、当たり = 出た時に当たりだった割合 (パチスロの信頼度)。無演出の行は灰色の札
  // [2026-10-15 リョー「ページが見づらいから、ラフで画像とか入れてあげよう。文字サイズも小さいし。出る割合は～の1行目消そう」
  //  「必ず出る演出は別に画像つけなくていいや」] 行ごとに本物の卓で撮ったコマ (public/fx_odds/、tests/fx_odds_images.spec.ts で撮り直す)、
  //  サイコロの玉は玉の絵。字を大きくし、頭の説明の 1 行は消した。白ぽっちの数の前提 (当たり 50%) は表の下の注に移した
  import { diceBallRows, diceReachRows, pct, pochiCrackRows, pochiExtraRows, pochiGlowRows, pochiOpeningRows, pochiParticleRows, pochiPremiumRows, pochiPulseRows, pochiPushRows, type OddsRow } from './fxOdds';
  import { CUTIN_TIER_DURATION_MS } from './store';

  export let onClose: () => void = () => {};

  const sec = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;
  const sections: { title: string; lead: string; rows: OddsRow[]; hitLabel: string }[] = [
    // [2026-10-25 白ぽっちはムービー + PUSH] 絞りとステップアップは無くなり、①〜⑥ の表をそれぞれ当落で引く
    { title: '白ぽっち: 引いた瞬間', lead: 'リーチ中に自分で白ぽっちを引いた時に、どれか 1 つが出ます。何も出ない無演出でも当たる事があります。牌の絵柄は PUSH を押すまで出ません', rows: pochiOpeningRows(), hitLabel: '当たり' },
    { title: '白ぽっち: 光りの色', lead: '伏せた牌の光りが白 → 青 → 緑 → 赤 → 金 → 虹と上がります。どこで止まるか。見えている牌で決まっている時は正なら虹、逆なら白です', rows: pochiGlowRows(), hitLabel: '当たり' },
    { title: '白ぽっち: 光りの脈打ち', lead: '止まった色でどう光るか', rows: pochiPulseRows(), hitLabel: '当たり' },
    { title: '白ぽっち: 発展の粒子', lead: '光りが赤以上の時だけ暗転して粒が出ます (緑以下では引いても見えません)', rows: pochiParticleRows(), hitLabel: '当たり' },
    { title: '白ぽっち: 溜めのひび', lead: '発展の後、光りが止まって牌にひびが入ります (赤以上の時だけ)', rows: pochiCrackRows(), hitLabel: '当たり' },
    { title: '白ぽっち: PUSH ボタン', lead: '押すと牌がめくれます。ボタンの色', rows: pochiPushRows(), hitLabel: '当たり' },
    { title: '白ぽっち: 引いた後', lead: '告知ランプと遅れは、他の演出とは別に決まります。当たりなら告知ランプが必ずどちらかで光ります', rows: pochiExtraRows(), hitLabel: '当たり' },
    { title: '白ぽっち: プレミア (当たりだけ)', lead: '当たりの時だけ、他の演出に上乗せで出ます', rows: pochiPremiumRows(), hitLabel: '当たり' },
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
    ['春春金北 ・ 夏夏金北 ・ 秋秋金北 ・ 冬冬金北', '同じ季節の華 2 枚と金北がそろった時', `中 ${sec(CUTIN_TIER_DURATION_MS.mid)}`],
    ['役の帯 (一発 ・ 槍槓 ・ 嶺上開花 ・ 海底摸月 ・ 河底撈魚)', 'その役で和了った時', `中 ${sec(CUTIN_TIER_DURATION_MS.mid)}`],
    ['役の帯 (天和 ・ 地和)', 'その役で和了った時', `中 ${sec(CUTIN_TIER_DURATION_MS.mid)} ・ 紙吹雪`],
    ['煽り「どっから切っとんねーん！」 (声つき)', '2 シャンテン以上から振り込んだ時 (ロンの前)', `中 ${sec(CUTIN_TIER_DURATION_MS.mid)}`],
    ['役満放銃 (声つき)', '役満に振り込んだ時 (煽りの代わり)', `中 ${sec(CUTIN_TIER_DURATION_MS.mid)}`],
    ['N 連続の札','フィーバー中に同じ人が続けて和了った時', '2 連続 金 ・ 3 連続 赤 ・ 4 連続から 虹'],
    ['良い牌の光', '自分が赤 5 ・ 金 ・ 虹 ・ 華を引いた時', '1.4 秒'],
    ['確定の帯', '見えている牌で白ぽっちの正 ・ 逆が決まっている時 (ムービーは短く、PUSH は出る)', '1.1 秒'],
  ];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" on:click|self={onClose}>
  <div class="panel" role="dialog" aria-label="演出一覧">
    <div class="head">
      <h2>演出一覧</h2>
      <button class="close" on:click={onClose}>閉じる</button>
    </div>
    <div class="body">
      {#each sections as s}
        <h3>{s.title}</h3>
        <p class="sub">{s.lead}</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th class="pic"></th><th>演出</th><th class="num">出る割合</th><th class="num">{s.hitLabel}</th></tr></thead>
            <tbody>
              {#each s.rows as r}
                <tr class:none={r.none}>
                  <td class="pic">{#if r.img}<img src={`/fx_odds/${r.img}.webp`} alt="" loading="lazy" />{:else if r.ball}<span class="ball {r.ball}"></span>{/if}</td>
                  <td class="name">{r.name}{#if r.none}<span class="tag">無演出</span>{/if}{#if r.note}<span class="memo">{r.note}</span>{/if}</td>
                  <td class="num">{pct(r.rate)}</td>
                  <td class="num" class:sure={r.hit === 1}>{r.hit === 1 ? '確定' : pct(r.hit)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}
      <p class="foot">白ぽっちの数は、見えている牌にまだ白ぽっちが 1 枚も出ていない時 (当たりが 4 色中 2 色の 50%) の数です</p>
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
    width: min(960px, 100%); max-height: 90vh; display: flex; flex-direction: column;
    background: #1c2a22; color: #e8f0ea;
    border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 12px;
    padding: 14px 16px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }
  .head { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
  h2 { margin: 0; font-size: 1.3rem; color: #ffe9ad; }
  .close { background: #345; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  .body { overflow: auto; padding-right: 4px; }
  h3 { font-size: 1.15rem; margin: 16px 0 4px; color: #ffe9ad; border-bottom: 1px solid rgba(255, 233, 173, 0.25); padding-bottom: 3px; }
  .sub { margin: 2px 0 8px; font-size: 14px; line-height: 1.5; color: #cfe3d5; }
  .foot { margin: 4px 0 10px; font-size: 13px; color: #9fb3a6; }
  .table-wrap { overflow-x: auto; margin: 4px 0 10px; }
  table { border-collapse: collapse; font-size: 15px; min-width: 100%; }
  th, td { border: 1px solid rgba(255, 255, 255, 0.15); padding: 6px 10px; text-align: left; vertical-align: middle; }
  .num { font-size: 17px; }
  td.pic, th.pic { width: 1%; padding: 4px; }
  .pic img { display: block; width: clamp(64px, 18vw, 168px); aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; background: #000; }
  /* スマホの幅でも「当たり」の列まで横に収める (字を大きくした分、見出しは折り返し、余白を詰める) */
  @media (max-width: 560px) {
    .panel { padding: 12px 10px; }
    table { font-size: 14px; }
    .num { font-size: 15px; }
    th, td { padding: 5px 6px; }
    th { white-space: normal; }
    .memo { font-size: 12px; }
    .name { min-width: 0; }
  }
  /* サイコロの玉 (SaiKoroModal の .ball と同じ色) */
  .ball { display: block; width: 34px; height: 34px; margin: 0 auto; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff, #cfd6dd 60%, #8b96a0); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6); }
  .ball.blue { background: radial-gradient(circle at 35% 30%, #cfe6ff, #3a78ff 60%, #10307a); box-shadow: 0 0 12px 4px rgba(80, 140, 255, 0.8); }
  .ball.gold { background: radial-gradient(circle at 35% 30%, #fff6c8, #f2c23a 55%, #8a5a10); box-shadow: 0 0 16px 6px rgba(255, 200, 70, 0.9); }
  .ball.rainbow { background: conic-gradient(#ff3b3b, #ffd23b, #3bff8a, #3bb8ff, #c63bff, #ff3b3b); box-shadow: 0 0 18px 7px rgba(255, 255, 255, 0.8); }
  th { background: rgba(255, 233, 173, 0.12); color: #ffe9ad; white-space: nowrap; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sure { color: #ffd75a; font-weight: 700; }
  .name { min-width: 9em; }
  .memo { display: block; margin-top: 3px; font-size: 13px; color: #a9bdb0; }
  tr.none td { color: #a9b5ad; }
  .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 3px; background: #4a5650; color: #e8f0ea; font-size: 12px; vertical-align: 1px; }
</style>
