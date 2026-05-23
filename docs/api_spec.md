# anmika-mahjong API spec [majiang-core 仕様 + アンミカ独自対応表]

実装で遭遇した bug の根本原因はだいたい majiang-core の API 仕様理解不足、
場当たり patch の積み上げ防止用に主要 spec を集約。

## 1. Shoupai [手牌] API

`@kobalab/majiang-core/lib/shoupai.js`

### 重要な内部 state

| field | 型 | 役割 |
|---|---|---|
| `_bingpai` | `{m:[10], p:[10], s:[10], z:[8], _:N}` | 各牌種の枚数。 `[0]` は赤牌マーカー、 z は 1-7 のみ。 `_` は不明牌 [他家視点] |
| `_zimo` | `string \| null` | ツモ牌 [`"m1"`等] / 副露 mianzi 文字列 / null |
| `_fulou` | `string[]` | 副露 mianzi 配列 [`["m1m1m1+", "z6z6z6-"]` 等] |
| `_lizhi` | `boolean` | リーチ済 |

### `valid_pai(p)` / `valid_mianzi(m)`

牌 / 面子の表記正規化。 不正なら `undefined`。 fulou / dapai が内部で使う。

### `dapai(p)`

打牌。 内部で `decrease(s, n)` 呼び出し。 throw 条件:
- `_zimo == null` [ツモ前 + 副露ナシなら不可]
- `valid_pai(p)` 不通過
- `decrease` で枚数不足 [手牌に該当牌ナシ + `_bingpai._ == 0`]

dapai 後 `_zimo = null`。

### `fulou(m)` ★トラブル多発

**仕様**: `m` 内の全数字 [pon=3 / 大明槓=4] を `_bingpai` から `decrease` する。
- ポン時: 手牌 2 枚 + 鳴き牌 1 枚 = 全 3 枚を decrease する **前提**、
  鳴き牌は事前に `_bingpai` に追加しておく必要 [呼び出し側責任]
- 副露成立後 `_zimo = m` [mianzi 文字列] がセット → toString で表示崩れ要因
- 大明槓も同様、 4 枚 decrease 前提

throw 条件: `_zimo != null` / `valid_mianzi` 不通過 / `_bingpai` 枚数不足 / 4 桁 form / 加槓 form。

### `gang(m)`

槓。 暗槓 [`m1m1m1m1`] / 加槓 [`m1m1m1+1`] の 2 系統で分岐。 必要なら 嶺上ツモを別途呼ぶ。

### `get_dapai(check_qideng=true)`

打牌可能な牌候補を返す。 引数 `true` で喰い替え check ON。

### `get_peng_mianzi(p)` / `get_gang_mianzi(p?)`

副露候補を返す。 `p` には方向 [+/=/-] 必須、 mianzi 戻り値は 全形 [3 牌 + 方向]。

### `clone()`

deep copy、 シミュレーション [シャンテン推定 / 候補打牌試行] 用。

## 2. He [河] API

`he.js`

| method | 役割 |
|---|---|
| `dapai(p)` | 打牌履歴を `_pai` に push、 方向 mark を strip |
| `fulou(m)` | **`_pai` の最後の牌に方向マーカーを付ける、 _pai は減らさない**。 mianzi 末尾の方向と河末尾の牌が一致しないと throw |
| `find(p)` | 既出牌 lookup |

⚠️ **副露時に `_pai.pop()` してから `fulou(last)` を呼ぶと throw**。 mianzi をそのまま渡せばよい。

## 3. Shan [山] API

`shan.js`

| method | 役割 |
|---|---|
| `paishu` | 残り山枚数 [王牌 14 引いた数] |
| `zimo()` | 山末尾からツモ |
| `gangzimo()` | 王牌から嶺上ツモ、 `_weikaigang=true` |
| `kaigang()` | カンドラ表開示 |
| `baopai` / `fubaopai` | 表 / 裏ドラ表示牌配列 |

## 4. xiangting [シャンテン]

`xiangting.js` の `Majiang.Util` 経由で expose。

| function | 役割 |
|---|---|
| `xiangting(shoupai)` | シャンテン数。 -1 = 和了形、 0 = 聴牌、 N = 何枚替えれば聴牌か |
| `tingpai(shoupai)` | 待ち牌の文字列配列 [聴牌 or 和了形時のみ意味あり] |
| `xiangting_yiban` / `_qidui` / `_guoshi` | 一般形 / 七対子 / 国士の個別判定 |

## 5. hule [和了 / 点数計算] ★param 不足が bug 多発

`hule.js`、 `Majiang.Util.hule(shoupai, rongpai, param)`。

### `rongpai` 引数

ロン時のみ非 null、 末尾に方向 [+/=/-] **必須**。 自摸時は null。
- 方向: 自分から見た放銃者の方向 [+ = 上家、 = 対面、 - = 下家]
- 例: `"m5+"` = 上家から放銃された 5m

### `param` の構成 [hule_param で初期化]

| key | 型 | 意味 |
|---|---|---|
| `rule` | `Object` | rule.js の rule object [一発あり / 裏ドラあり / 数え役満あり 等] |
| `zhuangfeng` | `0-3` | 場風 [0=東 / 1=南 / 2=西 / 3=北] |
| `menfeng` | `0-3` | 自風 [0=親 / 1=南家 / 2=西家 / 3=北家]、 三麻なら 0-2 |
| `hupai.lizhi` | `0/1/2` | 0=リーチなし / 1=リーチ / 2=ダブルリーチ |
| `hupai.yifa` | `bool` | 一発 |
| `hupai.qianggang` | `bool` | 槍槓 |
| `hupai.lingshang` | `bool` | 嶺上開花 |
| `hupai.haidi` | `0/1/2` | 0=普通 / 1=海底ツモ / 2=河底ロン |
| `hupai.tianhu` | `0/1/2` | 0=普通 / 1=天和 / 2=地和 |
| `baopai` | `string[]` | 表ドラ表示牌 |
| `fubaopai` | `string[] \| null` | 裏ドラ表示牌、 リーチ時のみ非 null |
| `jicun.changbang` | `int` | 本場 |
| `jicun.lizhibang` | `int` | リーチ供託棒数 |

### 戻り値

```ts
{
  hupai: [{name, fanshu, baojia?}, ...],  // 役一覧 + パオ家方向
  fu: number,
  fanshu: number,
  damanguan: number,    // 役満倍率 [0=非役満]
  defen: number,        // winner 純益 [本場 / 供託込み]
  fenpei: [4 要素 array],  // 各 player の点数増減 [4 麻前提]
}
```

### 三麻での扱い

`fenpei` は 4 要素配列で 4 麻前提、 三麻では 北家分 [index 3] を扱わない or 親 / 子配分を別途計算する必要。
今の `Game3.applyHule` は `result.fu` / `result.fanshu` から 三麻独自の base × 2 (親ツモ各) / × 2 + × 1 (子ツモ親 + 子) で計算してる、 `fenpei` 値は使わない。

## 6. rule.js [Majiang.rule]

`Majiang.rule(override?)` で rule object を作る。 デフォルト [4 麻向け]:

| key | default | アンミカでの目標 |
|---|---|---|
| `配給原点` | 25000 | 35000 [40000 返し] |
| `順位点` | ['20.0','10.0','-10.0','-20.0'] | 三麻なら 3 要素 |
| `クイタンあり` | true | true [ルール準拠] |
| `喰い替え許可レベル` | 0 | 0 [禁止] |
| `場数` | 2 [東南] | 1 [東風] |
| `途中流局あり` | true | 確認必要 |
| `流し満貫あり` | true | 確認必要 |
| `ノーテン罰あり` | true | false [アンミカ: ノーテン流局なし、 2026-05-23 audit] |
| `最大同時和了数` | 2 [ダブロン] | 2 [ダブロンあり] |
| `連荘方式` | 2 [テンパイ連荘] | 0 [親流れナシ、 ノーテン親流れナシ] |
| `トビ終了あり` | true | true |
| `オーラス止めあり` | true | true [アガリ止め] |
| `一発あり` | true | true |
| `裏ドラあり` | true | true |
| `カンドラあり` | true | 確認必要 |
| `カン裏あり` | true | 確認必要 |
| `カンドラ後乗せ` | true | 確認必要 |
| `ツモ番なしリーチあり` | false | 確認必要 |
| `リーチ後暗槓許可レベル` | 2 | 2 [待ち変わらない暗槓のみ] |
| `役満の複合あり` | true | true |
| `ダブル役満あり` | true | true [夏夏で打点 4 倍等あり] |
| `数え役満あり` | true | 13 ハン以上で役満 |
| `役満パオあり` | true | 確認必要 |
| `切り上げ満貫あり` | false | 確認必要 |

⚠️ アンミカ独自 [赤金 4 種 / 春夏秋冬 / 北抜き / ぽっち / フィーバー / シュバリーチ / オールスター / 神ぽっち / 金北 / アリス / チューリップ 等] は majiang-core にナシ、 全部 自前で 後段加算。

## 7. アンミカ独自仕様の majiang-core 上の扱い

### 萬子 7m として扱う 1m

`anmika_rules.md 1.5` 「数牌の萬子は 1m を 7m として扱う」。
- 山生成では `anmika` tileset で 1-9 萬全部 4 枚生成
- ただしアガリ判定で 「1m は 7m 扱い」 を majiang-core に伝える手段ナシ
- 対応案: 山から 1m 除外 [雀魂サンマ式]、 もしくは hule 後に 「7m を 1m に変換」 して国士 / 字一色判定を再評価

### 北抜き

`Game3.declareNukiBei` は 自前実装、 majiang-core の hule param には 反映してない。
現状: 抜きドラを `result.fanshu` に加算 [fanshu += nuki]、 ただし役満時 [fanshu undefined] は素通し。

### 春夏秋冬 / 赤金 / ぽっち

majiang-core の 牌 type には存在しない、 拡張表記 [f1-4 / gp / gs / gN / br / bg / by / bu] を game state に保持して 別 module で点数 / 祝儀計算する設計。

### 祝儀 [チップ]

majiang-core にナシ、 完全自前実装。 ぽっち / オールスター / 抜きドラ等の集計は別 ledger 必要。

## 8. 現実装の差分 [今後の整備 backlog]

| 項目 | 現状 | あるべき | 優先 |
|---|---|---|---|
| hule param | rule のみ最低限渡してた、 lizhi / 場風 / 自風 ナシ → 立直で役なし扱い | hule_param で全 key 渡し、 リョーが 43eda51 で fix 済 | 完了 |
| hule の rongpai 方向 | 方向ナシで渡してた | `+/=/-` 付与必須、 43eda51 で fix 済 | 完了 |
| Shoupai.fulou 前 _bingpai 補正 | 鳴き牌を _bingpai に加えてなかった → throw | declarePon で +1 → 失敗時 -1、 3f69af2 で fix 済 | 完了 |
| Shoupai.fulou 後 _zimo cleanup | _zimo に mianzi 残って手牌に偽 3 枚表示 | declarePon の最後で _zimo=null、 3644efc で fix 済 | 完了 |
| He.fulou の正しい呼び方 | _pai.pop して last 渡してた | mianzi 直渡し、 0639f84 で fix 済 | 完了 |
| 副露方向 +/- 計算 | diff=1 ↔ '-' で逆だった | 反時計回りで diff=1 → '+'、 46dc69a で fix 済 | 完了 |
| リーチ判定で聴牌 check | 抜けてた | canLizhi 経由統一、 b6d24c4 で fix 済 | 完了 |
| 役なし hule null 時の roundEnded | true 設定で親流れ | result null なら早期 return [局継続]、 4f1212b で fix 済 | 完了 |
| 三麻独自 rule object | デフォルト 4 麻 rule のまま | アンミカ向けに 配給原点 35000 / 場数 1 / 連荘方式 0 等 override | TODO 高 |
| 萬子 1m → 7m 扱い | 山生成 / アガリ判定とも未対応 | tileSet 'anmika' で生成 + hule 後の役判定再評価 | TODO 中 |
| 春夏秋冬 / 金 / ぽっち の game state | game3 / shan3 に拡張表記なし | types に追加、 game flow に組込み | TODO 高 |
| 祝儀 [チップ] ledger | ナシ | 別 module、 役 / 牌に応じて加算 | TODO 高 |
| 順位戦 ウマ | ナシ | 半荘終了時に +30/0/-30 等 | TODO 低 |
| ツモ損 / 1000 加符 | ツモのみ +1000 加符 実装済 [ロンには加符なし] | — | 完了 |
| `hupai.yifa` / `lingshang` 渡し | ナシ | リーチ後 1 巡内 / 嶺上ツモアガリで true | TODO 中 |

## 9. 推奨 reading 順

新規開発 / 修正前に必ず:
1. この doc を読む [現状把握]
2. `node_modules/@kobalab/majiang-core/lib/{該当ファイル}.js` を読む [仕様確認]
3. アンミカルール `data/notes/memo/anmika_rules.md` を該当 section だけ再読
4. その上で patch 設計

場当たり的な「動かして throw 出たら catch」 はもう禁止、 仕様読んで然るべき param / state 整備してから実装する。
