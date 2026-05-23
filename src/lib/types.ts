
// アンミカ三麻の中核型定義
// majiang-core の Shoupai / Shan などをラップしつつ、 3 人麻雀向けに調整する

// 牌表記は majiang-core の慣習に揃える [m,p,s,z + 数字]、 例: m1, p5, s9, z1
// 赤牌は数字 0、 例: m0 = 赤 5m
export type CorePai = string;

// アンミカ拡張牌。局開始時から別牌として扱い、majiang-core 境界でだけ CorePai に変換する。
export type PochiPai = 'z5b' | 'z5r' | 'z5g' | 'z5y';
export type GoldPai = 'gp' | 'gs' | 'gN';
export type Pai = CorePai | PochiPai | GoldPai;

// プレイヤー位置 [3 麻なので 0,1,2 のみ。 0=東家, 1=南家, 2=西家]
export type Lunban = 0 | 1 | 2;

// プレイヤー識別 [固定 ID]、 起家からの相対 lunban とは別
export type PlayerId = 0 | 1 | 2;

// 試合進行状態
export interface GameState {
  /** 場 [東風 = 0, 南場 = 1, ...]  */
  changbang: number;
  /** 局 [0-2 = 1-3局 / 親番] */
  jushu: number;
  /** 本場 */
  benbang: number;
  /** リーチ供託本数 */
  lizhibang: number;
  /** 親 [PlayerId] */
  qijia: PlayerId;
  /** 各家の点棒 */
  defen: Record<PlayerId, number>;
  /** 巡番 [現在打牌中の lunban、 0=自家] */
  lunban: Lunban;
  /** 終了 flag */
  finished: boolean;
}

// 局の進行イベント [牌譜出力にも使う]
export type GameEvent =
  | { type: 'qipai'; player: PlayerId; tiles: Pai[] }       // 配牌
  | { type: 'zimo'; player: PlayerId; pai: Pai }            // ツモ
  | { type: 'dapai'; player: PlayerId; pai: Pai }           // 打牌
  | { type: 'fulou'; player: PlayerId; from: PlayerId; mianzi: string }  // 副露
  | { type: 'gang'; player: PlayerId; mianzi: string }      // カン
  | { type: 'lizhi'; player: PlayerId; open?: boolean; fever?: boolean; shuvari?: boolean }  // リーチ
  | { type: 'hule'; players: PlayerId[]; details: any }     // 和了
  | { type: 'pingju'; reason: string };                     // 流局

// 三麻の牌構成オプション
export type SanmaTileSet =
  | 'tenhou'      // 萬子 2-8 抜き、 1m/9m + 字牌 + 索子・筒子フル
  | 'jansoul'     // 萬子 1m/9m + 字牌、 1m/9m と字牌の北はそのまま
  | 'anmika';     // アンミカ独自 [萬子 1m → 7m として扱う、 ルール参照]
