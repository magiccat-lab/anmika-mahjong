# アンミカ三麻 開発進捗 + TODO [2026-05-14 07:45 JST 時点]

## 公開 URL

https://anmika.magiccatlab.com/

## ✅ 完了済 [今夜 50+ commits]

### 基本三麻
配 / ツモ / 打牌 / ロン / ツモ / リーチ [2 段階] / ポン / カン [暗 / 加 / 大明] / 北抜き / 流局 [アンミカ: ノーテン罰なし、 流し役満のみ点数移動] / 親流れ [子アガリのみ] / 連荘 [親アガリ] / 半荘終了 + 順位パネル

### 判定
厳密フリテン / 喰い替え禁止 / 面前ダマ禁止 [役満除く]

### 点数
三麻独自 [親 / 子ロン×6/×4、 親ツモ各×2、 子ツモ親×2+子×1] / 役満 / 三倍満 / 倍満 / 跳満 / 満貫上限 / 五倍 / 六倍役満 / 本場 ロン+2000 / ツモ各+1000 / リーチ供託 / 抜きドラ翻数加算 / ツモ時のみ +1000 加符 [ロンには加符なし] / 100 切り上げ

### 役 param
立直 / 一発 [pending dapai 猶予込み] / 嶺上 / 槍槓 / 海底河底 / 天和地和 / 場風 / 自風

### アンミカ独自
- 配給原点 35000 / 東風戦 / ノーテン連荘
- 北は河に切れない、 副露直後抜き禁止
- 5p/5s/z4 金牌 [赤 2 + 金 1 + 普通 2]
- 春夏秋冬収納 [効果: 夏ランクアップ / 秋 baopai 物理追加]
- 1m → 7m 化 [山生成]
- 7m を 1m 扱いで国士無双判定 [簡略]
- 白ぽっち 4 色 [青 / 赤 / 緑 / 黄] visualize、 ぽっち オールマイティ ツモ判定
- フィーバー立直 [7m / 7p / 7s 確定暗刻] + 強制ツモ切り + 何度もアガリ + 待ち情報パネル

### UI
牌画像 SVG [FluffyStuff + 独自] / 金 / 赤 表示分け / 場風自風 chip / 手牌ドラ数 / リーチ宣言牌赤枠 / 局結果 panel [表ドラ・裏ドラ表示] / 半荘終了金銀銅 / 牌譜 JSON export / 牌譜 load 表示 / 副露 + 華牌 + 北抜き 表示 / 河の z5 / 金 5 色付き [discardLog 経由]

### AI
CPU 化 / 自動リーチ [待ち枯渇 見送り smart] / 三元牌 ポン / 風牌 自風場風 一致時のみ ポン / 大明槓 [pon と同 基準] / 暗槓 [三元 4 枚揃いのみ] / リーチ家現物優先打牌 [+10 / 非現物 -5] / リーチ後自動カン + 自動ツモ切り / フィーバー時ツモ切り強制 / pickBestDiscard ukeire [視認枯渇 考慮版、 他家手 + 全 player 河 visible 引算] / 金牌 / 赤 5 / 7 暗刻 / m9 / z5 残し優先

### debug
- 「🧪 フィーバーセット」 button: m7×3 + p123 + s4-s8 + z1z1 [3-6-9 三面待ち]
- 「🧪 ぽっち手 セット」 button

## ❌ 残 TODO [優先度順]

### 高: 動作 bug 残 [現状]
- フィーバー 2 回目以降ロン取れない疑惑 [77520d8 で sp.clone fix 済、 reload 待ち]
- フィーバー待ち情報パネル空 [613140a で _zimo null 化 fix 済、 reload 待ち]
- 表ドラ表が空になる場合あり [秋効果関連、 要 reload で再現確認]

### 高: アンミカ独自効果計算
- 春春 / 春の祝儀計算 [1 枚オール、 他華で +1 枚累積]
- 夏夏金北の特殊倍率 [base × 4]
- 秋秋金北 [ハン数分祝儀追加]
- 冬 アリス / 冬冬 チューリップ [現物祝儀]
- 金北の効果 [華牌 1 枚強化、 アガリ時に選ぶ]
- ぽっち効果 [青祝儀倍 / 赤逆祝儀倍 / 緑通常 / 黄逆ぽっち]
- 神ぽっち [正ぽっちがドラ表に出た状態、 任意の牌に]
- オールスター [赤金 4 枚揃いアガリ → サイコロチャンス]
- ダブルフィーバー / トリプルフィーバー [打点 / 祝儀 ×2 / ×4]
- シュバリーチ / シュバサイコロ
- 間八萬 / トントンブー
- ぽっち オールマイティの hule 高め取り [現状ツモ判定のみ、 実 hule で z5 swap 計算未]

### 高: 祝儀 [チップ] ledger
- 各役 / 牌種ごとの祝儀加算 ledger、 半荘集計
- 赤 = +2 / 金 = +4 / 抜きドラ / オールスター / 春春 / 冬アリス etc

### 中
- 順位戦ウマ計算 [+30/0/-30 等、 返り東]
- 7m を 1m 扱いの清老頭 / チャンタ / 純全帯判定 [国士のみ実装済]
- AI 強化 副露 quality 検証 [副露後の pickBestDiscard が合理的か audit] / unit test pure helper 切出
- obs 拡張 + PPO [v5 milestone、 RL 学習効果出てない問題は v4 で確認済]

### 低
- 牌譜再生 [game state で replay]
- UI 雀卓風大改修

## 主要ファイル

- `src/lib/game3.ts` Game3 class、 三麻ゲーム state + 役判定 / 点数計算
- `src/lib/shan3.ts` 山 / ドラ / ぽっち色 / 金 metadata
- `src/lib/store.ts` Svelte store wrapper、 action 集約
- `src/App.svelte` UI、 handTiles で 拡張表記 [gp/gs/gN/bu/br/bg/by/f1-4] 展開
- `src/lib/Tile.svelte` 牌画像 svg 描画
- `public/tiles/` 牌 SVG 51 枚 [FluffyStuff + 独自]
- `docs/api_spec.md` majiang-core API spec + アンミカ対応表
- `docs/progress.md` この doc

## majiang-core 連携の落とし穴

- Shoupai.fulou は方向 mark 直前の数字以外を decrease [pon=2 / 大明槓=3]
- He.fulou は _pai を減らさない、 mianzi 直渡し
- hule param に zhuangfeng / menfeng / lizhi / yifa / haidi / tianhu 全部渡す必要
- ron pai は方向 [+/=/-] 必須
- _zimo に mianzi 文字列が入る [副露擬似 zimo state]、 toString は length>2 で除外
- tingpai は _zimo truthy で null 返す → clone + null 化が必要
- hule で sp 内部 mutate の可能性、 clone してから渡す
- 配点計算は 4 麻前提の fenpei 配列、 三麻独自 base 計算は自前

詳細は `docs/api_spec.md` 参照。
