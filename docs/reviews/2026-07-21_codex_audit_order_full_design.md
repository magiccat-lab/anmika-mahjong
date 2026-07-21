# Codex捜査発注書: anmika-mahjong 設計全体バグ捜査（2026-07-21 / yuma）

- 対象リポジトリ: `/home/m-catlab/apps/anmika-mahjong`（branch `codex/all-fixes`, 起点 `7a8a22f`）
- 発注先: リョーの codex セッション（gpt-5.6-sol）
- 性質: **捜査のみ。実装・修正コミット禁止**。成果物は報告書1本
- 背景: 前回監査（2026-07-14 実装レビュー → WS-A 止血9件実装済み）以降、フィーバー立直・シュバリ・神ぽっち自動高め取り・サイコロ刷新・カットイン進行同期・金一色UI・スマホ対応と大量に機能を積んだ。実プレイで「進行停止に見える」事象が2件発生している（cutin タイマー消失 → 強制解除の保険で対処 / フィーバー強制ツモ切りの手動待ち → `7a8a22f` で自動化）。同型の残党と、機能どうしの相互作用バグを全体捜査してほしい

## 成果物

- `docs/reviews/2026-07-21_full_design_audit_sol.md` に報告書を書く（このコミットだけ可）
- 1発見 = `ID / 重大度 / 該当コード(file:line) / 再現手順かfuzz seed / 修正案1行`
- 重大度: C=クラッシュ・データ破壊 / H=進行停止・ハング / D=点数・祝儀・状態のズレ / S=チート・不正操作 / L=表示・UX
- 重大度順に並べる。憶測は「未確認」と明示。仕様が曖昧でバグと断定できないものは「リョー裁定待ち」節に分離する

## 重点捜査領域（優先順）

1. **進行停止クラス（H）**: blocking系 state（awaitingRonDecision / awaitingFulou / pending{Fuyu,Kinpei,KamiPochi,PochiSwap,SaiKoro,FeverContinue,Qianggang,NukiBei,Pingju} / cutin / cpuWinAck / roundEnded / lizhiPending）の組合せで、(a) どの入力手段もUIに出ない (b) 自動driverが対象外 (c) 双方が相手待ち、になる経路。`src/App.svelte` の driver 3系統（CPU step / saiKoro driver / autoTsumokiriScheduler）と `src/lib/store.ts` の整合を突き合わせる
2. **フィーバー継続の同一局複数和了**: 和了→続行時の lizhi 残存・一発・裏ドラ・供託・paishu・親流れの整合。同一局2ロンは実プレイで発生済み（それ自体は仕様）
3. **single/online 分岐 parity**: `onlineGameStarted` 分岐と server authority（`server/ws_server.ts`）/ client driver の役割分担。片側にしか入っていない修正の洗い出し（例: フィーバー自動ツモ切りは single のみ。online の同手番は手動のまま、これの扱いも提案がほしい）
4. **点数・祝儀（D）**: chipLedger、夏/冬yaku、フィーバー倍率、サイコロボーナスの計算とUI表示の一致。半荘を通した defen+供託の保存則
5. **特殊牌の端**: 北抜き/金北/ぽっち/虹が リーチ・フィーバー・カン・海底・王牌縮小と絡む境界。`canNukiBei` のフィーバー分岐は 7a8a22f で触ったばかり
6. **チート耐性（S）**: online で client が送れる action 全種のサーバー側検証。WS-A1〜A9 実装後の残穴

## 進め方の契約

1. 実装・修正コミット禁止。成果物は報告書のみ。修正したくなったらパッチを報告書に添付する（適用しない）
2. テスト実行は自由（`npx vitest run` / `npm run check` / playwright / fuzz）。fuzz を拡張して探索するのは歓迎、ただし新規テストもコミットせず報告書に添付
3. 既存テストの state 直書き換え救済パターンは信用しない（7/14 の sol 監査指摘どおり）
4. 仕様が分からない挙動は先に `docs/reviews/2026-07-15_rule_rulings_and_implementation.md` と `2026-07-18_rule_rulings_lingshang_zoro.md` を読む。それでも不明なら「リョー裁定待ち」へ
5. 目安 1〜2日。途中経過は不要、報告書1本にまとめる

## 完了条件

- 報告書が `docs/reviews/2026-07-21_full_design_audit_sol.md` に置かれている
- 重点領域 1〜6 それぞれについて「発見一覧」または「調べた上で白」が明記されている
