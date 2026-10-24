// 演出一覧のページ (2026-10-15 リョー「演出別の%とか出してほしい。トップページに演出一覧ってボタン押してそこから見れるように」
// 「無演出でも出ると思うけどその確率も」) の数。手で書いた表にせず、本番の演出を決めている表と関数 (pochiFx ・ diceFx) から数える。
// 演出の割合を変えたらこのページの数も一緒に変わる。
//  - 出る割合: その演出が出る割合 (白ぽっちは 1 回引くごと、サイコロは 1 振りごと)
//  - 当たり: その演出が出た時に当たりだった割合 (パチスロの「信頼度」)
// [2026-10-25 白ぽっちはムービー + PUSH に作り直し] 白ぽっちの表は pochiFx の OPENING_TABLE 〜 PUSH_TABLE (当たり時 ・ 外れ時の %) をそのまま読む。
//  出る割合 = 当たりの元の割合 × 当たり時の % + 外れの元の割合 × 外れ時の %。当たり = 当たりの分 ÷ 出る割合
import {
  CRACK_TABLE, DELAY_RATE, GLOW_TABLE, LAMP_PRE_RATE, OPENING_TABLE, PARTICLE_TABLE, PREMIUM_TABLE, PULSE_TABLE, PUSH_TABLE,
  type Crack, type GlowColor, type OddsTable, type Opening, type Particle, type Pulse, type PushLook,
} from './pochiFx';
import { ballColor, planRoll, type BallColor } from './diceFx';

// img: 演出一覧に出す絵 (public/fx_odds/<img>.webp、本物の卓で撮ったコマ)。ball: サイコロの玉の色 (絵の代わりに玉を描く)
export type OddsRow = { name: string; rate: number; hit: number | null; note?: string; none?: boolean; img?: string; ball?: BallColor };

/** 乱数の目の数 (サイコロの数え方で使う)。決まりの区切り (0.03 ・ 0.06 ・ 0.1 …) が割り切れる細かさ */
const N = 1000;
const grid = (): number[] => Array.from({ length: N }, (_, i) => (i + 0.5) / N);

/** 当たり時 %・外れ時 % → 出る割合と当たり */
function mkRow(name: string, goodPct: number, badPct: number, pGood: number, extra: Partial<OddsRow> = {}): OddsRow {
  const rate = (pGood * goodPct + (1 - pGood) * badPct) / 100;
  return { name, rate, hit: rate > 0 ? (pGood * goodPct) / 100 / rate : null, ...extra };
}
/** 表の全行 (order の順) */
function tableRows<K extends string>(table: OddsTable<K>, order: readonly K[], label: Record<K, string | [string, Partial<OddsRow>]>, pGood: number): OddsRow[] {
  return order.map((k) => {
    const l = label[k];
    const [name, extra] = typeof l === 'string' ? [l, {}] : l;
    return mkRow(name, table[k][0], table[k][1], pGood, extra);
  });
}

/** ① 引いた瞬間の演出 (どれか 1 つが必ず出る) */
export function pochiOpeningRows(pGood = 0.5): OddsRow[] {
  const order: Opening[] = ['freeze_black', 'freeze_still', 'premium', 'mono', 'bolt', 'line', 'none'];
  return tableRows(OPENING_TABLE, order, {
    freeze_black: ['フリーズ (暗転)', { note: '画面と音が止まって真っ暗、明けにキュイン', img: 'freeze_black' }],
    freeze_still: ['フリーズ (止め絵)', { note: '卓が止まって白黒、明けにキュイン', img: 'freeze_still' }],
    premium: ['プレミア (サビ)', { note: '虹の光線とアンミカーニバルのサビ', img: 'premium' }],
    mono: ['予告「白黒」', { note: '外れでも出るガセあり', img: 'teaser_mono' }],
    bolt: ['予告「稲妻」', { img: 'teaser_bolt' }],
    line: ['予告「白って 200 色あんねん」', { img: 'teaser_line' }],
    none: ['無演出 (予告なし)', { none: true, note: '予告が何も出ないまま光りの段階に入る', img: 'teaser_none' }],
  }, pGood);
}

/** ② 牌の光りがどの色まで上がるか (白 → 青 → 緑 → 赤 → 金 → 虹) */
export function pochiGlowRows(pGood = 0.5): OddsRow[] {
  const order: GlowColor[] = ['rainbow', 'gold', 'red', 'green', 'blue', 'white'];
  return tableRows(GLOW_TABLE, order, {
    rainbow: ['虹まで', { img: 'step4' }], gold: ['金まで', { img: 'step3' }], red: ['赤まで', { note: '赤から上は発展 (暗転 ・ 粒子 ・ ひび) に入る' }],
    green: ['緑まで', { img: 'step2' }], blue: ['青まで', { img: 'step1' }], white: ['白のまま (光りが上がらない)', { none: true, img: 'step0' }],
  }, pGood);
}
/** ③ 光りの脈打ち */
export function pochiPulseRows(pGood = 0.5): OddsRow[] {
  const order: Pulse[] = ['blink', 'hold', 'fast', 'slow'];
  return tableRows(PULSE_TABLE, order, {
    blink: '一瞬消えて虹で再点灯', hold: '止まって光りっぱなし', fast: '速い鼓動', slow: ['ゆっくり点滅', { none: true }],
  }, pGood);
}
/** ④ 発展の粒子 (光りが赤以上の時だけ見える) */
export function pochiParticleRows(pGood = 0.5): OddsRow[] {
  const order: Particle[] = ['rainbow', 'suck', 'float', 'none'];
  return tableRows(PARTICLE_TABLE, order, {
    rainbow: '虹色の粒', suck: '粒が牌に吸い込まれる', float: '光の粒が舞う', none: ['粒なし', { none: true }],
  }, pGood);
}
/** ⑤ 溜めのひび (光りが赤以上の時だけ見える) */
export function pochiCrackRows(pGood = 0.5): OddsRow[] {
  const order: Crack[] = ['all', 'two', 'one', 'none'];
  return tableRows(CRACK_TABLE, order, {
    all: '牌全体にひび', two: 'ひび 2 本', one: 'ひび 1 本', none: ['ひびなし', { none: true }],
  }, pGood);
}
/** ⑥ PUSH ボタンの色 */
export function pochiPushRows(pGood = 0.5): OddsRow[] {
  const order: PushLook[] = ['rainbow', 'gold', 'red', 'normal'];
  return tableRows(PUSH_TABLE, order, {
    rainbow: 'PUSH 虹', gold: 'PUSH 金', red: 'PUSH 赤', normal: ['PUSH 通常', { none: true }],
  }, pGood);
}

/** [2026-10-15 fx10] ⑦ 引いた後の演出 (告知ランプ ・ 遅れ)。引いた瞬間の演出とは別に決まる。
 *  遅れはフリーズの時は出ない (引いた音が鳴らない) ので、フリーズの分を除いて数える */
export function pochiExtraRows(pGood = 0.5): OddsRow[] {
  const freezeGood = (OPENING_TABLE.freeze_black[0] + OPENING_TABLE.freeze_still[0]) / 100;
  const freezeBad = (OPENING_TABLE.freeze_black[1] + OPENING_TABLE.freeze_still[1]) / 100;
  return [
    mkRow('告知ランプ (先告知)', LAMP_PRE_RATE * 100, 0, pGood, { note: '引いた瞬間に画面の外周が金に光る', img: 'lamp_pre' }),
    mkRow('告知ランプ (後告知)', (1 - LAMP_PRE_RATE) * 100, 0, pGood, { note: 'めくれた後に画面の外周が金に光る', img: 'lamp_post' }),
    mkRow('遅れ (ピキーンが 0.3 秒遅れる)', (1 - freezeGood) * DELAY_RATE.good * 100, (1 - freezeBad) * DELAY_RATE.bad * 100, pGood, { note: '音だけの演出。牌と画面は普通に動く' }),
  ];
}
/** ⑧ プレミア (当たりの時だけ、他の演出に上乗せ) */
export function pochiPremiumRows(pGood = 0.5): OddsRow[] {
  return [
    mkRow('キリン柄', PREMIUM_TABLE.kirin, 0, pGood, { note: '光りの段階で牌の裏がキリン柄になる' }),
    mkRow('復活', PREMIUM_TABLE.revive, 0, pGood, { note: '外れの帯の後に「まだや！」で当たりに変わる' }),
  ];
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
