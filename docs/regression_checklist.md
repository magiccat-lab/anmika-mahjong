# 動作確認チェックリスト [anmika-mahjong refactor 後]

セッション [2026-05-10] で大規模 refactor [component 化 / game3.ts 分割 / 型 fix] を入れたので、ブラウザで以下を一通り通して挙動 regression がないか確認する。

`npm run dev` で起動 → http://localhost:5173 [or 5180]

---

## 1. 起動 / 初期状態
- [ ] 卓が表示される
  - 3 player の手牌 [P0/P1/P2]
  - P0 が現家、ツモ済 [手牌 14 枚、他家 13 枚]
  - 場・局・本場・供託・山残・ドラ表 [HeaderInfo]
- [ ] 各 player の zifeng [自風] が東 / 南 / 西で正しく出る
- [ ] defen 35000 (or 配給原点)、 chip 0、 nukidora 0
- [ ] PlayerStatus の表示順 = 風→点数→向聴→ドラ→リーチ→北→チップ で揃ってる
- [ ] フォントが panel 間で揃ってる [Menlo/Consolas 11-13px]

## 2. 進行 [打牌 / ツモ]
- [ ] ツモ切りで P0 → P1 に手番が回る
- [ ] 任意牌クリックで打牌、手番が次に回る
- [ ] CPU toggle ON → 「🤖 CPU」 button で CPU が打牌、 自動で進む
- [ ] 「⏩ 自動」 button で全 player 連続打牌
- [ ] 山残が 1 ツモごとに 1 減る
- [ ] ZimoHistory に直近 20 件のツモ履歴が出る

## 3. ドラ / 王牌
- [ ] WallPanel に山構成 [上段 / 下段 / 嶺上 / ドラ表 / 裏ドラ表] が出る
- [ ] 牌譜 events に qipai / zimo / dapai が積まれる
- [ ] TileChecker で 116 牌 inventory が overflow / shortage なく揃ってる

## 4. 副露
- [ ] 他家打牌に対し ポン候補 / カン候補が button で出る
- [ ] ポン → 手牌減・副露面子表示
- [ ] カン [明 / 暗 / 加] → 嶺上ツモ・新ドラ表追加
- [ ] スルー で副露しない

## 5. リーチ
- [ ] テンパイ時に 「通常」 button 表示
- [ ] 「シュバ」 [シュバリ] が shuvariUsed=false なら出る
- [ ] feverWaits 条件成立時 「フィバ」 が出る
- [ ] defen >= 2000 で 「オープン」 が出る
- [ ] 「シュバフィバ」 が両条件揃った時に出る
- [ ] リーチ宣言後、 lizhi.has(p)=true、 defen -1000、 供託 +1
- [ ] open リーチで手牌が他家に見える
- [ ] フィーバー後の待ち全消失で 「1 人テンパイ流局」 トリガー [feature commit `dcaf18a` 関連]

## 6. ロン宣言
- [ ] 他家打牌で canRon=true なら「⚠ ロン宣言」表示
- [ ] ロン宣言 → huleResult 表示、 RoundEndPanel に 符 / 翻 / 点数 / 役 chip
- [ ] 表ドラ表、 winnerLizhi 時のみ裏ドラ表
- [ ] 役名一覧が yaku-chip で並ぶ

## 7. ツモ和了
- [ ] 自摸牌でテンパイ → 「🎉 ツモ宣言」
- [ ] z5 暗カン候補時 「🤍 白暗カン」 button が同時表示
- [ ] ツモ和了 → RoundEndPanel + chipBreakdown

## 8. チップ / 祝儀
- [ ] ChipBreakdown に chip 加算式が表示 [例: 北抜き / 赤 / 金 / 流し役満]
- [ ] 流し役満で chip +5 オール
- [ ] applyFuyuChip 系の挙動 [冬使う宣言で chip 加算]
- [ ] applyChipsOnHule 系の挙動 [全パターン: ロン / ツモ / 親子 / 役満]

## 9. Modal 系
- [ ] FuyuModal [冬使う / 保留] が pendingFuyu 時に出る
  - 「使う」 → chip 加算
  - 「保留」 → chip 加算ナシ
- [ ] KinpeiModal [金北 強化対象] が pendingKinpei 時に出る
  - 春夏秋冬の色分け [緑/赤/茶/青]
  - 牌選択で huapai 反映

## 10. 北抜き
- [ ] canNukiBei=true で 「北抜き」 button
- [ ] 抜き → 嶺上ツモ、 nukidora[p] +1、 chip +1

## 11. 流局
- [ ] 山切れで pingju → message に 「流局」
- [ ] テンパイ/ノーテンによる点数移動なし [アンミカ: ノーテン流局なし]
- [ ] 流し役満判定 [全ヤオ + 非副露 + 非リーチ + 非フィーバー]
- [ ] フィーバー宣言中 待ち消失 → 「1 人テンパイ流局」 専用処理

## 12. 局移行
- [ ] roundEnded で 「次局へ」 button 表示
- [ ] 押下 → 場 / 局 / 本場 / 供託 が更新、 山リセット
- [ ] canAgariyame 条件で 「アガリ止め」 button 表示

## 13. 半荘終了
- [ ] state.finished=true で GameEndPanel が出る
- [ ] ranking [defen 順] が出る
- [ ] zifengZ 表示が正しい

## 14. 牌譜 [JSON v2 完全 deterministic]
- [ ] 「牌譜保存」 で JSON v2 download
  - shan.initialPai / currentPai / baopai / fubaopai / rinshanUsed
  - huapai / goldHand / pochiHand / nukidora / kinpeiTarget / chipLedger / akiUsedCount
  - lizhi / openLizhi / feverActive / feverTier / pochiMultiplier / shuvariUsed
- [ ] 「牌譜ロード」 で v2 確認 → 完全復元
  - shoupai / he / 副露 / 全 state が完全一致
  - PaifuLoadPanel で events 順次 replay
  - prev / next button で局面遷移

## 15. デバッグ機能
- [ ] DebugLogPanel に dlog 出力 [`window.__ANMIKA_DEBUG__=true` で ON]
- [ ] revealAll toggle で他家手牌が見える
- [ ] CPU 1/2/3 toggle で個別に CPU 化

## 16. UI 視覚チェック
- [ ] Tile size [sm/md/lg] が用途別に揃ってる
  - HeaderInfo ドラ表 = sm、 手牌 = md、 河 = sm
- [ ] action-row.hot [アガリ / ロン / ポン候補] が強調表示
- [ ] button group [進行 / アガリ / リーチ / 宣言 / 局終了 / システム / debug] が意味別に分かれてる
- [ ] inline style 残置がない [class 化済] → DOM inspector でチェック
- [ ] obsolete style が残ってない → 表示崩れがない

## 17. シュバリ / フィーバー周り
- [ ] シュバリ 1 hit で停止 [tulip flag false 時]
- [ ] アリス [tulip=true] で連続 hit
- [ ] 下段 enable / disable
- [ ] フィーバー tier 判定 [2 種任意組合せ ×2 / 3 種 ×4]
- [ ] pochiMultiplier 反映

## 18. その他 edge case
- [ ] 牌譜 v1 ロード [旧形式] が confirm で復元拒否 / 警告
- [ ] 嶺上ツモ後の山残 / fubaopai 増分
- [ ] z5 [白] の金 / pochi 色変換が正しい [normalizeBaopaiForMajiang]
- [ ] フィーバー成立中の流し役満 不成立

---

## Regression Test 観点 [今回の refactor 起因]
1. **PlayerStatus**: 3 player 行で `[0,1,2] as const` の narrow が効くか → 風 / defen / 向聴 / dora / lizhi / nukidora / chip すべて表示確認
2. **PlayerHandPanel**: 自家 / 他家の表示 layout 統合 → 各 player の手牌 + 副露 + 河 が同じ component で出る
3. **HeaderInfo / RoundEndPanel / GameEndPanel / PaifuLoadPanel**: 抜出後の props 渡しに漏れがないか
4. **game3 helper [feverLizhi / yaku / chip / tingpai / snapshot]**: pure helper 化後の挙動が class method 時代と同じか
   - canFeverLizhi / isFeverWaitExhausted: フィーバー宣言可否
   - isKanpaman / doraIndicatorOf: ドラ表計算
   - computeChipMultiplier / applyChipOall / applyChipFromLoser: chip 加算
   - getTingpaiList / canTsumoWithPochiSwap: テンパイ判定
   - saveSnapshot / restoreSnapshot: 局途中 save/load
5. **applyFuyuChip / applyChipsOnHule [残置]**: game3.ts 内、 直接 mutate 多面なので動作確認最重要

---

## NG パターン例 [見つけたら即 issue]
- 牌譜 v2 復元後 → 次ツモで型 error
- フィーバー宣言 → 待ち消失流局判定が出ない
- KinpeiModal で色分けが崩れる
- chip 加算が breakdown 表示と合わない
- PlayerStatus の表示順が崩れる [本来 風→点数→向聴→ドラ→リーチ→北→チップ]
- ドラ表 / 裏ドラ表が空 / 増えない

---

## 2026-05-14 オンライン UI gate / hardcoded P0 修正 後 必須 verify
朝の自走 bug fix 14 件 反映後、 オンライン対戦で 以下が正しく動くか playtest:

### selfPlayer != 0 [P1 / P2 として参加] の client で:
1. **ポンボタン**: 他家が自分の鳴ける牌を切った時、 中央 toolbar に「ポン」 button 表示
2. **大明槓ボタン**: 同上 で 「カン」 button 表示
3. **ツモ button**: 自分の手番で canTsumo 成立した時、 中央 overlay に「ツモ」 button 表示
4. **ロン button**: 他家の打牌で canRon 成立した時、 中央 overlay に「ロン」 panel 表示
5. **白暗カン button**: リーチ後 z5 ツモ + canKan で 「🤍 白暗カン」 button 表示
6. **リーチ button**: 自分の手番 + canLizhi で 通常 / シュバ / フィバ / オープン
7. **北抜き button**: 自分が z4 ツモ後 「北抜き」 button 表示
8. **アガリ止め button**: 自分がアガリ + canAgariyame で 「アガリ止め」 button 表示

### 視覚座 [seat-bottom / left / right] 表示:
9. **score-box**: 中央下 = 自家 username [seatName(selfPlayer)] 表示
10. **抜き box**: 中央 nuki-row [P1抜 / P0抜 [自] / P2抜] の 自box が selfPlayer の抜き北
11. **副露 [fulou]**: 各 panel に正しい player の副露 mianzi 表示
12. **lastZimoIdx**: 各 panel の最後にツモった牌 highlight が正しい player の zimo を指す
13. **defen panel xiangting**: サイド panel の各 P0/P1/P2 行で 正しい player のシャンテン数

### modal gate:
14. **KinpeiModal**: pendingKinpei.winner === selfPlayer の client のみに表示
15. **FuyuModal**: pendingFuyu.winner === selfPlayer の client のみに表示
16. **SaiKoroModal**: 全 client に表示、 ただし !canOperate で button disabled [仕様]

### ルール:
17. **北抜き直後 ポン抑制**: 抜き北 した player の次 dapai を 他家ポン不可

### NG パターン [この修正で消えるべき]
- 他人の手番なのに 自分の toolbar に ツモ / カン / 北抜き / リーチ button が出る
- 抜き box が他人の北を表示する
- 副露 mianzi が他人の副露で混ざる
- 抜き北 直後の打牌を 他家がポンできる [ルール 2-4 違反]
- KinpeiModal / FuyuModal で 非 winner が誤クリックで他人の選択を上書き
