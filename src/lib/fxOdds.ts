// 演出一覧のページ (2026-10-15 リョー「演出別の%とか出してほしい。トップページに演出一覧ってボタン押してそこから見れるように」
// 「無演出でも出ると思うけどその確率も」) の数。手で書いた表にせず、本番の演出を決めている関数 (pochiFx ・ diceFx) に
// 0〜1 の乱数を細かく順に入れて数える。演出の割合を変えたらこのページの数も一緒に変わる。
//  - 出る割合: その演出が出る割合 (白ぽっちは 1 回引くごと、サイコロは 1 振りごと)
//  - 当たり: その演出が出た時に当たりだった割合 (パチスロの「信頼度」)
import { delayRoll, expectationStep, freezeRoll, lampRoll, premiumRoll, teaserRoll, type PochiFreeze } from './pochiFx';
import { ballColor, planRoll, type BallColor } from './diceFx';

// img: 演出一覧に出す絵 (public/fx_odds/<img>.webp、本物の卓で撮ったコマ)。ball: サイコロの玉の色 (絵の代わりに玉を描く)
export type OddsRow = { name: string; rate: number; hit: number | null; note?: string; none?: boolean; img?: string; ball?: BallColor };

/** 乱数の目の数。決まりの区切り (0.03 ・ 0.06 ・ 0.1 …) が割り切れる細かさ */
const N = 1000;
const grid = (): number[] => Array.from({ length: N }, (_, i) => (i + 0.5) / N);

type PochiOutcome = { good: boolean; p: number; freeze: PochiFreeze | null; premium: boolean; teaser: 'bolt' | 'line' | 'mono' | 'none' | null; step: number };

/** 白ぽっちを 1 回引いた時に起こり得る形と、その割合 (当たりの元の割合 pGood、見えている牌で決まっていない時) */
export function pochiOutcomes(pGood = 0.5): PochiOutcome[] {
  const out: PochiOutcome[] = [];
  const g = grid();
  for (const good of [true, false]) {
    const base = good ? pGood : 1 - pGood;
    for (const freeze of ['black', 'still', null] as const) {
      const pf = g.filter((r) => freezeRoll(good, r) === freeze).length / N;
      if (pf === 0) continue;
      if (freeze) {
        // フリーズは予告とプレミアの代わり。光りは虹まで
        out.push({ good, p: base * pf, freeze, premium: false, teaser: null, step: 4 });
        continue;
      }
      for (let step = 0; step <= 4; step += 1) {
        const ps = g.filter((r) => expectationStep(good, r) === step).length / N;
        if (ps === 0) continue;
        const pPrem = g.filter((r) => premiumRoll(step, r)).length / N;
        if (pPrem > 0) out.push({ good, p: base * pf * ps * pPrem, freeze: null, premium: true, teaser: null, step });
        for (const teaser of ['mono', 'none', 'line', 'bolt'] as const) {
          // 予告の乱数は 2 つ (白黒かどうか ・ 稲妻か決め台詞か)。2 つ目は半々の区切りだけなので 0.25 と 0.75 の 2 点で足りる
          let n = 0;
          for (const r1 of g) for (const r2 of [0.25, 0.75]) if (teaserRoll(good, r1, r2) === teaser) n += 1;
          out.push({ good, p: base * pf * ps * (1 - pPrem) * (n / (N * 2)), freeze: null, premium: false, teaser, step });
        }
      }
    }
  }
  return out;
}

function row(name: string, outs: PochiOutcome[], pick: (o: PochiOutcome) => boolean, extra: Partial<OddsRow> = {}): OddsRow {
  const hitP = outs.filter((o) => pick(o) && o.good).reduce((a, o) => a + o.p, 0);
  const all = outs.filter(pick).reduce((a, o) => a + o.p, 0);
  return { name, rate: all, hit: all > 0 ? hitP / all : null, ...extra };
}

/** 引いた瞬間の演出 (どれか 1 つが必ず出る) */
export function pochiOpeningRows(pGood = 0.5): OddsRow[] {
  const o = pochiOutcomes(pGood);
  return [
    row('フリーズ (暗転)', o, (x) => x.freeze === 'black', { note: '画面と音が止まって真っ暗、明けにキュイン', img: 'freeze_black' }),
    row('フリーズ (止め絵)', o, (x) => x.freeze === 'still', { note: '卓が止まって白黒、明けにキュイン', img: 'freeze_still' }),
    row('プレミア (サビ)', o, (x) => x.premium, { note: '虹の光線とアンミカーニバルのサビ', img: 'premium' }),
    row('予告「白黒」', o, (x) => x.teaser === 'mono', { note: '外れでも出るガセあり', img: 'teaser_mono' }),
    row('予告「白って 200 色あんねん」', o, (x) => x.teaser === 'line', { img: 'teaser_line' }),
    row('予告「稲妻」', o, (x) => x.teaser === 'bolt', { img: 'teaser_bolt' }),
    row('無演出 (予告なし)', o, (x) => x.teaser === 'none', { none: true, note: '予告が何も出ないまま絞りに入る', img: 'teaser_none' }),
  ];
}

/** [2026-10-15 fx10] 引いた後の演出 (告知ランプ ・ 遅れ)。引いた瞬間の演出とは別に決まる。
 *  遅れはフリーズの時は出ない (引いた音が鳴らない) ので、フリーズの分を除いて数える */
export function pochiExtraRows(pGood = 0.5): OddsRow[] {
  const g = grid();
  const share = (good: boolean, pick: (r: number) => boolean): number => {
    const noFreeze = g.filter((r) => freezeRoll(good, r) === null).length / N;
    return noFreeze * (g.filter(pick).length / N);
  };
  const mk = (name: string, good: number, bad: number, extra: Partial<OddsRow> = {}): OddsRow => {
    const rate = pGood * good + (1 - pGood) * bad;
    return { name, rate, hit: rate > 0 ? (pGood * good) / rate : null, ...extra };
  };
  const lamp = (good: boolean, t: 'pre' | 'post'): number => g.filter((r) => lampRoll(good, r) === t).length / N;
  return [
    mk('告知ランプ (先告知)', lamp(true, 'pre'), lamp(false, 'pre'), { note: '引いた瞬間に画面の外周が金に光る', img: 'lamp_pre' }),
    mk('告知ランプ (後告知)', lamp(true, 'post'), lamp(false, 'post'), { note: 'めくれた後に画面の外周が金に光る', img: 'lamp_post' }),
    mk('遅れ (ピキーンが 0.3 秒遅れる)', share(true, (r) => delayRoll(true, r)), share(false, (r) => delayRoll(false, r)), { note: '音だけの演出。牌と画面は普通に動く' }),
  ];
}

const STEP_NAME = ['白のまま (光りが上がらない)', '青まで', '緑まで', '金まで', '虹まで'];
/** 絞りの光り (ステップアップ) がどこまで上がるか。白のままが無演出 */
export function pochiStepRows(pGood = 0.5): OddsRow[] {
  const o = pochiOutcomes(pGood);
  return [4, 3, 2, 1, 0].map((k) => row(STEP_NAME[k], o, (x) => x.step === k, { img: `step${k}`, ...(k === 0 ? { none: true } : {}) }));
}

/** 稲妻と決め台詞の光りの色 (虹 = 最高段が虹、金 = 金、白 = それより下) */
export function pochiTeaserGlowRows(pGood = 0.5): OddsRow[] {
  const o = pochiOutcomes(pGood).filter((x) => x.teaser === 'line' || x.teaser === 'bolt');
  const total = o.reduce((a, x) => a + x.p, 0);
  return [
    row('虹', o, (x) => x.step >= 4, { img: 'bolt_rainbow' }),
    row('金', o, (x) => x.step === 3, { img: 'bolt_gold' }),
    row('白', o, (x) => x.step <= 2, { none: true, img: 'bolt_white' }),
  ].map((r) => ({ ...r, rate: r.rate / total }));
}

type DiceOutcome = { p: number; reach: boolean; ball: BallColor; outcome: 'hit' | 'zoro' | 'miss' };

/** サイコロを 1 振りした時の形と割合 (宣言した 2 つの目がそろえば当たり、ゾロ目はリプレイ) */
export function diceOutcomes(): DiceOutcome[] {
  const out: DiceOutcome[] = [];
  const combo: [number, number] = [1, 6]; // どの 2 つの目でも割合は同じ
  const g = grid();
  for (let d1 = 1; d1 <= 6; d1 += 1) {
    for (let d2 = 1; d2 <= 6; d2 += 1) {
      const zoro = d1 === d2;
      const pair: [number, number] = [Math.min(d1, d2), Math.max(d1, d2)];
      const hit = !zoro && pair[0] === combo[0] && pair[1] === combo[1];
      const plan = planRoll(combo, { dice: [d1, d2], hit, zoro }, [0]);
      for (const ball of ['rainbow', 'gold', 'blue', 'white'] as const) {
        const pb = g.filter((r) => ballColor(plan.outcome, r) === ball).length / N;
        if (pb > 0) out.push({ p: pb / 36, reach: plan.reach, ball, outcome: plan.outcome });
      }
    }
  }
  return out;
}

function diceRow(name: string, outs: DiceOutcome[], pick: (o: DiceOutcome) => boolean, extra: Partial<OddsRow> = {}): OddsRow {
  const all = outs.filter(pick).reduce((a, o) => a + o.p, 0);
  const hitP = outs.filter((o) => pick(o) && o.outcome === 'hit').reduce((a, o) => a + o.p, 0);
  const zoroP = outs.filter((o) => pick(o) && o.outcome === 'zoro').reduce((a, o) => a + o.p, 0);
  return { name, rate: all, hit: all > 0 ? hitP / all : null, note: all > 0 ? `ゾロ目 ${pct(zoroP / all)}` : undefined, ...extra };
}

export function diceBallRows(): OddsRow[] {
  const o = diceOutcomes();
  return [
    diceRow('玉 虹', o, (x) => x.ball === 'rainbow', { ball: 'rainbow' }),
    diceRow('玉 金', o, (x) => x.ball === 'gold', { ball: 'gold' }),
    diceRow('玉 青', o, (x) => x.ball === 'blue', { ball: 'blue' }),
    diceRow('玉 白', o, (x) => x.ball === 'white', { none: true, ball: 'white' }),
  ];
}

export function diceReachRows(): OddsRow[] {
  const o = diceOutcomes();
  return [
    diceRow('リーチ (宣言した目が 1 個目に出る)', o, (x) => x.reach),
    diceRow('リーチ無し', o, (x) => !x.reach, { none: true }),
  ];
}

export function pct(x: number | null): string {
  if (x === null) return '—';
  const v = x * 100;
  if (v === 0) return '0%';
  if (v === 100) return '100%';
  return `${v < 1 ? v.toFixed(2) : v.toFixed(1)}%`;
}
