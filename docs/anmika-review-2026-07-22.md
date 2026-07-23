# 2026-07-22 全修正の棚卸しと両面レビュー

リョー指示 (2026-07-23 未明): 「今日アンミカで出した指示を全部一覧にして codex と fable 両面でチェック、
修正リスト、その後改めて全部修正。特に局の推移とか次の試合への遷移とかを重点的に」

- 対象: 2026-07-22 の全 29 コミット (8d45b18 〜 d180f42) + レビュー後の追いコミット
- レビュー体制: fable 側 = 観点別 4 系統の並行レビュー (①次局へ全員ready制 ②nextMatch遷移チェーン
  ③サイコロmodal/演出排他 ④ロジック修正の相互干渉) / codex(Sol) 側 = 同一範囲を独立レビュー
- 結果は本ドキュメント末尾の「修正リスト」に統合する

## 本日の指示一覧 (時系列)

| # | 指示 (要約) | 対応コミット | 状態 |
|---|---|---|---|
| 1 | 終局と上がりパネルを1枚にせず、上がり→次へ→終局の順次表示に | 8d45b18 | 済 |
| 2 | 国士無双は北抜きした北でロンできるか (ルール確認) | 回答のみ | 済 |
| 3 | タイトルを ONLINE ANMIKA に統一、「ちょっと欲張りな〜」等のダサい文言削除 | 222cfe0 | 済 |
| 4 | CPU戦のオンライン対戦ボタン削除 / 局中の牌譜保存ボタン削除 / 助言ボタンが白で見えない / 白ポッチ演出で停止 / 線演出ダサいから削除 | 3c69cc0 | 済 |
| 5 | 白ポッチ詰み: 通常リーチで連続はあり得ない (原因観の訂正) → タイマー非依存の3重close化 | 3c69cc0 | 済 |
| 6 | エントリの「cpu相手にすぐ遊べる/discordオンラインで」削除 / リーチ中に誰のツモか分からない (間を作る) / シュバサイ表示の背景が見づらい / リーチは打牌前なら取消可能に | 9442dd6 | 済 |
| 7 | SP UI の根本改善方針を立てる (横持ちオンリー可、設計は codex にも聞く) | 59f6a8a | 済 |
| 8 | 抜き牌と中央スコアの被り解消 / スタンプボタン小型化 | 700d9dd | 済 |
| 9 | SP再設計 手順A〜D (基線スクショ+bbox assert / Tile props / v2グリッド / board-stage / 44pxタップ / dock) | ada1cfb, 6e3becd, 6c65410, 954e12c | 済 |
| 10 | つもボタン等がデカい / ポッチツモ演出だけデカい | 134b30b, 426630e | 済 |
| 11 | SP v2 をデフォルト化 (旧UIは ?uiv1=1) | 1c9506e | 済 |
| 12 | ダブフィ: CPUがダブフィ打たない / 打点はツモボーナス込み最後に倍 / 夏夏金北も最後に倍 / SPで抜き多数時に手牌が切れる→下段の華表示を消す | 2bfaed0 | 済 |
| 13 | 金北の強化先選択でスタック (白待ちかわしとコンフリクト?) | 351b734 | 済 |
| 14 | 神ぽっちが表ドラに乗らない / 秋があると表示牌が増える再発 / フィーバー四華サイコロが2回降る | 4d309c3 | 済 |
| 15 | (オンライン初実戦) 他の人のアガリが表示されない / チップ移動が表示されない / サイコロが他の人に見えない | 7c8a011 | 済 |
| 16 | 終局時の表示と処理がされてない / チップが出てない / 金北選択時に手牌が見えない | 61a969b | 済 |
| 17 | p0とかじゃなくユーザー名表示 / 金北で四華強化するとサイコロ2回 | b11cc46 | 済 |
| 18 | 「次の試合へ」で同じ東1局に戻る (試合ごとに配牌が変わらない) / リーチ宣言プロンプトが他家に漏れる | 9ae3133 | 済 |
| 19 | ダブリーの翻数がおかしい (4翻に) / CPU白ツモで自分リーチ中に演出が出る / 右クリックでツモ切り / 内部文言の除去 | e126441 | 済 |
| 20 | ミンカンして嶺上ツモしたらツモれなくなった | c7f3bbb | 済 |
| 21 | 金北選択は現段階のアガリを計算して見せてから (前もそうだった) / チップ合計枚数と誰→誰に何枚の表示 / 鳴きなし・自動アガリのオンライン用トグル | 71a1683 | 済 |
| 22 | これも全部オンラインのミス→agmsgでcodexに原因を聞く / 他人ポンが!マークだけ / p0表示なおってない / ツモギリチェックは局が進んだら自動解除 / 回り親機能 | d61f621, 6a6e917 | 済 |
| 23 | 鳴き判定の時に右クリックで見送り | d61f621 | 済 |
| 24 | 試合開始直後の needsZimo 停止 (最優先・agmsgで) → 応急橋+三段ガード+不変条件テスト | 6a6e917, 9729527, 1be2bbd | 済 |
| 25 | シングル/ダブルフィーバーの判定と待ちの整理がおかしい (345777p46677788s) → 調査の結果ルールは意図通り、宣言前の候補別表示で解決 | 4a1976c | 済 |
| 26 | サイコロの回り (spin) と結果が揃わない → SaiKoroModal 作り直し | 9729527 | 済 |
| 27 | カンした時にカン表示 (リーチと同じ)、ポンも / 鳴き判断の対象が分かるように | 09cb842 | 済 |
| 28 | 鳴き判定待ちの表示を消す (非候補にバレる) | 9729527 | 済 |
| 29 | カットインが短くてすぐサイコロに進む → 表示順の直列化 | 9729527 | 済 |
| 30 | 鳴きハイライトは捨て牌でなく手牌側に (捨て牌だとバレる) | 9729527 | 済 |
| 31 | ポッチツモ関係の演出が割り込む癖を agmsg で調査 → 主因2つ特定・修正 (独立キューz9999 / cutinタイマー二重管理) | d180f42 | 済 |
| 32 | 表ドラ対象牌を光らせる | 4a1976c | 済 |
| 33 | 次局へは全員がボタンを押したら進む制に | 4a1976c | 済 |
| 34 | (本タスク) 残作業完遂 + 全修正の両面再チェック + 修正リスト + 全部修正 | 本ドキュメント + 1ea7d04 | 済 (Sol側総点検も 7/23 朝受領: 新規P1 1件のみ→5c513bd で修正済) |
| 35 | (予約分) 戦績記録DB+可視化 / 観戦モード / 名牌譜保存+再生 / 東風半荘設定 | 5c513bd, a3663f3, f009a10 | 済 (2026-07-23 実装・deploy済) |
| 36 | 4人回し (抜け番ローテ、サイコロだけ4人目参加) | docs/plans/four-player-rotation-design.md | 設計確定 (Sol合意)、実装は次スライス |

## 残作業の完遂 (レビュー前に実施)

- Sol調査C P0 の残り2テスト → `online_first_zimo_projection_2026_07_23.test.ts` (1be2bbd)
  - 局開始直後の canonical/projection/hydrate 第一ツモ不変条件 (3席)
  - nextMatch 後 (回り親 qijia 回転込み) の同不変条件
- 未着手のまま保留 (設計受領済み・別枠): chipTransfer DTO 化、東風戦 changshu protocol 本実装

## 修正リスト (fable 4系統の統合結果。Sol 分は届き次第追記)

### 対応済み (本レビュー起点の追いコミット)

| 重大度 | 指摘 | 修正 |
|---|---|---|
| P0 | nextMatch fast-forward の自動消化が command log に残らず、restore/replay 時に nextMatch が無言 no-op → mutation-token throw で「発火した部屋が後日 (全員離席30s or deploy 再起動) 恒久破壊」される時限爆弾 | 自動消化を正規 command として append/persist/broadcast し、nextMatch 本体の baseline を取り直す |
| P1 | 旧 H-02 の 120s fallback が押下0人でも nextRound を自動発行し、「全員が押すまで進まない」仕様を実質無効化 (内部 acceptAction は uid gate を通らないため生きていた) | roundEnded 分岐の自動 nextRound を撤去。押下後 AFK は 180s timeout、未押下切断は close handler の gate 再評価、全員切断は cleanup→復元後再押下でカバー |
| P1 | drawNext「zimo already drawn」reject に回復経路がなく、guard を踏む状況 (=橋が治すべき停止) で reject 止まり | reject と同時に該当 client へ最新 projection を sendSync (reject = 再同期化) |
| P1 | SaiKoroModal の awaitingRollAck が解除片道切符 (WS 切断中の送信握り潰し / server reject で「振っています…」のまま 180s 停止)。旧 roll watchdog は参照ゼロの dead code 化 | reject/sync 受信で親が進める recoveryNonce prop を追加し ack を解除。canOperate に WS 生存条件。dead module (saiKoroWatchdogs) と専用テストを削除 |
| P1 | ドラ現物ハイライトがアンミカ萬子循環 (m7↔m9) を無視 → 萬子表示牌で一切光らない (採点は m9 表示=ドラ m7 で数える) | 採点系と同じ doraFrom を再利用 |
| P1 | 正ぽっち表示牌 (z5g/z5b) はドラ計上から外れた (神ぽっち選択制) のに發が光る誤誘導 | isPositiveZ5 の表示牌をスキップ |
| P2 | ドラ glow が生 _baopai 参照で、金北/神ぽっち選択窓中に未コミットの秋めくりが先バレ | コミット済 displayBaopai 参照に変更 |
| P2 | 鳴きハイライトが拡張物理牌 (z5b/r/g/y 等) を照合できず白ポン/白カン判断で何も光らない | toCorePai 照合に変更 |
| P2 | CPU のカン/ポンだけカットイン無し (リーチ/ツモ/ロンは出る。人間経由の槍槓確定加槓だけ出る非一貫) | CPU 直呼び5箇所 (強制カン/自動暗槓/自動ポン/自動大明槓/リーチ後自動カン×2) に enqueue 追加 |
| P2 | cutin 強制解除 watchdog が store 更新毎に再アームされ「最後の更新から3倍尺」化 (オンラインで永遠に発火しない) — d180f42 で唯一の保険になったのに | cutin.ts 単位で一度だけアーム |
| P2 | オンラインでリロード/resync すると自分の過去の白ぽっち開示を再生 (演出排他を最大 ~13s 占有) | game ref 追跡を廃止し、初回は履歴読み飛ばし + 差分処理へ再設計 |
| P2 | ready 楽観押下に reject 時ロールバック無し + 接続時 sync に ready 進捗が乗らない + 復元部屋で「全員待ち」凍結 | typed nack (readyNextRoundNack) で押下ロールバック / 全 sendSync 直後に ready 状態送信 / applyCanonicalSync で押下表示リセット |
| P2 | rolls が縮んだ時 (rewind 等) SaiKoroModal の計数が過大のまま固まる | 縮み検知で再同期 (防御) |
| P2 | 一局戦の match 記録 POST がサイコロ未消化時点で確定し dice 分が chip_total に乗らない (既存負債) | post-win pending 全消化後に POST |
| P2 | オンライントグル (鳴きなし/自動アガリ) の $: 副作用が ack 前の store 更新で同一宣言を連射 | 判定窓キーで1回だけ送信 |

### 見送り / 継続 (理由付き)

- 非候補カモフラの「打牌者の手番」凍結表示 (P2 情報レベル): バレ防止とのトレードオフを取った意図的仕様。実プレイで違和感の報告が出たら文言再考
- sync の hydrate 失敗時に初戦盤面が残る件 (P2): 決定的失敗時のみの表示問題。resync 要求は出続ける。頻度を見て対応
- ドラ数バッジ/打牌アドバイスの正ぽっち旧セマンティクス (既存負債): glow と同時修正が筋だが採点表示に直結するため別スライスで
- 全員ready制の ws-runtime レベル自動テスト: fetchMembers が API server 依存で vitest 単体では組めない。Sol の sandbox 側テストか、api モック整備後に追加

## 検証

- vitest 1348 passed (watchdog dead-code テスト4本を削除、第一ツモ不変条件3本を追加済み)
- sp_baseline 6/6 green / build green

## 追記 (2026-07-23 昼): オンライン特有バグの両面総点検 [1ea7d04..1a2677d]

リョー指示「他にオンライン特有のバグがないか codex にも聞いてチェック」の結果。新規3件、全て c5868b1 で修正済み。

| 重大度 | 発見 | 指摘 | 修正 |
|---|---|---|---|
| P1 | fable | nukiBei event の replacement [補充ツモ牌] が publicEventForSeat 素通りで全 client に漏洩 | 本人以外 null マスク + 4席可視性テスト |
| P1 | Sol | finish_match の chip-ledger / room-events 別取得 TOCTOU [間に nextMatch で新旧 match 混在保存] | /internal/match-result 統合 [単一時点 snapshot] |
| P1 | Sol | stats 書き込みが途中席例外で部分 commit | SAVEPOINT 原子化 + 故障注入テスト |
| P2 | Sol | CPU pseudo member が公開集計に出る | 意図仕様として維持 [UI toggle 制御] |

Sol 確認済み [新規指摘なし]: 観戦 seat=-1 の全配信経路 / changshu protocol / chipTransfer 旧牌譜互換。

### 「CPU回しで直したバグはオンラインも直ってる」仮説の整理 (Sol 回答)

ゲームロジック層は正しい: canonical authority は solo と同じ store/game3 reducer を回すため、
Game3 純計算・reducer 内の fix は自動で共有される。
ただしオンライン固有層は別物で、fix しても共有されない経路:
(a) authority の validate mirror + canonical 二重適用 / actor gate
(b) server の turnTimeout / reactionTimeout / CPU deadline driver [solo cpuActions と別実装]
(c) rollSaiKoroDice の server 乱数 override
(d) blind projection → hydrate [他家手牌/山を再構築しない]
(e) nextRound all-ready / nextMatch fast-forward
(f) action whitelist / envelope / revision / reconnect / replay
(g) App の online 自動橋 / auto pass / auto win
→ この層の変更は今後も個別にオンライン観点レビューを通すこと。

## 追記 (2026-07-23 昼2): 5周チェック [リョー指示] とチップリセット全員同意制

| 周 | 内容 | 結果 |
|---|---|---|
| 1 | 試合終了フロー追跡+検証テスト [finished→projection→hydrate→GameEndPanel、全席+観戦、nextMatch遷移] | match_end_flow 3本 green |
| 2 | チップ lifecycle [baseline更新/finalize/reset/POST/WSA照合] | 欠陥なし [matchStartChipLedger は nextMatch accept で更新確認] |
| 3 | 新機能の終了画面干渉 [観戦/戦績/牌譜/同意UI] | 欠陥なし |
| 4 | Sol独立レビュー [f1fc1ae..eaa39d7] | 新規2件 P1 → 0cddab7 修正 [connected必須+切断票失効 / checkbox=server票の鏡] + P2 finished gate |
| 5 | 全suite 1378 + check 0 err + deploy 疎通 | green |

チップリセット全員同意制 [eaa39d7+0cddab7]: 全員に同意checkbox [n/m進捗]、connected な human 全席の同意が
揃った時だけ nextMatch で発動。host 独断・切断中・試合中の事前同意は全部不発側に倒す。
旧「reset時 match POST スキップ」は廃止 [戦績DB欠損のため常時記録]。
既知残課題: 終局4ケース [流局トビ/通常オーラス/返り東/アガリ止め] の ws-runtime 自動テストは api モック整備後。

## 追記 (2026-07-23 午後): 6〜9周目 [リョー指示「もっとやって」の続行分]

| 周 | 内容 | 結果 |
|---|---|---|
| 6 | 実機E2E復活 [run_online_e2e.mjs、port分離で本番共存] | spec側修正2件 [形式select追加のstrict違反 / dice-box化石] → **6/6 green** |
| 7 | Sol新レンズ [persistence/restore/rewind・auth/token・deadline全分岐・room lifecycle] | P0 1 + P1 3 + P2 1 → aac5b95 全修正 |
| 8 | Sol修正verify | P0残存1 [rewind ID fold配線漏れ] → d042843 修正 |
| 9 | Sol最終verify | **clean** [収束] |

7周目の実弾:
- P0 rewind局頭境界 [nextMatch無視で2試合目第1局→前試合へ巻き戻り+ID乖離] → computeRewindPlan化+境界テスト4本
- P1 **観戦が本番JWT経路で不成立** [verifyTokenがspectator flagを落とし4403 close。unit projectionテストでは捕まらない層] → flag復元+seat整合強制
- P1 cleanup_old_roomsがNode purge未通知 [DB削除後もauthority生存、room_id再利用衝突]
- P1 getRoom半初期化cache [fetch失敗でmatchMode永久tonpu] → room.ready promise化
- P2 evictでready gate/同意票が再評価されず180s待ち → 直接整理

学び: 静的レビュー+unitテストだけでは接続層 [token→branch分岐] のバグを検出できない。
実機E2Eの常用化が効いた。E2E実行手順:
`ANMIKA_E2E_PORT=18790 ANMIKA_WS_INTERNAL_PORT=18792 ANMIKA_WS_INTERNAL_BASE=http://127.0.0.1:18792 PYTHON=.venv/bin/python3 node tools/run_online_e2e.mjs`
