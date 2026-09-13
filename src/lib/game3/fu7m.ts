/**
 * 7萬 [m7] を么九牌として符を数えるための補正。
 *
 * ルールブック注記 [`data/notes/anmika_rules.md:60`]:
 *   「7萬はヤオチュー牌とタンヤオ牌の両方の性質を持つ」
 * 符は么九で取るのが素直だが、majiang-core は么九を `/^.*[z19].*$/` で面子文字列に
 * 対して見ているので `m777` に当たらず、中張の 4 / 16 符で数えてしまう。
 * [2026-09-13 リョー裁定「むこうを採用」= 么九扱い。norosh1 は 8 / 32 符で数えている]
 *
 * majiang-core は **切り上げ後の符しか返さない** ので、切り上げ前の生の符が要る。
 * 切り上げ後の値に差分を足して再度切り上げると、生の符が桁の下寄りだった時に
 * 1 段多く上がってしまう [生 32 → 正解 40、40 から計算すると 50]。
 * そのため面子分解ごとに生の符を自前で数え直す。
 *
 * 数え方は majiang-core `lib/hule.js` の `get_hudi` [197-295 行] をそのまま写したもの。
 * 違いは 么九 の判定に m7 を含めるかどうかの 1 点だけ。
 */

/** get_hudi と同じ正規表現群。m7 を么九に含めるかだけ切り替える。 */
const ZIPAI = /^z.*$/;
const KEZI = /^[mpsz](\d)\1\1.*$/;
const ANKEZI = /^[mpsz](\d)\1\1(?:\1|_\!)?$/;
const GANGZI = /^[mpsz](\d)\1\1.*\1.*$/;
const DANQI = /^[mpsz](\d)\1[+=\-_]!$/;
const KANZHANG = /^[mps]\d\d[+=\-_]!\d$/;
const BIANZHANG = /^[mps](123[+=\-_]!|7[+=\-_]!89)$/;
const YAOJIU = /^.*[z19].*$/;
/** m7 の刻子 / 槓子 [順子の m789 等には当てない]。 */
const M7_KEZI = /^m777.*$/;

export interface RawFuOptions {
  zhuangfeng: number;
  menfeng: number;
  /** majiang-core の rule オブジェクト。`連風牌は2符` だけ見る。 */
  rule?: Record<string, unknown> | null;
  /** true なら m7 の刻子 / 槓子を么九として数える。 */
  m7AsYaojiu: boolean;
}

export interface RawFuResult {
  /** 切り上げ前の符。 */
  raw: number;
  /** その分解に m7 の刻子 / 槓子があったか。 */
  hasM7Kezi: boolean;
}

/**
 * 面子分解 1 つぶんの「切り上げ前の符」を数える。
 * 通常手 [面子 5 個] 以外は符の補正対象にならないので null を返す。
 */
export function rawFuOfMianzi(mianzi: string[], opts: RawFuOptions): RawFuResult | null {
  if (!Array.isArray(mianzi) || mianzi.length !== 5) return null;

  const zhuangfengpai = new RegExp(`^z${opts.zhuangfeng + 1}.*$`);
  const menfengpai = new RegExp(`^z${opts.menfeng + 1}.*$`);
  const sanyuanpai = /^z[567].*$/;
  const lianfeng2 = !!(opts.rule && (opts.rule as any)['連風牌は2符']);

  // 明刻 / 明槓にも当てる。暗刻だけに絞る案も牌譜 2,820 局面で測ったが、
  // 「向こうの方が高い」が 18 → 31 に増えて core 不一致も 711 → 721 と悪化したので、
  // 刻子 / 槓子すべてに当てるのが実測では正しい。
  const isYaojiu = (m: string): boolean => (
    YAOJIU.test(m) || (opts.m7AsYaojiu && M7_KEZI.test(m))
  );

  let fu = 20;
  let menqian = true;
  let zimo = true;
  let danqi = false;
  let hasM7Kezi = false;

  // danqi は雀頭の符に効くので、雀頭を見るより先に全面子を走査して確定させる。
  for (const m of mianzi) {
    if (/[+=\-](?!!)/.test(m)) menqian = false;
    if (/[+=\-]!/.test(m)) zimo = false;
    if (DANQI.test(m)) danqi = true;
  }

  for (const m of mianzi) {
    if (m === mianzi[0]) {
      // 雀頭。役牌なら 2 符、単騎待ちならさらに 2 符。
      let head = 0;
      if (zhuangfengpai.test(m)) head += 2;
      if (menfengpai.test(m)) head += 2;
      if (sanyuanpai.test(m)) head += 2;
      head = lianfeng2 && head > 2 ? 2 : head;
      fu += head;
      if (danqi) fu += 2;
    } else if (KEZI.test(m)) {
      let k = 2;
      if (isYaojiu(m)) k *= 2;
      if (ANKEZI.test(m)) k *= 2;
      if (GANGZI.test(m)) k *= 4;
      fu += k;
      if (M7_KEZI.test(m)) hasM7Kezi = true;
    } else {
      if (KANZHANG.test(m)) fu += 2;
      if (BIANZHANG.test(m)) fu += 2;
    }
  }

  const pinghu = menqian && fu === 20;
  if (zimo) {
    if (!pinghu) fu += 2;
  } else if (menqian) {
    fu += 10;
  } else if (fu === 20) {
    fu = 30;
  }

  // ZIPAI は get_hudi 側で n_zipai を数えるだけで符には効かない [参照を残すため使用]
  void ZIPAI;

  return { raw: fu, hasM7Kezi };
}

const ceil10 = (n: number): number => Math.ceil(n / 10) * 10;

/**
 * m7 を么九として数え直した符を返す。補正しない [できない] 時は null。
 *
 * majiang-core がどの分解を採ったかは結果から分からないので、
 * 「切り上げ後が majiang-core の符と一致する分解」を候補にする。
 * 候補が補正後の符で割れた時は、どれを採ったか決められないので補正しない。
 * 安全側に倒して、確実に言い切れる時だけ直す。
 */
export function correctedFuForM7(
  decompositions: string[][],
  currentFu: number | undefined,
  opts: Omit<RawFuOptions, 'm7AsYaojiu'>,
): number | null {
  if (typeof currentFu !== 'number' || !Array.isArray(decompositions)) return null;

  const corrected = new Set<number>();
  for (const mianzi of decompositions) {
    const normal = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: false });
    if (!normal || !normal.hasM7Kezi) continue;
    if (ceil10(normal.raw) !== currentFu) continue;
    const withM7 = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: true });
    if (!withM7) continue;
    corrected.add(ceil10(withM7.raw));
  }
  if (corrected.size !== 1) return null;
  const only = [...corrected][0];
  return only === currentFu ? null : only;
}
