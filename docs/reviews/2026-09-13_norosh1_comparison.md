# norosh1.com (別実装「オンミカ！」) との突き合わせ

作成: 2026-09-13 / shun
発端: リョー「norosh1.com の中身解析して既存のオンミカを改善できるか考えたい」
→ 「許可するから yuma に forward して codex 含めて改善案確認して。相違点の確認とかも網羅的に」

先輩の許可済み事項:
- norosh1 の公開牌譜を検証に使ってよい (robots.txt は `User-agent: * / Allow: /`)


> **2026-09-13 追記: この文書は codex の精査で上書きされました。**
> 正は `tmp/norosh-out/static_review.md` (422行、確度A/B/C付き) です。
> こちらは初動の下調べとして残します。訂正済みですが、以下はこの文書に
> 載っていない codex の追加検出です:
> - 四暗刻単騎: 向こう1役満 / うち2役満
> - 暗槓ありの門前ロン: 向こう40符 / うち50符
> - 食い平和形のロン: 向こう20符 / うち30符
> - 三色同順の対応は、うちの「789三色 [嵌八萬複合]」4翻 + ロン140/追加70 と
>   重複する危険があるので単純な override 追加は不可
> つまり**確定した相違は三色同順だけ、ではありません**。

---

## 1. norosh1.com とは

- タイトル: 「オンミカ！ | オンライン華8アンミカ筋肉五等」
- 説明文: 「華8アンミカ筋肉五等公式ルールブックを忠実に再現した、完全無料、登録不要、
  広告無しの硬派な特殊麻雀 web アプリ」
- うちの `anmika.magiccatlab.com` とは**別チームの別実装**。同じルールブックが原典
- 技術: React + react-router + socket.io (Vite ビルド、sourcemap なし)
- ルート: `/` `/classic` `/experimental` `/replay` `/replay/:gameId`
- ルール版数: `anmika-0.3.5`

### 稼働状況

| 項目 | 値 |
|---|---|
| 公開対局数 | 6,389 局 (2026-09-13 時点) |
| 最古 | 2026-06-07 |
| 最新 | 2026-09-13 |
| プレイヤー名 | 実プレイヤーらしき名前 + CPU 名が混在 |

---

## 2. 公開されている API

認証不要。すべて GET。

| endpoint | 内容 |
|---|---|
| `GET /api/replay?page=N&limit=M` | 対局一覧 (gameId / recordedAt / rule / players) |
| `GET /api/replay/{gameId}` | 対局全体 |
| `GET /api/replay/{gameId}/{round}/a/{n}` | 局内 action 単位 |
| `GET /api/replay/{gameId}/{round}/dice` | サイコロ結果 |
| `GET /api/replay/{gameId}/{round}/a/count` | action 数 |
| `GET /socket.io/` | オンライン対戦の中継 (engine.io v4) |

### 対局 JSON の構造

```
{gameId, recordedAt, rule, gameCount, initialAllGameState, players, rounds[]}
rounds[] = {round, honba, initialState:{gameState, wall}, actions[], scoreResults, diceResults[]}
```

- `wall.tiles[]` が `{suit, num, variant}` で**山まるごと入っている**
- `actions[]` の type: DRAW / DRAW_FLOWER / DRAW_NORTH / PASS / DISCARD / PON / KAN_ADDED /
  RIICHI / TSUMO / RON / NEXT_ROUND / DECLARE_DICE_TARGET / ROLL_DICE / GOLD_NORTH
- `diceResults[]` に出目が入っている
- 牌エンコード (codex 解析): `honor` 8/9/10/11 = 春/夏/秋/冬、`special` は `num:0` +
  `pocchiColor` で色白、金北は `honor` 4 の `variant:"gold"`
- `GOLD_NORTH` は北抜きではなく、未使用の `goldNorths` に対する強化で `targets[]` を選ぶ動作。
  `DRAW_NORTH` とは別物
- `scoreResults` に `yaku[] / totalHan / fu / rankName / baseScore / basicChips / bonusChips / diceChances`

**山も出目も action も全部あるので、決定論リプレイができる。**
= うちのエンジンに流し込んで点数・翻数・チップを 1 局ずつ突き合わせられる。

---

## 3. 突き合わせ結果

### 3-1. 一致していたところ (= 同じルールブック由来の裏付け)

| 項目 | norosh1 | うち |
|---|---|---|
| 順位ウマの値 | +30/0/-30 と +45/-15/-30 | 値は同じ |
| 順位ウマの**判定基準** | `threshold:40000` (誰の点数と比べるかは bundle に無し、サーバー側) | うちは**2着**が40000以上か (`game3.ts:1105-1108`、リョー裁定 2026-05-12/05-21)。**一致は未確認** |
| 返り東しきい値 | 40000 | 同じ |
| 8万点超えチップ | 6 + 2/10k | 同じ (8万=6 / 9万=8 / 10万=10) |
| 赤5 / 金5 / 北 | 2 / 4 / 1 | 同じ |
| 一発 / 裏ドラ | 1 / 1枚 | 同じ (`game3/huleChip.ts:423-429`) |
| 二盃口 / 面前チンイツ / 面前ホンイツ | 15 / 10 / 5 | 同じ |
| 三倍満 | 3 | 同じ |
| トビ賞 | 5 | 同じ |
| 四華四北 / 八華 / 八華四北 | 100 / 100 / 300 | 同じ |
| チャンタ | 門4 / 食2 | 同じ (`game3.ts:3464`) |
| 純チャン | 門6 / 食4 | 同じ (`game3.ts:3465`) |
| ダブリー | 4 | 同じ (`game3.ts:3466-3469`) |
| 混老頭 | 6 | 同じ (`game3.ts:3415`) |
| 一通 | 門2 / 食1 | 同じ (majiang-core 既定) |
| 三色同刻 / 三連刻 | 4翻 + サイコロ70 | 同じ |

チップ体系の主要定数がここまで一致するので、**原典は同じルールブック**と見てよい。

### 3-2. はっきり違うところ

#### (A) 三色同順 ← 最重要

| | norosh1 | うち |
|---|---|---|
| 翻数 | **4翻固定** (食い下がりなし) | 2翻 / 食い1翻 (majiang-core 既定のまま) |
| サイコロチャンス | **140** (最高ランク) | なし |

norosh1 側の実体:

```js
Oa(e) && r.push({name:`sanshoku`, han:4, isYakuman:!1, yakumanCount:0})
Wi = {tenhoChiho:140, renho:140, hachirensho:140, karasu:140, sanshoku:140, rastaSingle:70, ...}
Ui = {..., sanshoku:`三色同順`, ...}   // ラベル対応表で sanshoku = 三色同順 を確認済み
```

サイコロ 140 は 天和・地和 / 人和 / 八連荘 / カラス と同格。うちには**役自体の特別扱いが無い**。

うち側は `src/lib/game3.ts` に三色同順の override が存在しない (`三色同刻` と
`789 三色 [嵌八萬複合]` だけ)。majiang-core `lib/hule.js:360` の 2翻/1翻 がそのまま出ている。

**→ 先輩の裁定待ち。ルールブックに三色同順の記載があるかどうか。**

#### (B) サイコロチャンスの対象・レートの差

> 2026-09-13 訂正: 初版はうちの `addSai()` を正規表現で拾ったため、
> `hasFulou ? 35 : 70` のような三項演算の呼び出しを取りこぼしていた
> (codex 指摘)。下は取り直した全量。

うちの `addSai()` 全量 (`game3.ts`):

| 対象 | うちのレート |
|---|---|
| カラス / 八連荘 / 天和 / 地和 / 人和 | 140 (`YAKUMAN_SAI_BASE`) |
| その他本役満 (汎用) | 70 |
| 嵌八萬+789 ロン / 追加 | 140 / 70 |
| 四華 | 面前70 / 食35 (`game3.ts:3863`) |
| 四華四北 | 1本目 面前70:食35 + 2本目 70 |
| 八華 / 八華四北 | 70 ×2 / 70 ×3 |
| 四北 / 白暗カン / オールスター / 三連刻 / 三色同刻 | 70 |

norosh1 の `Wi` (全39項目) と突き合わせて、**うちに見当たらないのは以下**:

| 項目 | norosh1 |
|---|---|
| **三色同順** | 140 |
| **アメリカ七対子** | 70 (うちは役 4翻×種類数 はあるがサイコロ無し) |
| **春無し流局** | 70 |
| **全員ノーテン** | 70 |

役満系 (国士 / 四暗刻 / 大三元 / 大車輪 / 三風 / 萬子混一色 / 裸単騎 / 九蓮 など) は
うちの「その他本役満 70」で吸収されているので差ではない。
流し役満も `store.ts:3857-3860` に実装済みで差ではない (codex 指摘)。

#### (C) ルールオプションでうちに見当たらないもの

norosh1 の `ruleSet` (対局 JSON にそのまま入っている):

```json
{"variant":"sanma","lastRound":3,"returnEast":true,"returnEastThreshold":40000,
 "streakBonus":true,"consecutiveWinCoef":2,"consecutiveWinExpBase":2,
 "shubaNagareChips":10,
 "haruNashiRyukyokuBase":4,"haruNashiRyukyokuExpBase":2,
 "overscoreBaseChips":6,"overscorePer10k":2,
 "winterActivationDisabled":false,"winterChipMenzen":2,"winterChipOpen":1,
 "springChips":1,
 "rankChips":{"fourthToFirst":30,"third":15,"dealerBonus":6,
   "sanma":{"threshold":40000,"above":[30,0,-30],"below":[45,-15,-30]}},
 "tileSet":{"red5Pin":1,"gold5Pin":1,"red5Sou":1,"gold5Sou":1,
   "man7Count":4,"pin7Count":4,"sou7Count":4,
   "pocchi":{"green":1,"blue":1,"red":1,"yellow":1},"goldNorthCount":2}}
```

| オプション | norosh1 | うちの status |
|---|---|---|
| `winterChipMenzen` / `winterChipOpen` | 2 / 1 | **一致**。`chip_spec.md:45` の記載が一律に見えるだけで、実装は `game3/huleChip.ts:112-118` で門前2/副露1 (codex 指摘)。chip_spec の記述を直すべき |
| `shubaNagareChips` | 10 | シュバリーチ流局時の罰符。`chip_spec.md` に記載なし。**要確認** |
| `haruNashiRyukyokuBase/ExpBase` | 4 / 2 → UI 明記で **4×2^(回数-1)** | 春無し流局チップ。うちに記載・実装なし。**要確認** |
| `consecutiveWinCoef/ExpBase` | 2 / 2 → UI 明記で **係数×2^(連勝-1)**。「連荘」ではなく**連勝** | うちに相当なし。**要確認** |
| `goldNorthCount` | bundle の既定 `Hc` は **1** (うちと同じ)。ただし**実際に打たれている卓の96%が 2** (500局サンプル: 2が96 / 1が4 / ruleSet無し100) | `shan3.ts:502` は**金北 1 枚固定**でオプション無し。**卓設定として2枚を選べるかが論点** |
| `man7Count/pin7Count/sou7Count` | 4 / 4 / 4 | 同じはず (要確認) |
| `pocchi` 4色 各1 | 同じ | ✓ |

> 2026-09-13 訂正: 初版は「norosh 標準が金北2枚」と書いたが誤り。既定値は1で、
> サンプルに引いた対局がたまたま2枚設定だった (codex 指摘)。ただし実際の対局を
> サンプルすると 96% が 2枚なので、**向こうのコミュニティの実運用が2枚**という読みになる。

金北の枚数は山構成そのものを変えるので、提案1のリプレイ監査では
**アダプタが goldNorthCount 2 の卓に対応しないと大半の局が再現しない**。

#### (D) 役ハン表 (norosh1 側の全量、突き合わせ用)

```
riichi 1 / open_riichi 1 / double_riichi 4 / ippatsu 1 / tsumo 1 / pinfu 1 / tanyao 1
iipeiko 1 / ryanpeiko 3 / toitoi 2 / sananko 2 / sankantsu 2 / shosangen 2
honitsu 門3:食2 / chinitsu 門6:食5 / ittsu 門2:食1
chanta 門4:食2 / junchanta 門6:食4 / honroto 6
sanshoku 4 / sanshoku_douko 4 / sanrenkou 4
rinshan 1 / haitei 1 / houtei 1 / chankan 1
mahazan_ron 8 / mahazan_tsumo 8 (ツモは役満扱いの分岐あり)
[役満] tenho x2 / chiho x2 / renho x2 / daisushi x2 / sukantsu x2 / surenkou x2 /
       daisangen / shosushi / tsuiso / chinroto / ryuiso / churenpoton /
       churenpoton_pure (可変) / hachirensho / karasu / sanpuu / daichiirin /
       mahonitsu / nagashi_mangan / rasta_single
[チップ定数] ippatsu1 / uraDora1 / redDora2 / goldDora4 / north1 / ryanpeiko15 /
       menzenChinitsu10 / menzenHonitsu5 / sanbaiman3 / tobisho5 /
       yonkaYonhoku100 / hachika100 / hachikaYonhoku300 /
       yakumanCoefTsumo2 / yakumanConstTsumo-3 / yakumanCoefRon2 / yakumanConstRon2 /
       excessHanCoef1 / akiHanCoef1 / akiSummerCoef2
```

### 3-3. 静的 grep では潰しきれない部分

上の表は minify 済み bundle の読み取りとうちの grep で作った。
**bundle に入っているのは採点関数までで、局進行と流局精算はサーバー側**にある (codex 確認)。
そのため `shubaNagareChips` / `haruNashiRyukyoku*` / `consecutiveWin*` は
定数が見えるだけで発動条件が確定できない。
**符計算・複合役の優先順位・ぽっち逆払い・フィーバー段・ダブロン・返り東の細部は
静的比較では無理**。ここは実データで当てるしかない。

---

## 4. 提案 (yuma / codex に見てほしいところ)

### 提案1: 牌譜リプレイ差分監査 [本命]

6,389 局を落として、うちの `Game3` に流して結果を突き合わせる。

1. `tools/fetch_norosh_replays.mjs` — `/api/replay` を全ページ舐めて `data/norosh/*.json` に保存
   (6,389 局 / 1 局あたり 50KB 前後 → 300MB 前後の見込み。レート制限は未確認なので間隔を空ける)
2. `tools/norosh_adapter.mjs` — 向こうの `wall.tiles[]` / `actions[]` / `diceResults[]` を
   うちの牌表記 (`m1`/`p0`/`gN`/`f1` 等) と action 列に変換。
   codex が拾ったアダプタの罠:
   - `ROLL_DICE` の件数と `diceResults` の件数が合わない (rollCount=0 の「確認」も
     ROLL_DICE を送るので、最後の1件は出目を消費しない)
   - `NEXT_ROUND` はサンプル東1局だけで10件ある。全部 `Game3.nextRound` に流すと壊れる
   - `wall` は `tiles` だけでなく `deadWall` / `doraWall` / `uraDoraWall` と各 index を持つ
   - `scoreResults` は playerId キーの辞書
   - 卓の `goldNorthCount` が 2 の局が大半なので、山生成をオプション化しないと再現不可
3. `tools/norosh_audit.mjs` — 局ごとに再生し、`scoreResults` (役 / 翻 / 符 / 基本点 / チップ内訳)
   をうちの `hule()` 結果と diff。差分を役名別に集計してレポート

これで「どの役・どのチップで何局ズレるか」が数字で出る。3-2 の (B)(C) の
「要確認」も全部これで白黒つく。

論点:
- 向こうが正しいとは限らない。**差分が出た項目は先輩の裁定にかける**のが前提
- アダプタの牌表記対応が地味に重い (華牌 / ぽっち色 / 金北 / 虹)
- 300MB を repo に入れない。`data/norosh/` は gitignore

### 提案2: 三色同順の裁定と実装 [先輩待ち]

裁定が「4翻 + サイコロ140」なら:
- `game3.ts` の fixYakuFan と同じ形で override
- `addSai('三色同順', '三色同順', 140, true)`
- 既存牌譜の点数が変わるので、リグレッションの golden 更新が要る

### 提案3: 金北の枚数をオプション化するか [要裁定]

既定はどちらも 1 枚で一致。ただし norosh1 で実際に打たれている卓は 96% が 2 枚。
うちは `shan3.ts:502` で 1 枚固定なので卓設定として選べない。
ルールブック上 2 枚が正なのか、単に向こうのハウスルールなのかを先輩に確認したい。
提案1 のリプレイ監査を回すには、どちらにせよ山生成の可変化が要る。

### 提案4: AI 学習データ

6,389 局は実プレイヤーを含む。今の `tools/` の学習スクリプトの
教師データとして使えるか (ライセンス面も含めて) 見てほしい。

---

## 5. 参考: 手元の作業ファイル

- bundle: `https://norosh1.com/assets/index-8JV5La9W.js` (526KB、sourcemap なし)
- CSS: `https://norosh1.com/assets/index-BFPnPBGl.css`
- 一覧サンプル: `curl -s 'https://norosh1.com/api/replay?limit=1'`
- 対局サンプル: `curl -s 'https://norosh1.com/api/replay/20260913102443-rsnai2'`
