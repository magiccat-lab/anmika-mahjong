---
status: in_progress
opened: 2026-09-20
outcome: 堅牢性レビュー (yuma) の実装。codex 検討済み。A のゲートと B(1) 進行不能の穴を実装、D は codex の指摘で見送り
---

# 堅牢性レビューの実装 (2026-09-20、shun)

リョー「codex にも検討させた上で駿に直させて。進行不能とかならんようにしてね」(アンミカ ch)。
元レビューは `2026-09-20_robustness_review_yuma.md`。codex の実装前レビューは
`2026-09-20_codex_review_robustness.md` (全文。要点は下に引く)。

## 入れたもの

| # | 何 | 効果 |
|---|---|---|
| A-1 | `npm run check` の型エラー 15 → 0 | 型ゲートが赤いままだと新しい型エラーが混ざっても気づけない |
| A-3 | e2e を本番から隔離 (port 8790 → 18790、`reuseExistingServer: false`、**DB も分離**) | e2e が本番 API と本番 DB を掴んでいた |
| B-1 | `cancelLizhi` を authority に実装 | **進行不能の直接原因**。宣言牌を選び直すと詰んでいた |

### A-1 型エラー

`App.svelte` の `isAutoActionPhaseReady(snap: ReturnType<typeof get<typeof game>>)` が
store の型を指していて、snap のプロパティが全部 error になっていた。`StoreState` に直して 0 errors。

### A-3 e2e の隔離

`playwright.config.ts` は 8790 を `reuseExistingServer` で掴む設定で、本番 API が同じホストの
8790 に居るため e2e が本番に当たっていた。18790 に移し、再利用を切った。

**codex の指摘で 1 つ足した**: ポートを変えるだけでは足りない。`server/app.py:80-84` の既定で
`ANMIKA_DB_PATH` 未設定なら `server/data/anmika.db` = 本番 DB を開く。
webServer の command に `ANMIKA_DB_PATH=tmp/e2e/anmika-e2e.db` を渡して DB も分けた。
`package.json` の `test:e2e` と `tests/ws_a9_webgl_fallback.spec.ts` の既定 URL も 18790 へ。

### B-1 cancelLizhi (進行不能の本命)

`server/authority.ts` の action switch に `cancelLizhi` が無く、宣言牌を選び直そうとした瞬間に
`unknown action type cancelLizhi` で reject され、client は宣言待ちのまま詰んでいた (09-02 から未着手)。

直した所は 4 つ。**どれか 1 つでも欠けると動かない**:

1. `LIVE_GAMEPLAY_ACTIONS` に追加 (局が生きている間だけ通す)
2. **`requireCanonicalLivePhase` の `type !== 'discard'` を取消にも広げる** —
   ここが最大の罠で、共通 gate は「宣言中は discard 以外を全部拒否」だった。
   1 だけ足すと「pending があると取消不能、pending が無いと取消対象なし」で全拒否になる
   (codex が事前に指摘、こちらも実装中にテストで踏んだ)
3. 検証 switch に `applyCancelLizhi`
4. canonical 実行 switch に `store.cancelLizhi()` — 前者だけだと mutation token が動かず reject

検査条件 (codex §2 の「最小の現行契約」に合わせた):

- 現手番の本人だけ (`requireCurrent`)
- 鳴き / ロンの応答待ちが無い (`requireNoReactionPending`)。**`lastDapai` は使わない**
  (authority は反応処理後も監査用に保持するため、鳴き割込みの判定に使えない)
- mirror の `pendingLizhiOpts` がある
- canonical の `lizhiPending` が `null` でなく、かつ actor と一致する (P0 = 0 なので truthy 判定にしない)

**やっていない事** (codex の指摘どおり): 供託の返却・`shuvariUsed` の復元などは足していない。
lizhi は打牌まで何も確定しないので、巻き戻す物が無い。`canLizhi` や候補牌の再審査も
取消の条件にしない (取消の目的は pending を降りる事で、宣言可能性の再判定ではない)。

回帰テスト `src/lib/__tests__/authority_cancel_lizhi_2026_09_20.test.ts` 8 本:
本人の取消 → 通常打牌に戻れる / 他家の取消は拒否 / pending 無しは拒否 / 二重送信は 1 回だけ /
open・shuvari も取消して宣言し直せる / 打牌後の遅延取消は拒否 / 拒否時に手番が動かない /
`unknown action type` で弾かれない。

## 見送ったもの

### D 演出中の凍結 (処理落ちの本命) — 入れない

codex の結論は「App 全体の `$game` 購読を止める案は不可」。凍結解除を観測できなくなる循環が
できる。具体的には:

- App が cutin A の snapshot を握ると、live 側で A が消えても null と残り queue を観測できず
  次の演出を pump しない。watchdog も古い ts しか見ない
- 解除条件を frozen snapshot の `!cutin && queue.length === 0` にすると、条件が永久に変わらない
- 卓を `{#if !busy}` の内側に入れると cutin 開始で controller が破棄され、解除役が居なくなる
- `frozenSnapshot = get(game)` では不十分。`store.ts:722-728` は Game3 の identity を維持したまま
  `Object.assign` するので、snapshot の中の game は後から変わる

安全に作るなら「表示専用の子コンポーネントに渡す**値**の通知だけを busy 中保留する」形で、
controller / modal / hydrate / CPU 予約 / stuck 検知は live のまま。これは表示と制御の責務分離
(App.svelte 5,496 行の分割) が先に要るので、**今回は手を付けない**。
先に入れると「処理落ちを直したら進行不能が増えた」になる。リョーの要求と逆。

### B-2 solo の stuck 検知 / B-3 部屋の停止監視 — 設計をやり直してから

- B-2: `isAutoActionPhaseReady` の false を停止扱いにできない。この関数は modal 待ちや
  人間の通常の考慮時間でも false を返す (codex §4)
- B-3: 「最終 accepted から 3 分」は成立しない。ready 未押下は仕様上無期限、初回 ready からの
  180 秒は押下時が起点、人間の和了後 pending も 180 秒、再接続は期限を張り直す。
  phase / phaseSince / expectedNextActionAt を **timer を予約した場所で記録**して判定する必要がある
  (codex §3 に 8 フェーズの表)

どちらもレビューの見積り (小〜中) より重い。次の着手時はこの節から読む。

## テスト

- `npm run check` 0 errors (前 15)
- `npx vitest run --exclude '**/*fuzz*' --exclude '**/*stall_hunt*'` 1,532 本緑
- 除外 glob はレビュー案の `'**/stall_hunt*'` だと実ファイル
  `authority_stall_hunt_2026_09_02.test.ts` に当たらない。`'**/*stall_hunt*'` が正しい (codex §4)
