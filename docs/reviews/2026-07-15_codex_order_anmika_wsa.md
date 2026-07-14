# Codex実装発注書: anmika-mahjong WS-A 止血9件（2026-07-15 / yuma）

- 対象リポジトリ: github.com/magiccat-lab/anmika-mahjong（`main`, 起点 `450fea8`）
- 発注先: リョーの codex セッション（gpt-5.6-sol、監査を実施した環境。anmika repo とテスト基盤あり）
- 根拠文書:
  - 実装レビュー: `docs/reviews/anmika-mahjong_実装レビュー_20260714.md`（yuma）
  - 修正設計 v1: `docs/reviews/anmika-mahjong_修正設計_20260714.md`（yuma×sol統合）
  - sol 監査: `anmika-mahjong-audit-for-claude.md`（codex 自身の成果物）
- 本発注書は単体で読めるよう各件に仕様を書いた。上記は補足参照

## 発注範囲

**今回発注するのは WS-A（止血）9件のみ。** WS-B/C/D は依存関係の記載だけで未発注（末尾ロードマップ参照）。裁定待ち項目は各件の「保留」欄に明示、**保留部分は実装禁止**。

## 共通契約（全件に適用）

1. **再現テスト先行**: 修正前に fail するテストを書いて fail を確認 → 修正 → green。テストは残す
2. **release 判定は retry:0**: `vitest run --retry=0`。`vite.config.ts` の retry:2 は今回触らない（テスト運用改革は WS-B 側）
3. **既存挙動を壊さない**: 全 vitest + playwright を retry:0 で実行し、修正対象外の既存 flaky があれば「既知 flaky リスト」として PR に記録（隠さない・直しに行かない）
4. **触るな**: `game3.ts:679-686` の最終成績計算（素点差を加えない現行が正、docs/chip_spec.md 側が古い）。虹牌・満貫29枚・でかぽっちの新規実装禁止
5. **コミット境界**: 1発注=1コミット基本（A2 のみ2分割可）。コミットメッセージに発注ID（WSA-A1 等）を含める
6. **ロールバック**: 発注単位 revert で戻せること（複数件を1コミットに混ぜない）
7. テストからの内部 state 直接書き換え・`cpuStep()` 救済・`finished=true` 代入は新規テストで使用禁止（sol 監査の指摘どおり）

---

## WSA-A1 サイコロ3アクションのサーバー検証

目的:
- 改造クライアントが他人のサイコロチャンスを操作（出目宣言の書き換え・勝手振り・advance スキップ）できる穴を塞ぐ

対象:
- `server/authority.ts:416-425`（`validatePostWinAction`）

変更内容:
- `rollSaiKoroDice` / `selectSaiKoroCombo` / `advanceSaiKoro` の無条件 return null を廃止
- 3アクションとも `roundEnded`（またはサーバー側で和了確定済み）を必須化。`rollSaiKoroDice` の roundEnded バイパス（417行）を削除
- actor 検証: 止血版として actor ∈ {lastWinner ∪ ronDeclaredPlayers} に限定。authority が chance 単位の owner（`chances[currentIdx].winner`）を持たない現状を踏まえた最小実装でよい。完全な per-chance owner 検証は WS-B/C の authority 精算実装後に引き上げる旨をコメントで残す

既存挙動を壊さない条件:
- 正規勝者のサイコロ進行（tsumo/ron、ダブロン、フィーバー継続）が全部通ること

テスト:
- authority 単体テスト: 非勝者 actor の3アクションが reject、勝者は accept。生局中の `rollSaiKoroDice` が reject

ロールバック:
- 本関数のみの変更。単独 revert 可

完了条件:
- 上記テスト green + 既存オンライン e2e green

保留/人間判断:
- なし

---

## WSA-A2 四槓子成立不能の解消（開槓ドラ上限）

目的:
- 初期ドラ2枚+上限5（4麻流用）で半荘カン3回までになっており、四槓子（`game3.ts:2446-2448` にダブル役満処理あり）が到達不能。秋ドラ追加でさらに減る。カン候補は表示されるのに宣言が silent 失敗する

対象:
- `src/lib/shan3.ts:204-209`（`gangzimo` の `_baopai.length === 5` throw）
- `src/lib/shan3.ts:141-148`（`drawNewDora`）
- `src/lib/game3.ts:3216-3233`（`getKanCandidates`）

変更内容:
- Shan3 に **カン由来ドラ枚数カウンタ**（例 `kanDoraCount`）を追加し、`gangzimo` の拒否条件を `kanDoraCount >= 4` に変更（`_baopai.length` 基準を廃止。秋ドラはカン回数を消費しない）
- `getKanCandidates` に同一述語（`kanDoraCount >= 4` → 候補0件）を追加。「候補は出るが宣言で失敗」を禁止
- `snapshot()` / `restore()`（`shan3.ts:98-123` 付近）に新カウンタを追加（カン失敗 rollback 対応）

既存挙動を壊さない条件:
- 嶺上枯渇ガード（`rinshanLen < 1`）は現行維持
- 開槓の表/裏ドラめくり枚数・タイミングの意味論は変えない（cap の数え方だけ変える）
- inventory invariant テスト群が green のまま

テスト:
- 固定山 golden: 同一プレイヤー4連続カン → 四槓子和了が成立（`game3.ts:2448` 到達を assert）
- 秋ドラ2回発動後もカン4回可能
- 5回目のカンは候補に出ない（宣言経路にも到達しない）

ロールバック:
- shan3 コミットと game3 コミットの2分割可。逆順 revert

完了条件:
- 四槓子 golden green + 既存カン系テスト green

保留/人間判断:
- なし（カン4回上限は普遍規約。秋ドラを回数外にする方針は修正設計 v1 で決定済み）

---

## WSA-A3 フィーバー待ち枯渇の多重計上修正

目的:
- 5p/5s 待ちの枯渇判定で赤が2重・金が3重に数えられ、山に待ち牌が残っているのに早期「枯渇→1人テンパイ流局」する

対象:
- `src/lib/game3/feverLizhi.ts:228-238`（手牌 zone の visible 加算）

変更内容:
- majiang-core の `_bingpai[s][5]` は赤（と金の p0 表現）込みの総数（`inventory.ts:53-58` と `game3.ts:2399` 付近のオールスターコメントが根拠）
- よって手牌 zone の `visible += _bingpai[ss][0]` 加算と goldHand 加算を**削除**
- 河・baopai zone の加算（文字列完全一致で `p0`/`gp` を別カウント）は正しいので**変更しない**

既存挙動を壊さない条件:
- z5（白ぽっち4色）待ちの分母4判定は現行のまま（正しい）
- 副露内カウント（`countTileInMianzi`）は現行のまま

テスト:
- 再現: 手牌に赤5p を含む 5p 待ちフィーバーで、山に 5p が残っている状態が「枯渇」と誤判定されないこと（修正前 fail を確認）
- 金5 込みの同型、z5 待ちの regression

ロールバック:
- 単一関数内の削除2行相当。単独 revert 可

完了条件:
- 再現テスト green + 既存フィーバー系テスト green

保留/人間判断:
- なし

---

## WSA-A4 サイコロ award の二重登録排除と base テーブル

目的:
- カラス・八連荘が「専用140」と「本役満アガリ70×count」の両方に登録され二重発火する。天和・地和・人和は規約 base140 のところ 70×count 扱い

対象:
- `src/lib/game3.ts:2381-2394`（addSai カラス/八連荘）
- `src/lib/game3.ts:2665-2679`（本役満アガリ抽出）

変更内容:
- `addSai` に award key（役名ベース）を導入し、同一 key の二重登録を禁止
- 役→base の明示テーブル化: カラス140 / 八連荘140 / 天和140 / 地和140 / 人和140 / その他本役満70
- 「本役満アガリ」汎用抽出は、専用 award 済みの役を count から除外する

既存挙動を壊さない条件:
- 白暗カンアガリ・三連刻・三色同刻・オールスター等の既存 award は従来どおり1件ずつ
- 白ぽっち即ツモ祝儀0枚サイコロ（`game3.ts:2859`）は対象外・変更しない

テスト:
- カラス和了: saiKoroChances に award 1件のみ（base140）
- 八連荘同様。天和: base140 で登録
- 通常本役満（大三元等）: 70×役満数で従来どおり

ロールバック:
- 単独 revert 可

完了条件:
- 上記 golden green

保留/人間判断:
- **天和等ダブル役満のサイコロ「回数」**（140×1 か 140×2 か）は裁定待ち #10。確定まで count=1 で実装し、テーブルの count を定数化して差し替え可能にしておく

---

## WSA-A5 面前役祝儀の合算化

目的:
- 混一色5/清一色10/二盃口15 が `Math.max` で最大値のみになっており、複合時（混一+二盃口=20枚 等）に過少支払い

対象:
- `src/lib/game3/huleChip.ts:433-448`

変更内容:
- `menzenChip = Math.max(...)` を加算（`+=`）に変更
- 対象役と枚数は現行の3種のまま。喰い下がり名の扱い・isMenzen 判定は変更しない

既存挙動を壊さない条件:
- 単独役（混一のみ等）の枚数は従来と同一

テスト:
- 混一+二盃口=20、清一+二盃口=25 の golden（ツモ=オール/ロン=放銃者から、両モード）

ロールバック:
- 1行変更相当。単独 revert 可

完了条件:
- golden green

保留/人間判断:
- **本役満チップとの併算**（文書の大車輪35枚例: 清一10+二盃口15+役満10）は裁定待ち #8。今回は合算化のみで、役満との併算構造は変えない

---

## WSA-A6 ダブロン供託の上家取り

目的:
- リーチ供託が「先に applyHule された勝者」の総取りで、処理順 [1,2] と [2,1] で受取者が変わる。規約は上家取り

対象:
- `src/lib/game3.ts:2791-2793`（lizhibang 加算）
- `src/lib/store.ts:704-741`（ronResults の構築・適用順）
- `server/authority.ts:42-45`（`chooseWinnerByOya`、必要なら）

変更内容:
- ダブロン時の applyHule 適用順を「放銃者から反時計回りの席順」（上家取り）に正規化ソートしてから実行する（宣言到着順依存を排除）
- 供託は席順先頭の勝者が受け取る
- 完全な `settleClaims()` 化は WS-B2。今回は順序正規化の暫定でよいが、property test（下記）が通る形にすること

既存挙動を壊さない条件:
- 単独ロン・ツモの精算は不変
- lastWinner の親優先ロジック（進行 owner 用）は現状維持でよい（供託の受取だけ席順化）

テスト:
- property test: 同一ダブロン局面で宣言順 [A,B] / [B,A] の最終 defen・chip・供託が完全一致
- 上家取り golden: 放銃者の下家側勝者が供託を受け取る

ロールバック:
- 単独 revert 可

完了条件:
- property test + golden green

保留/人間判断:
- **本場（benbang）支払いのダブロン時の扱い**（上家のみか両者か）は裁定待ち #11。現行挙動を維持し、テストで現状を固定するだけにする（変更しない）

---

## WSA-A7 nextRound/nextMatch の最低限ガード

目的:
- 生局中でもホストの nextRound が authority に受理され、二重送信でサーバーだけ二局進んで永久にずれる

対象:
- `server/authority.ts:391-413`

変更内容:
- `roundEnded=false`（かつ pendingPingju でない）中の nextRound を reject
- 同一局への二重 nextRound は2件目を no-op ACK（エラーにせず握りつぶして同一応答）にする最低限の冪等化
- commandId/expectedVersion の本格導入は WS-C4（今回やらない）

既存挙動を壊さない条件:
- 正常フロー（和了→次局へ、流局→次局へ、nextMatch）は不変

テスト:
- authority 単体: 生局 nextRound reject / 二重送信で1局だけ進む

ロールバック:
- 単独 revert 可

完了条件:
- テスト green + オンライン e2e green

保留/人間判断:
- なし

---

## WSA-A8 自動ツモ切り scheduler の一本化

目的:
- 通常自動ツモ切りとリーチ強制ツモ切りが別 timer で二重予約され、1回目の捨牌後に**次家のツモ牌**まで捨て得る

対象:
- `src/App.svelte:1472-1495`
- `src/lib/store.ts:1770-1782`（`tsumokiri(expectedPlayer?)`）

変更内容:
- 自動ツモ切りの予約を player+局面 revision に紐づく単一のキャンセル可能 scheduler に統合
- 発火直前に current player / phase / revision を再検証し、不一致なら no-op
- 既存の `expectedPlayer` 引数を実際に渡す

既存挙動を壊さない条件:
- リーチ中の強制ツモ切り・通常オートのそれぞれ単独動作は従来どおり

テスト:
- sol 再現手順（両条件同時成立）で次家の牌が捨てられないこと（修正前 fail 確認）

ロールバック:
- 単独 revert 可

完了条件:
- 再現テスト green + 既存オート進行 e2e green

保留/人間判断:
- なし

---

## WSA-A9 サイコロ 3D 失敗時の watchdog と 2D fallback

目的:
- WebGL/dice-box 初期化失敗でボタン永久 disabled、`onRollComplete` 欠落で `rolling=true` 固まり → 対局が進行不能

対象:
- `src/lib/SaiKoroModal.svelte:42-93`

変更内容:
- 初期化に timeout（目安 5s）を設け、失敗・timeout 時は 2D fallback 経路でボタンを有効化
- roll 開始後 `onRollComplete` が一定時間来なければ 2D 結果表示に強制切替（結果値はロジック側で確定済みの値を使う。3D は表示のみ）

既存挙動を壊さない条件:
- WebGL 正常環境では従来の 3D 演出

テスト:
- WebGL 無効化 e2e（playwright の browser flag）でサイコロチャンス完走

ロールバック:
- 単独 revert 可

完了条件:
- WebGL 無効 e2e green

保留/人間判断:
- なし

---

## WS-B/C/D ロードマップ（未発注・着手禁止）

| WS | 内容 | 依存 |
|---|---|---|
| B1 | PhysicalTile ID 116枚+zone 不変条件 | A 完了後。B2-B4/C2 の前提 |
| B2 | evaluateWin/settleClaims 分離（夏夏金北×4順序・逆ぽっち自己トビ・トントンブー含む） | B1 |
| B3 | diyizimo per-player 化（天和/地和/人和） | B2 |
| B4 | claim tile 込み完成手牌評価（赤5ロン祝儀・間八萬ぽっちロン） | B2 |
| C1-C5 | ws 正本一本化・永続化・サーバー側 CPU/deadline・versioning | B1 完了後に schema 確定。A と並走の設計作業は可 |
| D | 牌譜 canonical serializer・保存可能時点制限 | C2 |

WS-B の詳細発注書は WS-A 完了レビュー後に別途出す。

## 裁定待ち一覧（実装禁止項目）

修正設計 v1 の9件+今回追加2件。リョーの裁定が出た項目から個別発注する。

1. 華ドラ表示の効果カウント
2. ゾロ目連続特典の発動条件（シュバ宣言者限定か、シュバサイコロ扱い chance 全部か）
3. ロン由来サイコロのぽっち倍率
4. 強制カン（リーチ後）の採否
5. アガリ止めの 40000 条件
6. オープンリーチ（3人目制限・供託2000ゲート）
7. シュバ権の返り東復活
8. 面前役祝儀×本役満チップの併算（大車輪35枚）
9. 13翻超過チップのロン適用
10. 天和等ダブル役満のサイコロ回数（140×1 か 140×2 か）
11. ダブロン時の本場支払い（上家のみか両勝者か）

## 進行表

| ID | 状態 | 担当 | 備考 |
|---|---|---|---|
| WSA-A1 | 発注済み(2026-07-15) | codex | |
| WSA-A2 | 発注済み(2026-07-15) | codex | コミット2分割可 |
| WSA-A3 | 発注済み(2026-07-15) | codex | |
| WSA-A4 | 発注済み(2026-07-15) | codex | 裁定#10 は count=1 仮置き |
| WSA-A5 | 発注済み(2026-07-15) | codex | 裁定#8 部分は据え置き |
| WSA-A6 | 発注済み(2026-07-15) | codex | 裁定#11 部分は現状固定 |
| WSA-A7 | 発注済み(2026-07-15) | codex | 本格 versioning は WS-C4 |
| WSA-A8 | 発注済み(2026-07-15) | codex | |
| WSA-A9 | 発注済み(2026-07-15) | codex | |
| WS-B/C/D | 保留 | - | WS-A 完了レビュー後に詳細発注 |
| diff レビュー | 未着手 | yuma | 全件、上がり次第 |

- 配送: 本発注書+根拠2文書を anmika-mahjong repo の `docs/reviews/` へ push 済み（2026-07-15）。codex は repo から直接読む。agmsg bridge の codex は anmika repo 非保持のため使わない
- 返答期限: 発注時にリョーが指定（推奨: A 全件で1パス、部分納品可）
