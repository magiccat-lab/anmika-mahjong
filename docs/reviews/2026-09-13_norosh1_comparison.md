# norosh1.com (別実装「オンミカ！」) との突き合わせ

作成: 2026-09-13 / shun
発端: リョー「norosh1.com の中身解析して既存のオンミカを改善できるか考えたい」
→ 「許可するから yuma に forward して codex 含めて改善案確認して。相違点の確認とかも網羅的に」

先輩の許可済み事項:
- norosh1 の公開牌譜を検証に使ってよい (robots.txt は `User-agent: * / Allow: /`)

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
- `scoreResults` に `yaku[] / totalHan / fu / rankName / baseScore / basicChips / bonusChips / diceChances`

**山も出目も action も全部あるので、決定論リプレイができる。**
= うちのエンジンに流し込んで点数・翻数・チップを 1 局ずつ突き合わせられる。

---

## 3. 突き合わせ結果

### 3-1. 一致していたところ (= 同じルールブック由来の裏付け)

| 項目 | norosh1 | うち |
|---|---|---|
| 順位ウマ (トップ40000以上) | +30 / 0 / -30 | 同じ |
| 順位ウマ (全員40000未満) | +45 / -15 / -30 | 同じ |
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

norosh1 の全 39 項目 (`Wi`):

- 140: 天和地和 / 人和 / 八連荘 / カラス / **三色同順**
- 70: 裸単騎 / 国士 / 国士13面 / 四暗刻 / 四暗刻単騎 / 大三元 / 小四喜 / 大四喜 / 字一色 /
  清老頭 / 緑一色 / 四槓子 / 四連刻 / 大車輪 / 三風 / 間八萬 / 萬子混一色 / 九蓮 / 純正九蓮 /
  八華四北 / 八華 / 四華四北 / **四華** / 四北 / 白暗カン / オールスター / 三色同刻 / 三連刻 /
  **アメリカ七対子** / ぽっち即ツモ / ぽっち0枚ツモ / **春無し流局** / **流し役満** / **全員ノーテン**

うちの `addSai()` 呼び出しは 10 箇所 (三連刻 / 三色同刻 / オールスター / 四華四北:2 / 四北 /
白暗カンアガリ / 八華:1 / 八華:2 / kanpaman:789-extra 70 / kanpaman:789-ron 140) +
汎用の本役満パス。

太字が「うちに対応が見当たらない」候補。ただし**うちは汎用役満サイコロパスがあるので、
grep だけでは判定しきれない**。ここは 3-3 のリプレイ差分で潰すべき。

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
| `winterChipMenzen` / `winterChipOpen` | 2 / 1 (門前と鳴きで差) | `chip_spec.md:45` は「冬 +2/枚オール」一律。**要確認** |
| `shubaNagareChips` | 10 | シュバリーチ流局時の罰符。`chip_spec.md` に記載なし。**要確認** |
| `haruNashiRyukyokuBase/ExpBase` | 4 / 2 (4×2^n) | 春無し流局チップ。記載なし。**要確認** |
| `consecutiveWinCoef/ExpBase` | 2 / 2 (2×2^n) | 連荘ボーナスチップ。記載なし。**要確認** |
| `goldNorthCount` | **2** | `shan3.ts:502` は**金北 1 枚**。**要確認、影響大** |
| `man7Count/pin7Count/sou7Count` | 4 / 4 / 4 | 同じはず (要確認) |
| `pocchi` 4色 各1 | 同じ | ✓ |

`goldNorthCount:2` は山構成そのものが違う可能性があるので、優先度が高い。

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
**符計算・複合役の優先順位・ぽっち逆払い・フィーバー段・ダブロン・返り東の細部は
静的比較では無理**。ここは実データで当てるしかない。

---

## 4. 提案 (yuma / codex に見てほしいところ)

### 提案1: 牌譜リプレイ差分監査 [本命]

6,389 局を落として、うちの `Game3` に流して結果を突き合わせる。

1. `tools/fetch_norosh_replays.mjs` — `/api/replay` を全ページ舐めて `data/norosh/*.json` に保存
   (6,389 局 / 1 局あたり 50KB 前後 → 300MB 前後の見込み。レート制限は未確認なので間隔を空ける)
2. `tools/norosh_adapter.mjs` — 向こうの `wall.tiles[]` / `actions[]` / `diceResults[]` を
   うちの牌表記 (`m1`/`p0`/`gN`/`f1` 等) と action 列に変換
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

### 提案3: 金北 2 枚の確認 [優先]

`shan3.ts:502` は金北 1 枚。norosh1 は `goldNorthCount:2`。
山構成が違うと提案1の照合が全局ズレるので、先に確定させたい。

### 提案4: AI 学習データ

6,389 局は実プレイヤーを含む。今の `tools/` の学習スクリプトの
教師データとして使えるか (ライセンス面も含めて) 見てほしい。

---

## 5. 参考: 手元の作業ファイル

- bundle: `https://norosh1.com/assets/index-8JV5La9W.js` (526KB、sourcemap なし)
- CSS: `https://norosh1.com/assets/index-BFPnPBGl.css`
- 一覧サンプル: `curl -s 'https://norosh1.com/api/replay?limit=1'`
- 対局サンプル: `curl -s 'https://norosh1.com/api/replay/20260913102443-rsnai2'`
