/**
 * 河の牌文字列 [Shoupai/He._pai] の印を読む。
 *
 * リーチ宣言牌は game3.dapai が末尾に `__` を足す [ツモ切りの `_` と区別]。
 * 宣言牌が鳴かれると majiang-core の He.fulou がさらに方向印 [+/=/-] を足すので
 * `p0__+` の形になる [2026-10-22 通報 20261022_2: endsWith('__') だけ見ていて横向きが消えた]。
 */
export function isLizhiDeclareEntry(p: string): boolean {
  return /__[\+\=\-]?$/.test(p);
}
