
// 三麻用の山 [tile wall]
// majiang-core の Shan は 4 人 4 牌種完全使用。 三麻では tile set バリエーションがあるので
// 自前で生成する。 山の API [zimo / gangzimo / paishu] は majiang-core 互換にしておく。

import type { Pai, SanmaTileSet } from './types';

const RINSHAN_CAPACITY = 16;

export interface ShanRule {
  /** 赤牌枚数。 例: { m: 0, p: 1, s: 1 } */
  hongpai: { m: number; p: number; s: number };
  /** 三麻の牌構成 */
  tileSet: SanmaTileSet;
  /** 裏ドラあり */
  fudora: boolean;
}

export type BlindDrawEntry = {
  tile: Pai;
  huapai: Pai[];
  gold: boolean;
  pochi: 'blue' | 'red' | 'green' | 'yellow' | null;
};

export class Shan3 {
  private _rule: ShanRule;
  private _pai: Pai[];          // 山 [後ろから zimo されていく、 live wall のみ]
  // R24 P2 #5/#12 fix: 嶺上牌は live wall とは別 region。
  // 旧 code は _pai.shift() で前から取りつつ _baopai/_fubaopai は _pai[4,5,9,10] の string copy で
  // 同じ tile が嶺上 [gangzimo] と ドラ表示 で 二重参照、 多回カン / 華牌 skip で 表示中ドラを実際引ける bug
  // 新: 構築時に 16 枚の rinshan reserve + 4 枚の dora indicator を _pai から物理切出、 _pai は live wall 専用
  private _rinshan: Pai[];
  // _gold 配列は撤去 [gp/gs/gN 別 key 化済、 牌 key 自体で金識別、 互換のため空配列]
  private _gold: boolean[] = [];
  private _baopai: Pai[];       // 表ドラ [tile 値の copy ではなく 物理切出 tile そのもの]
  private _fubaopai: Pai[] | null; // 裏ドラ
  private _weikaigang: boolean;
  private _closed: boolean;
  /** 直前の zimo / gangzimo で出した牌が金だったか */
  lastZimoGold: boolean = false;
  /** カンによって追加したドラの回数。秋ドラ等の追加表示とは別枠で最大4回。 */
  kanDoraCount: number = 0;

  private _blind = false;
  private _blindQueue: BlindDrawEntry[] = [];
  private _blindDoraQueue: Pai[] = [];
  private _blindPaishu = 0;
  /** Authoritative legality bit supplied with an online projection.  It
   * reveals no reserve identity, but prevents an all-flower tail from
   * advertising a kan that the server must reject. */
  private _blindCanDrawRinshan: boolean | null = null;
  /** 冬 [アリス / チューリップ] で live wall から公開済みの物理牌。 */
  _fuyuRevealed: Pai[] = [];

  get isBlind(): boolean { return this._blind; }

  /** Remaining physical tiles in the replacement reserve.  A projected
   * online wall cannot expose their identities, so reconstruct the count
   * from the authoritative consumed count instead. */
  get rinshanRemaining(): number {
    return this._blind
      ? Math.max(0, RINSHAN_CAPACITY - this.rinshanUsed)
      : this._rinshan.length;
  }

  /** Whether at least one physical reserve tile can still be extracted.
   * North extraction uses this weaker predicate so an all-flower tail can be
   * consumed before the hand ends in an exhaustive draw. */
  get hasRinshanTile(): boolean {
    return this.rinshanRemaining > 0;
  }

  /** Whether a kan can obtain an actual replacement tile after auto-skipping
   * flowers.  Online projections carry this legality bit without exposing
   * hidden faces; the remaining-count fallback supports older projections. */
  get canDrawRinshan(): boolean {
    if (this._blind) return this._blindCanDrawRinshan ?? this.hasRinshanTile;
    return this._rinshan.some((pai) => !pai.startsWith('f'));
  }

  static createBlind(opts: {
    rule: ShanRule;
    baopai: Pai[];
    fubaopai: Pai[] | null;
    paishu: number;
    kanDoraCount?: number;
    canDrawRinshan?: boolean;
  }): Shan3 {
    const shan = new Shan3(opts.rule);
    shan._pai = [];
    shan._rinshan = [];
    shan._baopai = [...opts.baopai];
    shan._fubaopai = opts.fubaopai ? [...opts.fubaopai] : null;
    // blind [オンライン] は server projection の baopai を丸ごと受け取る。
    // server 側で displayBaopai 相当を送るため、ここは全量を確定扱いにする
    shan._committedBaopaiLen = shan._baopai.length;
    shan._committedFubaopaiLen = shan._fubaopai?.length ?? 0;
    shan._initialPai = [];
    shan._blind = true;
    shan._blindPaishu = opts.paishu;
    shan.kanDoraCount = opts.kanDoraCount ?? 0;
    shan._blindCanDrawRinshan = opts.canDrawRinshan ?? null;
    return shan;
  }

  feedDraw(draw: BlindDrawEntry & { paishu?: number }): void {
    this._blindQueue.push({ tile: draw.tile, huapai: draw.huapai, gold: draw.gold, pochi: draw.pochi });
    if (draw.paishu !== undefined) this._blindPaishu = draw.paishu;
  }

  feedDora(tile: Pai): void { this._blindDoraQueue.push(tile); }

  setBaopai(baopai: Pai[], fubaopai: Pai[] | null): void {
    this._baopai = [...baopai];
    this._fubaopai = fubaopai ? [...fubaopai] : null;
    // setBaopai で差し替えた分は全量確定表示扱い
    this._committedBaopaiLen = this._baopai.length;
    this._committedFubaopaiLen = this._fubaopai?.length ?? 0;
  }

  /** A kan needs one new front indicator and, when ura-dora is enabled, its
   * paired back indicator. With only the lower tile left the rules require
   * play to continue without declaring the otherwise-forced kan. */
  get canOpenKanDora(): boolean {
    // オンラインの blind 山は未和了時の裏ドラ現物を null で秘匿するが、
    // 物理的な裏表示枠まで無いわけではない。必要残枚数は公開状態ではなく
    // 局ルールで判定する。
    const requiredIndicators = this._rule.fudora ? 2 : 1;
    return this.kanDoraCount < 4 && this.paishu >= requiredIndicators;
  }

  /** 初期 shuffle 後の _pai snapshot [牌譜再現用、 split 前の full pool] */
  _initialPai: Pai[] = [];
  /** constructor: rule + 任意で pre-shuffled pool [オンライン対戦 同期用、 リョー指示 2026-05-13] */
  constructor(rule: ShanRule, preShuffledPool?: Pai[]) {
    this._rule = rule;
    let raw: Pai[];
    if (preShuffledPool && preShuffledPool.length > 0) {
      raw = [...preShuffledPool];
    } else {
      const all = generateTilePool(rule);
      raw = [];
      while (all.length) {
        raw.push(all.splice(Math.floor(Math.random() * all.length), 1)[0]);
      }
    }
    this._initialPai = [...raw];
    // R24 P2 #5/#12 fix: 物理切出
    // 1) 表 dora 2 枚 を raw[4..] から取って raw から remove [華牌も表示可]
    // 2) 裏 dora 2 枚 を 残り raw[4..] から取って raw から remove [fudora=true 時、華牌も表示可]
    // 3) 嶺上 reserve 16 枚 を raw 先頭 から取って raw から remove [華牌混入 OK、 gangzimo で skip 処理]
    // 4) 残り raw を _pai [live wall] とする
    const removeAt = (arr: Pai[], startIdx: number, count: number): Pai[] => (
      arr.splice(startIdx, Math.min(count, Math.max(0, arr.length - startIdx)))
    );
    this._baopai = removeAt(raw, 4, 2);
    this._fubaopai = rule.fudora ? removeAt(raw, 4, 2) : null;
    // 嶺上 16 枚 [先頭から]、 raw 不足時は ある分のみ
    const rinshanCount = Math.min(RINSHAN_CAPACITY, raw.length);
    this._rinshan = raw.splice(0, rinshanCount);
    this._pai = raw;
    // 金牌は牌 key 自体 [gp/gs/gN] で識別、 _gold 配列は撤去済 [リョー指示 2026-05-10]
    this._weikaigang = false;
    this._closed = false;
    // 初期表示ドラは全量が確定 [局開始時点で見えている分]
    this._committedBaopaiLen = this._baopai.length;
    this._committedFubaopaiLen = this._fubaopai?.length ?? 0;
  }

  /** 山 index → 金フラグ参照 [配牌時に goldHand 集計用、 player 側に渡す] */
  isGoldAt(idx: number): boolean { return this._gold[idx] ?? false; }

  /** リンシャン使用枚数 [カン / 北抜き / 華牌抜き / 秋でドラめくりで +1]
   *  16 まではリンシャンから取って残山に影響なし、 17 以上は残山から消費 */
  rinshanUsed: number = 0;

  /** R22 #3 fix: shan 全 state snapshot [カン失敗 rollback 用]、
   *  rinshanUsed / lastDrawnHuapai / lastZimoGold / lastZimoPochi も含めて完全戻し
   *  R24 P2 #5/#12 fix: _rinshan も snapshot に追加 [物理分離後] */
  snapshot(): {
    pai: Pai[];
    rinshan: Pai[];
    rinshanUsed: number;
    lastDrawnHuapai: Pai[];
    lastZimoGold: boolean;
    lastZimoPochi: 'blue' | 'red' | 'green' | 'yellow' | null;
    kanDoraCount: number;
    weikaigang: boolean;
    baopai: Pai[];
    fubaopai: Pai[] | null;
    committedBaopaiLen: number;
    committedFubaopaiLen: number;
    blindQueue: BlindDrawEntry[];
    blindDoraQueue: Pai[];
    blindPaishu: number;
    fuyuRevealed: Pai[];
  } {
    return {
      pai: [...this._pai],
      rinshan: [...this._rinshan],
      rinshanUsed: this.rinshanUsed,
      lastDrawnHuapai: [...this.lastDrawnHuapai],
      lastZimoGold: this.lastZimoGold,
      lastZimoPochi: this.lastZimoPochi,
      kanDoraCount: this.kanDoraCount,
      weikaigang: this._weikaigang,
      baopai: [...this._baopai],
      fubaopai: this._fubaopai ? [...this._fubaopai] : null,
      committedBaopaiLen: this._committedBaopaiLen,
      committedFubaopaiLen: this._committedFubaopaiLen,
      blindQueue: this._blindQueue.map((d) => ({ ...d, huapai: [...d.huapai] })),
      blindDoraQueue: [...this._blindDoraQueue],
      blindPaishu: this._blindPaishu,
      fuyuRevealed: [...this._fuyuRevealed],
    };
  }
  restore(snap: ReturnType<Shan3['snapshot']>): void {
    this._pai = [...snap.pai];
    this._rinshan = [...(snap.rinshan ?? [])];
    this.rinshanUsed = snap.rinshanUsed;
    this.lastDrawnHuapai = [...snap.lastDrawnHuapai];
    this.lastZimoGold = snap.lastZimoGold;
    this.lastZimoPochi = snap.lastZimoPochi;
    this.kanDoraCount = snap.kanDoraCount ?? 0;
    this._weikaigang = snap.weikaigang;
    this._baopai = [...snap.baopai];
    this._fubaopai = snap.fubaopai ? [...snap.fubaopai] : null;
    // 確定表示枚数も戻す。無い旧 snapshot は現 baopai 全量を確定扱い [後方互換]
    this._committedBaopaiLen = snap.committedBaopaiLen ?? this._baopai.length;
    this._committedFubaopaiLen = snap.committedFubaopaiLen ?? (this._fubaopai?.length ?? 0);
    this._blindQueue = (snap.blindQueue ?? []).map((d) => ({ ...d, huapai: [...d.huapai] }));
    this._blindDoraQueue = [...(snap.blindDoraQueue ?? [])];
    this._blindPaishu = snap.blindPaishu ?? this._blindPaishu;
    this._fuyuRevealed = [...(snap.fuyuRevealed ?? [])];
  }

  /** カン / 秋ドラめくりで 残山を消費する。追加表示牌は配牌時から
   *  王牌との境界側に固定され、通常ツモ（配列末尾）とは反対側から開く。 */
  extraSanReduction: number = 0;

  /** 残り山枚数 [リョー指示: 王牌 20 = リンシャン 16 + ドラ表 2 + 裏ドラ 2 (固定)]
   *  R24 P2 #5/#12 fix: 物理分離後 _pai 自体が live wall 専用、 paishu = _pai.length
   *  drawNewDora は _pai.shift() で深い側から自然に減る、 嶺上は _rinshan から取るので _pai 影響なし */
  get paishu(): number {
    if (this._blind) return this._blindPaishu;
    return this._pai.length;
  }

  /** カン / 北抜き / 華牌抜き / 秋ドラ時のリンシャン消費 +1 [16 まで]
   *  17+ は山切れなので呼ばない設計 */
  consumeRinshan(): void {
    this.rinshanUsed += 1;
  }
  /** ドラ追加 [秋・カン]: 王牌との境界側（_pai 先頭）から固定位置を1枚開き、
   *  baopai/fubaopai の末尾へ追加する。通常ツモは _pai 末尾から進むため、
   *  開く現物は巡目に左右されない。 */
  drawNewDora(isFu: boolean): string | null {
    if (this._blind) {
      const tile = this._blindDoraQueue.shift();
      if (!tile) return null;
      if (isFu) (this._fubaopai ??= []).push(tile);
      else this._baopai.push(tile);
      return tile;
    }
    if (this._pai.length === 0) return null;
    const newPai = this._pai.shift()!;
    // _gold 撤去済
    if (isFu) (this._fubaopai ??= []).push(newPai);
    else this._baopai.push(newPai);
    return newPai;
  }

  /** 後方互換 [旧 consumeWangpai 呼び出し] */
  consumeWangpai(): boolean {
    this.consumeRinshan();
    return true;
  }

  get baopai(): Pai[] { return this._baopai; }
  /** 裏ドラ表 [リーチアガリ時の役判定 + 表示用、 _closed フラグはアガリ確定 hint だが、
   *  hule 呼ぶ時点でアガリ確定なので常に開示する。 「リーチアガリ時のみ集計」 は
   *  呼び出し側 [Game3.hule の isLizhi] が判断する */
  get fubaopai(): Pai[] | null { return this._fubaopai; }

  /** [2026-07-21 リョー報告 秋ドラ表示漏れ 根治] 表示してよいドラ表の枚数。
   *  hule() の秋カスケードは評価中に物理的に _baopai を伸ばすが、和了が確定
   *  [applyHule] するまで、あるいはカン [kaigang] するまでは表示に反映してはいけない
   *  [上がりまで表示増えない]。commitDoraReveal() で確定枚数を現在長に進め、
   *  displayBaopai / displayFubaopai は確定枚数までを返す。採点は _baopai [全量] を
   *  使い続けるため点数計算には一切影響しない。 */
  private _committedBaopaiLen: number = 0;
  private _committedFubaopaiLen: number = 0;
  /** 現在の _baopai / _fubaopai 全量を確定表示扱いにする [局開始 / カン / 和了確定で呼ぶ] */
  commitDoraReveal(): void {
    this._committedBaopaiLen = this._baopai.length;
    this._committedFubaopaiLen = this._fubaopai?.length ?? 0;
  }
  /** 表示用ドラ表 [確定枚数まで]。評価中/modal中の未確定めくりは含めない */
  get displayBaopai(): Pai[] { return this._baopai.slice(0, this._committedBaopaiLen); }
  get displayFubaopai(): Pai[] | null {
    return this._fubaopai ? this._fubaopai.slice(0, this._committedFubaopaiLen) : null;
  }

  /** 直前の zimo で引いた華牌 [f1-f4]、 空配列なら華牌引かなかった */
  lastDrawnHuapai: Pai[] = [];

  /** 直前の zimo で引いた z5 [白] のぽっち色 [blue/red/green/yellow]、 z5 でない時は null */
  lastZimoPochi: 'blue' | 'red' | 'green' | 'yellow' | null = null;

  zimo(): Pai {
    if (this._blind) {
      const draw = this._blindQueue.shift();
      if (!draw) throw new Error('blind shan: zimo queue empty');
      this.lastDrawnHuapai = draw.huapai;
      this.lastZimoGold = draw.gold;
      this.lastZimoPochi = draw.pochi;
      return draw.tile;
    }
    if (this._closed) throw new Error('shan closed');
    if (this.paishu === 0) throw new Error('shan exhausted');
    if (this._weikaigang) throw new Error('kaigang pending');
    this.lastDrawnHuapai = [];
    this.lastZimoPochi = null;
    // R24 P2 #5/#12 fix: _pai は live wall 専用、 王牌 reserve は _rinshan に物理分離済、
    // 旧 code の _pai.length > 14 guard は不要 [全 length で安全に pop 可]
    while (this._pai.length > 0) {
      const pai = this._pai.pop()!;
      const isGold = false; // _gold 撤去済、 牌 key で判定
      if (pai.startsWith('f')) {
        // リョー指示 2026-05-15: 華牌は 残山サイズを 減らさず、 嶺上から 1 枚 _pai 末尾に
        // 補充して 次牌を 取る [本来仕様: 華抜き → 嶺上から補充、 山サイズ不変]
        this.lastDrawnHuapai.push(pai);
        if (this._rinshan.length === 0) {
          // リンシャン枯渇: もう補充できないので 山サイズ -1 のまま loop 継続
          continue;
        }
        const replacement = this._rinshan.shift()!;
        // 実際に王牌から補充した時だけ使用枚数を進める。枯渇後の華牌で
        // 17以上へ増やすと、正規の局面を牌譜v3自身が不正値として弾いてしまう。
        this.consumeRinshan();
        this._pai.push(replacement);
        continue;
      }
      // 金牌は key 自体 [gp/gs/gN] で識別
      this.lastZimoGold = (pai === 'gp' || pai === 'gs' || pai === 'gN') || isGold;
      const colorMap: Record<string, 'blue' | 'red' | 'green' | 'yellow'> = {
        'z5b': 'blue', 'z5r': 'red', 'z5g': 'green', 'z5y': 'yellow',
      };
      this.lastZimoPochi = colorMap[pai] ?? null;
      return pai;
    }
    throw new Error('shan exhausted [during huapai skip]');
  }

  gangzimo(): Pai {
    if (this._blind) {
      const draw = this._blindQueue.shift();
      if (!draw) throw new Error('blind shan: gangzimo queue empty');
      this._weikaigang = true;
      this.lastDrawnHuapai = draw.huapai;
      this.lastZimoGold = draw.gold;
      this.lastZimoPochi = draw.pochi;
      return draw.tile;
    }
    if (this._closed) throw new Error('shan closed');
    if (this.paishu === 0) throw new Error('shan exhausted');
    if (this._weikaigang) throw new Error('kaigang pending');
    if (this.kanDoraCount >= 4) throw new Error('4 kan dora max');
    if (!this.canOpenKanDora) throw new Error('not enough wall tiles for kan dora');
    this._weikaigang = true;
    this.lastZimoGold = false;
    this.lastDrawnHuapai = [];
    this.lastZimoPochi = null;
    const colorMap: Record<string, 'blue' | 'red' | 'green' | 'yellow'> = {
      'z5b': 'blue', 'z5r': 'red', 'z5g': 'green', 'z5y': 'yellow',
    };
    // R20 #2 fix: 嶺上ツモは「リンシャン牌を 1 枚使う」 仕様、 consumeRinshan を呼んで
    // paishu 余分減を防ぐ + 嶺上が花牌の場合 zimo と同様に skip して 次牌を返す、
    // sp.zimo(f*) 失敗で 槓巻き戻りを 防止
    // R24 P2 #5/#12 fix: 嶺上は _rinshan 専用 region から取る、 _pai [live wall] に侵入しない
    // 旧 code は _pai.shift() で前から取って _baopai/_fubaopai と物理衝突してた [二重参照 bug]
    while (this._rinshan.length > 0) {
      const front = this._rinshan.shift()!;
      this.consumeRinshan();
      if (front.startsWith('f')) {
        // 花牌は嶺上から消費したことにして、 lastDrawnHuapai に積み 次牌を 取り直す
        this.lastDrawnHuapai.push(front);
        continue;
      }
      this.lastZimoGold = (front === 'gp' || front === 'gs' || front === 'gN');
      this.lastZimoPochi = colorMap[front] ?? null;
      return front;
    }
    throw new Error('shan exhausted [during gangzimo huapai skip]');
  }

  /** 北抜きの補充牌を王牌から取得する。
   *  槓とは異なりカンドラを開かず、`_weikaigang` も立てない。 */
  nukizimo(): Pai | null {
    if (this._blind) {
      const draw = this._blindQueue.shift();
      if (!draw) throw new Error('blind shan: nukizimo queue empty');
      this.lastDrawnHuapai = draw.huapai;
      this.lastZimoGold = draw.gold;
      this.lastZimoPochi = draw.pochi;
      return draw.tile;
    }
    if (this._closed) throw new Error('shan closed');
    this.lastZimoGold = false;
    this.lastDrawnHuapai = [];
    this.lastZimoPochi = null;
    const colorMap: Record<string, 'blue' | 'red' | 'green' | 'yellow'> = {
      z5b: 'blue', z5r: 'red', z5g: 'green', z5y: 'yellow',
    };
    while (this._rinshan.length > 0) {
      const pai = this._rinshan.shift()!;
      this.consumeRinshan();
      if (pai.startsWith('f')) {
        this.lastDrawnHuapai.push(pai);
        continue;
      }
      this.lastZimoGold = pai === 'gp' || pai === 'gs' || pai === 'gN';
      this.lastZimoPochi = colorMap[pai] ?? null;
      return pai;
    }
    // A reserve tail made entirely of flowers is still extracted, but there
    // is no legal tile to return to the hand.  The store turns this committed
    // extraction into the common exhaustive-draw transition.
    return null;
  }

  /** カン後のドラ表開示 */
  kaigang(): void {
    if (!this._weikaigang) throw new Error('not pending kaigang');
    const requiredIndicators = this._rule.fudora ? 2 : 1;
    if (this.paishu < requiredIndicators) throw new Error('not enough wall tiles for kan dora');
    // カン後のドラ表は配牌時に固定された深い側から 1 枚 [残山 -1]
    this.drawNewDora(false);
    if (this._fubaopai) this.drawNewDora(true);
    this.kanDoraCount += 1;
    this._weikaigang = false;
    // カンドラは即公開 [秋カスケードと違い上がり待ちしない] なので確定表示に進める
    this.commitDoraReveal();
  }

  close(): void { this._closed = true; }
}

/** 三麻の牌種 pool 生成 */
export function generateTilePool(rule: ShanRule): Pai[] {
  const pai: Pai[] = [];
  const hongpai = rule.hongpai;

  // 萬子: tileSet によって含める番号を切替
  // アンミカルール 1.5 「数牌の萬子は 1m を 7m として扱う」 → 山には 7m と 9m のみ [計 8 枚]
  let mansuRange: number[];
  if (rule.tileSet === 'tenhou') {
    mansuRange = [1, 9]; // 天鳳サンマ: 1m と 9m
  } else if (rule.tileSet === 'jansoul') {
    mansuRange = [7, 9]; // アンミカ準拠: 1m → 7m 化、 7m と 9m のみ
  } else {
    mansuRange = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  }
  for (const n of mansuRange) {
    for (let i = 0; i < 4; i++) {
      if (n === 5 && i < hongpai.m) pai.push('m0');
      else pai.push('m' + n);
    }
  }

  // 筒子・索子は 1-9 各 4 枚
  // アンミカ: 5p/5s 4 枚のうち 赤 1 + 金 1 + 通常 2 [金は別 key で識別]
  // アンミカ: 3p/3s 4 枚のうち 虹 1 + 通常 3
  for (const s of ['p', 's'] as const) {
    for (let n = 1; n <= 9; n++) {
      for (let i = 0; i < 4; i++) {
        if (n === 5) {
          if (i === 0) pai.push((s === 'p' ? 'gp' : 'gs') as any); // 金 5p / 金 5s
          else if (i < 1 + hongpai[s]) pai.push(s + '0'); // 赤
          else pai.push(s + n); // 通常
        } else if (n === 3 && i === 0 && rule.tileSet === 'jansoul') {
          pai.push((s === 'p' ? 'np3' : 'ns3') as any); // 虹 3p / 虹 3s
        } else {
          pai.push(s + n);
        }
      }
    }
  }

  // 字牌 1-7 [東南西北白發中] 各 4 枚
  // アンミカ独自:
  //   z5 [白] は 4 色別牌: z5b [青] / z5r [赤] / z5g [緑] / z5y [黄]
  //   z4 [北] 4 枚のうち 1 枚を 金北 [gN]、 残り 3 枚は通常 z4
  for (let n = 1; n <= 7; n++) {
    if (n === 5) {
      pai.push('z5b' as any);
      pai.push('z5r' as any);
      pai.push('z5g' as any);
      pai.push('z5y' as any);
    } else if (n === 4) {
      pai.push('gN' as any); // 金北 1 枚
      for (let i = 0; i < 3; i++) pai.push('z4');
    } else if (n === 3 && rule.tileSet === 'jansoul') {
      pai.push('nz3' as any); // 虹西 1 枚
      for (let i = 0; i < 3; i++) pai.push('z3');
    } else {
      for (let i = 0; i < 4; i++) pai.push('z' + n);
    }
  }

  // アンミカ独自: 華牌 春夏秋冬 [f1-f4] 各 2 枚 = 計 8 枚
  for (let n = 1; n <= 4; n++) {
    pai.push('f' + n);
    pai.push('f' + n);
  }

  return pai;
}

/** 三麻のデフォルト rule [5p / 5s 各4枚 = 通常2・赤1・金1] */
export function defaultSanmaRule(): ShanRule {
  return {
    hongpai: { m: 0, p: 1, s: 1 },
    tileSet: 'jansoul',
    fudora: true,
  };
}
