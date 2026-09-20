---
status: done
opened: 2026-09-20
outcome: ANMIKA-ROBUST-01 実装前レビュー (codex)。D の危険な層、cancelLizhi の契約、停止閾値の反証、A〜D の順序
---

<!-- 出所: codex への依頼 ANMIKA-ROBUST-01 (shun 発、2026-09-20)。
     元は tmp/anmika-robust-out/review.md に出力された物を、tmp が gitignore 配下なので移設。
     実装側の記録は 2026-09-20_robustness_impl_shun.md -->

# ANMIKA-ROBUST-01 実装前レビュー

2026-09-20 / codex → shun。対象は `/home/m-catlab/apps/anmika-mahjong`。以下のパス・行番号は、特記なき限り同プロジェクト相対。

読取時 HEAD: `89dc48e56c2499a3e46f6e63a0a631cb3fd386bf`。既存の未コミット変更として App.svelte の StoreState import / 型注釈修正があった。本レビューではそれを含む作業ツリーを読んだ。実装コードは変更していない。静的レビューであり、テスト・E2E・性能計測は実行していない。

## 結論

- D は **表示専用の卓コンポーネントへの入力通知だけを抑える**なら検討可能。App 全体の `$game`、hydrate、cutin queue、選択UI・進行ドライバの購読を止める案は不可。凍結解除を観測できなくなる循環が生まれる。
- B(1) は authority の **二つの switch** を直す必要がある。LIVE_GAMEPLAY_ACTIONS に単純追加すると、共通 gate が取消を必ず拒否する。最小の現行契約は `actor === canonical.lizhiPending === canonical の現手番`。
- B(3) の「最終 accepted から180秒なら本物の停止」は成立しない。ready 未押下は仕様上無期限、初回 ready 後の180秒は押下時から、人間の和了後選択も180秒。フェーズと実際の期限を使って判定すべき。
- A→B→C→D の大筋はよい。ただし A はポートだけでなくDB・内部APIも隔離し、D の前に UI の進行回帰試験を入れる。現在の store/fuzz テストだけでは購読停止による詰まりを拾えない。

## 1. cutin 中の凍結と取りこぼし

### 実際に進行を所有している箇所

`src/App.svelte:85–98` が cutin の pump と終了タイマーを所有する。`!cutin && queue.length > 0` なら playNextCutin、cutin があれば ts を捕まえて終了を予約する。`src/lib/CutinOverlay.svelte:21–25` は表示専用であり、Overlay 自身が解除してくれる設計ではない。

`App.svelte:1944–1962` の watchdog も `$game.cutin` の ts を観測して一度だけ予約する。`store.ts:1193–1205` の finishCutin は ts 一致時に cutin を null にするだけで、次のキューを自動では取り出さない。通常時の次要素への移行は App の反応が必要。

solo の通常CPU進行は `App.svelte:2206–2229`。予約の起点は `$game`、発火時の再検証は `get(game)`。`src/lib/store/cpuActions.ts:319–322,336–337` も cutin / queue がある間は進行を止める。したがって、CPU進行とcutinが常に同時に走るというレビュー §2.2 の説明は広すぎる。長タスクとの相関だけでは、この凍結で「7回分がほぼ消える」とまでは確認できない。

### 凍結案で新設される停止条件

1. App が見る値を cutin A のある snapshot に固定する。通常タイマーが live store の A を消しても、App は null と残り queue を観測できず pump しない。watchdog も古い ts しか見ない。queue が残れば CPU の gate が閉じたままになる。watchdog が一度 playNextCutin しても、次の B を観測できなければ B 用のタイマーを張れない。
2. 凍結解除条件をその frozen snapshot の `!cutin && queue.length === 0` にすると、条件が永久に変わらない。live な別系統の busy 判定が必須。
3. controller を `{#if !busy}` の内側に移すと cutin 開始時に破棄され、onDestroy が timer を消す。解除を担う controller が不在になる。Overlay だけを外に残しても解決しない。
4. CPUドライバまで通知を止めると、予約済み callback が live store を再検証して return する点は安全でも、解除後の新規予約を起動する reactive 更新が来ずに止まる。
5. online は `store.ts:763–778` が incoming cutin を ts dedup して蓄積し、`server/ws_server.ts:1090–1092` が配信後の canonical queue を drain する。hydrate や enqueue 自体を間引くと途中の演出イベントは最終投影から復元できない。表示用 snapshot の間引きと通信適用の間引きを混同しない。

既存 watchdog は「同一cutinが残り続ける」保険であり、未観測の次cutin、controllerの破棄、増え続けるqueue全体を救う保証ではない。JSのイベントループ自体が止まった時間もタイマーは実行できない。

### 指定された pending ごとの観測点

| 状態 | UI / ドライバのコード | 凍結時に守ること |
|---|---|---|
| pendingFuyu | App:2554–2566 | live pending + `!fxPresentationBusy` を維持。busy解除後の表示が必要 |
| pendingKinpei | App:2567–2569 / single:3147,3217–3246 | single の結果パネルは pendingKinpei 単独でも開く。結果・選択パネルを卓と一緒に凍結しない |
| pendingKamiPochi | App:2570–2602 | candidates と occurrenceKey を live に保つ。古い occurrenceKey の送信は避ける |
| pendingPochiSwap | App:2604–2620 | owner/candidates を live に保つ |
| pendingSaiKoro | App:2129–2139,2151–2192,3347–3361 | saiKoroOpened、cpuWinAck、CPUの段階駆動、chance owner/currentIdx も制御情報。モーダル表示だけの問題ではない |
| pendingFeverContinue | App:2462–2468,2951–2957,3268 付近 | 現状cutin busyを一律gateしていない。卓凍結を口実に選択を新たに隠さない |
| awaitingRonDecision | App:2509 付近,2808 付近 / server:1819–1840 | ロン応答UIはliveのまま。onlineには15秒期限があり、queue全体の完了待ちにすると人間が応答する時間を失う |

最終snapshotだけで十分なのは**表示専用の盤面**。onlineではサーバ代行により pending が立って消えることがあるため、制御UIまで最終値に畳むと中間の選択機会は取り戻せない。soloでも選択がlive storeに残っているのに凍結解除を通知しなければ操作手段が消える。これは現在すでに全経路で取りこぼすという断定ではなく、提案の広域凍結が作る条件付きの不具合である。

また `App:102–104` の busy は cutin に加えて pochiReveal を含む。`App:205–241` のイベント走査と `243–247` のclose/次要素処理、`2544–2551` の開示モーダルも常時liveにする。cutinだけ消えても開示が残れば選択modalは開かない。

### 推奨する止め方

- store / hydrate / enqueue はそのまま進める。controller、cutin表示、watchdog、選択modal、ready、CPU予約、stuck検知はlive購読を維持する。
- 卓・河・手牌の表示計算を子へ分離し、その子に渡す **表示用の値** の通知をbusy中だけ保留する。子が独自にgameを購読すれば凍結は効かない。
- `frozenSnapshot = get(game)` や `{...get(game)}` だけでは不十分。`store.ts:722–728` は Game3 のidentityを維持して Object.assign するため、snapshot内の game は後から変わる。牌配列・河・スコアなど必要な表示データを独立した値へ投影し、共有するmutable Game3/Map/Setを残さない。
- 凍結中の卓入力は止めるか、live局面で再検証する。Overlay は `CutinOverlay.svelte:52` が pointer-events:none なので、覆えばクリックを防げるという前提はない。ロン等のlive操作は維持する。
- 解除はliveの `cutin == null && queue.length === 0` を観測して最新値を一度publish。次局/reset/再接続/モード変更でも古いsnapshotを持ち越さない。queue途中のnullでflushしない。
- `{#if}` で卓を外す案は「表示を残した凍結」とは挙動が違い、再mountコストもある。使うなら制御を完全に外へ出した表示専用部分に限る。enqueue抑制は推奨しない。

D の完了条件には、各pendingがcutin中に到着して解除後に操作できること、2件以上のqueue、watchdogによる回復、切断/再hydrate、CPU再予約、古い盤面から操作できないことを含める。既存 `cutin_progress_sync.test.ts` はstoreのCPU停止、`audit_l03_online_cutin_2026_07_21.test.ts` は投影/drain/dedupのテストで、Appの購読・タイマーによる再開までは検証していない。

## 2. cancelLizhi のサーバ検査と整合

### 最小修正で一致させる契約

1. actorは接続情報由来のgame seatを使う。authority入口 `server/authority.ts:227–230` の有効seat検査を通す。
2. canonical.lizhiPending が **nullでない**こと。P0=0をtruthyで判定しない。
3. actor === canonical.lizhiPending。
4. canonicalの現手番 === actor。検証mirrorの requireCurrent も整合していること。

根拠: remote reducer入口は `store.ts:1064–1069` で本人判定、実際の取消は `2874–2876` でpendingと現手番が一致する場合だけ行う。authorityが本人だけを見て現手番を無視するとcanonical no-opになる。

宣言牌前かどうかの通常経路の根拠は pending 自体。`store.ts:2851–2856` はpendingを立てるだけで、実際のdeclareLizhiは `1277–1292` の打牌時。その際pending/flagsを消すので、打牌後に遅れて来た取消はno pendingで拒否する。取消時に供託返却・shuvariUsed復元などを追加してはいけない。まだ確定していないものを巻き戻す処理ではない。

### 鳴き割込み・壊れた局面への防御

通常のlizhi受付は `store.ts:2829` → `443–451` でロン/鳴き/槍槓/抜き北/和了後pending/終局を拒否する。そのため正常な宣言牌待ち中にそれらが同居する想定ではない。ただし **cancel reducer自身は現在それらを検査しない**。以下を追加するなら既存条件だと誤記せず、serverと共通reducerに同じ契約として足す。

- roundEnded / pendingPingju / game.state.finished でない。
- awaitingRonDecision / awaitingFulou / pendingQianggang / pendingNukiBei がない。
- 指定6種類の和了後pendingがない。
- 実リーチが未成立 (`!game.lizhi.has(actor)`)。成立済みなのにpendingもある状態は正常取消ではなく不整合として記録する。

これらは異常状態を検出する防御であり、拒否だけで破損局面からの復旧が保証されるわけではない。復旧を取消に兼任させるかは別の設計判断。canLizhi・候補牌枚数・lastZimo の再検査を取消の追加必須条件にしない。取消の目的はpendingを降りることであり、宣言可能性の再審査ではない。特に `lastDapai !== null` を鳴き割込み判定に使わない。authorityは `1151–1157` で反応処理後にも監査用lastDapaiを保持する。反応フラグで判定する。

### 配線で落ちやすい点

- 検証switch `authority.ts:247–280` と canonical実行switch `402–435` の **両方** に必要。前者だけだと後者が何もせず、`293–295` のmutation token比較でrejectになる。
- LIVE_GAMEPLAY_ACTIONS (`63–76`) に入れるなら `requireCanonicalLivePhase:559` の `type !== 'discard'` を取消にも対応させる。単純追加は「pendingがあると取消不能、pendingがないと取消対象なし」という全拒否になる。専用validatorなら共通gateとの差分を明示する。
- canonicalの取消でpending/flagsを消し、通常の `syncFromCanonical:460–464` でmirror.pendingLizhiOptsをnullにする。検証mirrorだけを消す修正では足りない。
- mutation tokenにはlizhiPendingが既にある (`390`)。成功の検出にmessage変更やflagsだけを頼らない。

最低限の回帰: P0本人、他席拒否、通常/open/shuvari/feverの取消→再宣言→合法打牌、宣言牌commit後の遅延取消、取消二重送信、取消直後の通常打牌、authority復元/replay後のpendingLizhiOpts。拒否時は牌・供託・手番・mirrorを変えないこと。追加フェーズguardを入れるなら壊れた同居状態の期待値もstore/server両側で固定する。

## 3. 停止閾値

### 180秒で本物と断定できない具体例

| フェーズ | 実装 | 正常な待ち / 問題 |
|---|---|---|
| 局終了・ready 0人 | ws_server.ts:1798–1816 | active人間ありならtimerを張らずreturn。180秒以上でも仕様どおり |
| 局終了・ready 1人以上 | 1651–1656 | 最初のreadyから180秒。例: 最終actionの170秒後にreadyすると期限は350秒後 |
| 人間の和了後pending | 1728–1795 | デフォルト180秒。境界ちょうどの監視はtimer発火・room.queue実行と競合する |
| ロン/鳴き反応 | 1819–1840 | 通常15秒。ただしpost-win分岐が先。pendingと反応が同居すれば前者の180秒を先に使う |
| 通常手番 | 1844–1902 | 人間60秒、CPU750ms、切断席30秒相当。env/optionsで変更可能 |
| 再接続 | 2285–2292 | accepted無しでも期限を現在時刻から張り直す。接続を繰り返せば最終acceptedから180秒以上になり得る |
| 全人間切断 | 2269–2280 | grace後roomsから外しtimer停止。DBにplayingが残ることと稼働中roomの停止は区別が必要 |
| active人間0人・局終了 | 1809–1814 | 未終了試合かつpost-win解決済なら専用短時間timer。切断している人間が存在する場合と同義ではない |

`markReadyForNextRound` はaccepted gameplay commandではない。`2164–2169` で専用ackを返す。最終accepted時刻だけではready timerの起点を表せない。よって3分は「要調査の無操作時間」には使えても、全フェーズ共通の停止確定条件には使えない。

### 推奨する観測契約

roomごとに phase / phaseSince、revision、lastProgressAt、expectedNextActionAt、deadline種別、owner、active/connected人間数、ready状態、最終deadline試行時刻とreject理由を持つ。expectedNextActionAtは **実際にtimerを予約した場所** で記録し、再接続・破棄・ready開始時も更新する。API側が60×3から再計算しない。

- timerで自動進行すべきphase: `now > expectedNextActionAt + grace` かつ期待した進行がないなら異常候補。graceはまず10〜30秒程度の運用仮値とし、実測で決める（現時点で保証できる値は読めていない）。
- 同じ局面で代行rejectを繰り返す場合: timerが毎回張り直されるだけで健康扱いにならないよう、phaseSince / lastProgressAt / 連続失敗回数も見る (`1791–1792,1836–1838,1882–1900`)。
- ready 0人・試合終了・休眠room: intentional waiting / dormant として停止アラートから外す。必要なら無操作通知は別分類。
- timerを持つべきphaseなのにtimerも期限もない状態を検出する。期限超過だけでは「予約自体を失った」を見逃す。
- 最終acceptedを追加するなら、`1525–1545` のappend/persist成功後を起点にし、client/server代行の両方を含める。stamp (`1420–1426`)、再送ACK、syncで進行時刻を延命しない。

10分周期の外部監視では期限超過検知がさらに最大ほぼ10分遅れる。許容するなら明記する。serverプロセス自体の停止はroom状態取得の失敗として別途扱う必要がある。APIのplaying一覧だけで稼働roomのdeadlineが健全かは判断できない。

## 4. A〜Dの依存と順序

### Aは先。ただし隔離を完成させてからE2Eを実行

- `playwright.config.ts:11,15–17` は8790かつreuse可、さらに `ANMIKA_DB_PATH` 未指定。Python既定は `server/app.py:80–84` の `server/data/anmika.db`。**18790へ変えるだけでも既定DBに接続する**。
- `package.json` のtest:e2eも8790を明示、`tools/run_online_e2e.mjs:12–17` は別のport既定を持つ。`tests/single_flow.spec.ts:12` は本番URL既定。全入口を揃える。
- API/WS/内部HTTPを18790/18791/18792等で一体に隔離する。`server/app.py:63–65` の内部API既定も本番WSの隣を指す。WS永続化は `server/persistence.ts:23` のANMIKA_DB_PATHまたはdata/anmika.sqlite3。テスト用DBを明示し、必要なURL/envを子プロセスまで渡す。online runnerは既に一時DBとURLを設定している (`110–123`) のでそこを基準にできる。
- secretary側 `/home/m-catlab/secretary-v2-prod/src/secretary/ops/app_deploy.py:21–29` のDeployTargetには現状check_commands項目がない。設定1行追加ではなくモデル・plan組立・実行失敗時の中止を対応させる。現状 `167–176` はpull→install→build→restartなのでcheck/高速testはbuild/restart前へ。
- 除外案 `'**/stall_hunt*'` は実ファイル `src/lib/__tests__/authority_stall_hunt_2026_09_02.test.ts` に一致しない。ファイル名に合わせた除外か高速対象の明示リストにする。「1分以内」は今回測っていない。
- App型修正は読取時に既に未コミット差分あり。重ねて変更せず、checkの実行結果で確定する。本レビューでは現在15 errorsと断定しない。

### BとCはDより先。ただし観測だけでは防止にならない

cancelLizhi配線・フェーズ別監視を先にする。solo stuck検知は `isAutoActionPhaseReady` のfalseを停止扱いにしない。この関数 (`App:1820–1840`) はmodal待ちや人間の通常判断も意図してfalseにする。合法手・操作UI・自動予約のどれで進めるphaseかを別に判定する。

「pending modalが20秒変化しない」は考え中/離席でも起きる。軽い通報導線はよいが、停止確定や強制自動操作へ結び付けない。D後も検知元と状態ダンプはliveに固定し、frozen表示の滞留で誤報しない。pendingNukiBei/pendingQianggang/pendingPingju、CPU和了ack、ready、pochiReveal待ちも分類に含める。

Cのgoldenは裁定済みの期待値で固定し、未裁定を混ぜてゲートを赤くしたままDを進めない。不変条件は会計境界を定義してから追加する。一般案の「非和了者の点数は増えない」は流局/複数和了などの対象範囲なしでは採用できない。供託は局の前後差を含めて保存則を検査し、本場を独立した預かり金のように二重計上しない。詳細の精算全経路とnorosh golden選別は今回読めていないため、現在実装にこのassertがそのまま成立するとは保証しない。

### D直前に必要な小さな順序変更

表示とcontrollerの責務分離 → 現行の進行をUI試験で固定 → 表示通知の凍結 → 性能再測定、の順を推奨。全Appの大規模分割を先行させる必要はないが、表示専用境界なしでstore購読を切るのは危険。

`v32_full_games_fuzz.test.ts:45` は自らfinishCutin/playNextCutinを呼ぶため、Appのtimerが消える事故を隠す。goldenの点数が正しくてもDの進行安全性は証明しない。Dの進行試験には上記7種類のpending、queue複数、pochiReveal連鎖、watchdog、再接続を含める。軽量化（尺変更）も後に分け、CSS/終了timer/watchdogの整合と「演出無しでも確実にdrain」を確認する。

## 読めていないもの・検証の限界

- 実機性能、長タスクのcall stack、今回のbefore/after計測は読めていない。凍結の性能改善幅は未確認。
- 本番の実際のtimeout環境変数、DBのroom状態、scheduler/jobの実配線は読めていない。本文の秒数はコードの既定値と分岐から判断した。
- norosh元データ全体・未裁定の採否・点数精算全経路は読めていない。golden期待値の正しさは本レビューの検証対象外。
- 提案Dの実装はまだないため、その実装が安全であるとの承認ではない。危険な層と成立条件を既存コードから特定したレビュー。
