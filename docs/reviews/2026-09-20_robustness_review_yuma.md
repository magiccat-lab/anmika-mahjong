# オンミカ 堅牢性レビュー [処理落ち / 点数ミス / 進行不能] (2026-09-20、yuma)

作成: 2026-09-20 / yuma。リョー「いまのおれのおんみかしすてむの改善点を考えたい、特に処理落ちとか点数ミスとか進行不能バグがないようにしたい。norosh1.com 類似サイトを解析して活かせるところは活かしてほしい」(アンミカ ch)。
前段は `2026-09-13_norosh1_audit_yuma.md` (ルールの突き合わせ、裁定 11 件) と `2026-09-14_ui_improvements_from_norosh.md` (UI)。ここではルールと UI は繰り返さず、「落ちない・間違えない・止まらない」に絞って計器で見た。

## 0. 結論 [先に読む]

- **使われ方の事実**: 対人 (online) は 08-09 が最後 (API DB: rooms 2 / matches 2 / users 4、ws.log は 09-15 の起動行だけ)。バグ通報 4 件は全部 solo (09-03〜09-07) で、全部 3 日以内に修正済み。優先は **solo のエンジンと描画**、online は「使う時に固まらない」保険
- **処理落ちの正体は描画側**。エンジンは 1 打牌 1 ms (CPU 4 倍遅くしても 9 ms)。中級スマホ相当 (CPU x4) で 60 秒に 50 ms 超の長タスクが 10〜25 回、**0.5〜0.9 秒の固まりが 2〜5 回、全部 演出 (cutin) 中**。App.svelte (5,496 行、`$game` 参照 392 か所) が store 更新のたびに全部評価される構造が主因。エンジンを Worker に出しても効かない
- **点数**: vitest 1,531 本緑 (fuzz 込み)、norosh1 の 2,820 局面リプレイで役 91% / 点数移動 88% 一致。残りは未裁定 6 件。ミスを「起きてから通報で直す」から「起きたら自動で捕まる」へ: リプレイ監査を回帰ゲートに、不変条件テストを足す
- **進行不能**: online は deadline / 代行 / 切断猶予 / hydrate backoff / 128k step fuzz まで揃っている。穴は 3 つ: (1) online の **リーチ取消を authority が知らない** (`unknown action type` で reject、09-02 から未着手)、(2) solo の固まりを検出するのは cutin の 3 倍尺 watchdog だけで、他は人が気づいて通報、(3) 誰も見ていない部屋の停止を server 側で検知する物が無い
- **品質ゲートが一番安くて効く**: `npm run check` が赤 (型エラー 15、App.svelte 1 か所、実行時は動く)、deploy は build だけでテストを回さない、CI 無し、e2e は本番と同じ 8790 番を掴む設定

順位 (効果 ÷ 手間):

| # | 何を | 手間 | 章 |
|---|---|---|---|
| 1 | ゲート: check を直す、deploy 前に check + 高速テスト、e2e の港を本番と分ける | 小 | 5 |
| 2 | 進行不能の穴 3 つ (cancelLizhi、solo の stuck 自動検知 + 1 タップ通報、部屋の停止監視) | 小〜中 | 4 |
| 3 | 点数の回帰ゲート (norosh リプレイの golden 部分集合を vitest に、不変条件、未裁定 6 件) | 中 | 3 |
| 4 | 処理落ち: App.svelte の分割と derived store、軽量モード、cutin 中の再評価抑制 | 中〜大 | 2 |
| 5 | 類似サイトから: 手番の残り秒と代行の予告、切断席の表示 | 小 | 6 |

## 1. 計器と数字の出所

| 計器 | 中身 |
|---|---|
| `tools/perf_probe_solo.mjs` (このコミットで追加) | 本番の solo を CPU 3 人で 60 秒回し、長タスク (50 ms 超) を局面 (cutin / nextRound / step) に紐付ける。CPU x4 と x1 |
| `tools/engine_cost_solo.mjs` (同上) | autoAdvance (同期で 1 局) の所要 ÷ 打牌数 = エンジン単体の 1 手コスト |
| `npx vitest run` | 195 file / 1,531 test 緑、3 file / 70 test skip (fuzz 込みで約 8 分) |
| `npm run check` | 15 errors / 1 file |
| API DB `server/data/anmika.db`、ws DB `data/anmika.sqlite3` (コピーを読んだ) | 対局と部屋の実績 |
| `server/data/bugreports/*.jsonl` | 通報 4 件 |
| `/home/m-catlab/secretary/var/anmika/{api,ws,static}.log` | api 9,267 req の 200 / 404 84 / 401 60、startup 失敗 27 行は 09-02 の asyncio 事故 |
| 天鳳マニュアル、雀魂 FAQ、norosh1 の bundle (09-13 の抜き出し) | 類似サイトの作法 |

## 2. 処理落ち

### 2.1 実測 (headless Chromium、915×412、DPR 2、本番 URL)

| 条件 | 長タスク 50 ms 超 / 60 秒 | p50 / p90 / max (ms) | FPS min / p10 / avg | script 秒 | style recalc / layout 回 |
|---|---:|---|---|---:|---|
| CPU x4 (1 回目) | 25 | 136 / 526 / 853 | 9 / 35 / 53.6 | 4.1 | 2,730 / 978 |
| CPU x4 (2 回目、紐付けあり) | 10 | 137 / 936 / 936 | 25 / 53 / 58.6 | 1.8 | 1,079 / 343 |
| CPU x1 (PC) | 11 | 93 / 198 / 222 | 48 / 56 / 59.3 | 1.1 | 3,171 / 1,173 |

2 回目の紐付け: **cutin 中 7 回 2,552 ms (最大 936)**、nextRound 2 回 323 ms、通常の 1 手 1 回 137 ms。
エンジン単体: x1 で 57 打牌が 55〜66 ms (**1 打牌 1 ms**)、x4 で 9 ms。nextRound は 1 ms。
起動: load 1.0 秒 (x1) / 1.7 秒 (x4)、卓が出るまで 1.1 / 2.0 秒。bundle は 534 + 107 KB。DOM は 720〜1,055 ノード、heap 8〜40 MB。

読み方: PC では体感できない (最大 0.2 秒)。中級スマホでは演出のたびに 0.5〜0.9 秒止まり、FPS が一桁まで落ちる瞬間がある。リョーの「処理落ち」はこれ。

### 2.2 原因の見立て (静的)

- `App.svelte` 5,496 行に `$game` の参照が 392 か所、`{#each}` が 46。Svelte 5 だが legacy store 構文なので、store が更新されるたびに 392 の式が再評価され、依存する DOM 差分が走る。cutin 中は cutin の enqueue / finish と CPU の進行が同時に store を叩くので、1 回の更新が重なって長タスクになる
- 演出そのものは CSS keyframes (CutinOverlay.svelte 174 行、画像デコード無し) で軽い。lottie は無し。3D サイコロ (dice-box、BabylonJS + Ammo) は 07-15 に CSS 3D cube に置換済みで、`initDiceBox` はもう呼ばれていない。ただし依存 (node_modules 11 MB) と `dist/assets/dice-box` (620 KB) が残っている
- box-shadow / filter は 26 か所で常識的な量。DOM 1,000 ノードも問題ない

### 2.3 案

1. **cutin 中の再評価を止める**: cutin の表示中は `$game` を読む本体 (卓、手牌、河) の更新を凍結し、cutin が終わった時に 1 回だけ反映する (store に `frozenSnapshot` を持つか、卓の部分を derived store にして cutin 中は購読を止める)。演出中に卓が動く必要は無いので見た目は変わらない。**効果は 2.1 の 7 回分がほぼ消える見込み**、手間 中
2. **App.svelte の分割**: 卓 / 手牌 / 河 / 結果 / ロビー を子コンポーネントにし、それぞれが必要な derived store だけ購読する。392 参照を各 30〜50 に。**効果は長タスクの p50 が半分**の見込み、手間 大。1 の後に、計器で before/after を取りながら
3. **軽量モード** (設定に 1 つ): cutin の尺を半分、影とぼかしを消す、CPU ラグを 0。norosh1 も 雀魂 も「演出を切る」設定を持っている。手間 小。処理落ちの根は直らないが逃げ道になる
4. dice-box の依存と asset を消す (使っていない 11 MB + 620 KB)。手間 極小
5. 計器を残す: `tools/perf_probe_solo.mjs` を deploy 後の確認に 1 回回す。長タスク max が 500 ms を超えたら戻す

## 3. 点数ミス

### 3.1 今ある物

- vitest 1,531 本 (役 / 符 / 祝儀 / FEVER / ぽっち / チップの回帰、V30 / V32 / V33 の fuzz、settlement)
- norosh1 との突き合わせ (`tools/norosh_audit.mts`、2,820 局面): 役 91% / 点数移動 88% 一致、差は裁定済み or 向こうの穴、**残り未裁定 6 件** (本役満の超過ハンの母数 88 局面、基本点の夏の段上げ 199、ドラ族の表裏 191 / 136、冬チップ 195、四暗刻単騎、金北の枚数)
- 通報 4 件はどれも ぽっち / 神ぽっち / FEVER の境界 (でかぽっち成立時の表ドラ神ぽっち、2p ツモ時の神ぽっち、青ぽっちの無視、見逃しフリテン)。3 日以内に修正 + 回帰テスト化済み
- 結果画面に内訳 (ChipBreakdown / RoundEndPanel) はある

### 3.2 穴

- リプレイ監査は手で回す物で、コードを変えた時に「一致率が下がった」を誰も見ない。09-14 の修正 5 本もリプレイで効果を測ったが、次に壊れても気づけない
- 不変条件のテストが薄い: 「1 局の点数移動の総和が 0 (供託と本場を含めて)」「チップ台帳の総和が 0」「祝儀の枚数が負にならない」「和了者以外の点数が増えない (ぽっち精算を除く)」を全 fuzz 局に掛ける物が無い (settlement.test は式の確認だけ)
- 通報の 4 件が示す通り、ミスは **ぽっち × FEVER × ドラ の組み合わせ**に出る。組み合わせを網羅する forced-state テストは V30 にあるが、期待値は「throw しない」で、点数の正しさは見ていない

### 3.3 案

1. **golden 回帰**: norosh リプレイの一致局面から、役 / 祝儀 / FEVER / ぽっち の型ごとに 300 局面を選び、期待値 (点数移動・チップ・役) を JSON に固めて vitest に入れる (1 秒台で回る)。全量 2,820 は週 1 で `norosh_audit` を回して一致率をログに残す。**変えた時に一致率が下がれば PR が赤くなる**。手間 中
2. **不変条件テスト**: 上の 4 条件を V32 (full games fuzz) の各局に assert で足す。手間 小。効果は「知らない型のミス」を捕まえる唯一の網
3. **未裁定 6 件を裁定に出す**: 本役満の超過ハン母数 (88 局面) は「majiang-core が役満判定した時に通常役が消える」構造の話なので、裁定と同時に実装方針も決める。他 5 件は数字が揃っているので 1 回の裁定で済む。手間 小 (リョーの時間だけ)
4. 内訳表示の一段深く: 結果画面の内訳に「符の内訳 (基本符 / 面子 / 待ち / 門前ロン)」と「祝儀の 1 行ごとの根拠 (どの裁定・ルール節)」を出す。ミスを見つけるのはリョーなので、**見つけやすくする**のが最短。手間 小〜中

## 4. 進行不能

### 4.1 今ある防御 (online)

| 場面 | 仕組み | 値 |
|---|---|---|
| 手番で押さない | turn deadline で server が代行 | 60 秒 (`ANMIKA_TURN_TIMEOUT_MS`) |
| 鳴き / ロンの応答が無い | reaction deadline | 15 秒 |
| 切断 | 猶予後に代行、復帰で hydrate | 30 秒猶予 |
| 局終了後に押さない | 全員 ready 制、切断者は gate から除外、人間ゼロなら server が nextRound | 180 秒 / 2 秒 |
| 和了後の演出 | 人間 owner の代行は長め | 180 秒 |
| 投影が hydrate できない | 指数 backoff、8 連続で停止して再読込案内 | 09-02 修正 |
| CPU / 代行が違法牌を選ぶ | reject を warn して合法牌へ | 09-02 修正 (128k step fuzz で発見) |
| 部屋の放置 | 24 時間超を 30 分ごとに archive | 09-02 |

solo: cutin が 3 倍尺 (`CUTIN_DURATION_MS × 3`) を超えたら強制終了する watchdog、🐛 通報ボタン (状態ダンプ添付)。engine 側は 128k step fuzz と forced-state fuzz。

### 4.2 穴

1. **online のリーチ取消**: client store は `cancelLizhi` を扱うが、`server/authority.ts` の action switch に無い (advanceSaiKoro / agariyame / … / tsumo の 23 種のみ)。宣言牌を選び直そうとした瞬間に `unknown action type` で reject され、client は宣言待ちのまま。09-02 のメモに「未着手」とあり、そのまま
2. **solo の固まりを検出する物が無い**: 通報 4 件のダンプ理由は全部 `stuck-state` (人が「固まった」と思って押した)。手番なのに押せる物が無い状態を 20 秒検知して「固まった？ 1 タップで通報」を出す仕組みが無い。cutin 以外の pending (pendingFuyu / pendingKinpei / pendingKamiPochi / pendingPochiSwap / pendingSaiKoro / pendingFeverContinue / awaitingRonDecision) は watchdog の外
3. **部屋の停止を server で見ていない**: playing の部屋で最終 accepted command から turn timeout × 3 (3 分) 動いていなければ、それは deadline 代行も止まっている = 本物の停止。今は誰かが気づくまで分からない。ws.log に timestamp が無いので後追いも難しい
4. 長時間 fuzz (`STALL_HUNT=1`、64 seed × 2,000 step、17 分) は手動でしか回らない。seed を変えて夜に回せば新しい停止を先に見つけられる

### 4.3 案

1. `authority.ts` に `cancelLizhi` を足す (store の reducer と同じ検査: lizhiPending の本人だけ)。回帰テストは `ws_open_riichi_wait_stall` の隣に 1 本。手間 小
2. solo の **stuck 検知**: `isAutoActionPhaseReady` と同じ材料で「人間の手番 / 応答待ち なのに合法手が 0、または pending modal が 20 秒動かない」を 1 か所で判定し、バナー + 1 タップ通報 (既存の `POST /api/bugreport` にダンプを乗せる)。通報が来れば `tools/dump_to_test.mts` で回帰にできる。手間 中
3. **部屋の停止監視**: `GET /api/rooms/{id}` に最終 accepted の時刻を足し、secretary の job (10 分ごと、`anmika_bugreport` の隣) が playing の部屋で 3 分以上止まっていたら alert (`anmika|room_stalled`)。ws.log には ISO timestamp と room id を付ける (今は境界を `[anmika-ws] authoritative endpoint listening` の byte offset で切るしかない)。手間 小〜中
4. 夜間 fuzz: secretary の scheduler か cron で `STALL_HUNT=1 STALL_HUNT_SEEDS=32 npx vitest run authority_stall_hunt` を毎晩、seed は日付から。落ちたら alert。手間 小

## 5. 品質ゲート

| 事実 | 意味 |
|---|---|
| `npm run check` が 15 errors (App.svelte 1822〜1889、`isAutoActionPhaseReady(snap: ReturnType<typeof get<typeof game>>)` の型注釈が store 型になっている) | 実行時は `get(game)` なので動くが、**型ゲートが赤いので新しい型エラーが混ざっても気づけない** |
| deploy (`secretary deploy-app --app anmika`) は fetch → pull → npm ci → build → restart。テストも check も回さない | 壊れたまま本番に出る経路が開いている |
| CI 無し (.github 無し) | 同上 |
| e2e (`playwright.config.ts`) は port 8790 を `reuseExistingServer` で掴む | 本番 API が 8790 に居るこのホストでは、**e2e が本番 API に繋がる** (test login は 404 で落ち、部屋を作るテストは本番 DB に書く)。single_flow の既定 URL も本番 |
| vitest 全量 8 分 (fuzz 込み) | deploy ゲートには長い |

案:
1. 型注釈を `StoreState` に直して check を緑に (1 行 × 2)。手間 極小
2. deploy-app の anmika 定義に `check_commands` を足す: `npm run check` と `npx vitest run --exclude '**/*fuzz*' --exclude '**/stall_hunt*'` (1 分以内)。落ちたら deploy を止める。fuzz は 4.3 の夜間へ。手間 小 (secretary 側 `ops/app_deploy.py`)
3. e2e の webServer を 18790 / 18791 に、`reuseExistingServer: false`、`ANMIKA_BASE_URL` 未設定なら 127.0.0.1 を既定に。手間 極小
4. `tools/perf_probe_solo.mjs` を deploy 後の確認に (2.3 の 5)

## 6. 類似サイトの作法と、うちへの当てはめ

| 観点 | 天鳳 | 雀魂 | norosh1 | うち (今) | 当てはめ |
|---|---|---|---|---|---|
| 持ち時間 | 5 + 10 秒 (速卓 3 + 5)。切れたら強制ツモ切り、警告音 3 回 | 秒読みあり、切れたら自動 | (bundle に持ち時間の文字列無し) | 60 秒で代行。**残り秒の表示が無い** | 残り秒を手番席に出す + 「あと N 秒で代行」。値は 60 のままでいい (身内卓) |
| 切断 | 60 秒無操作で強制ツモ切りモード、再入場 5 回まで、結果は反映 | 切断で自動打牌 / AI 代打ち、再接続で復帰、別端末でも継続 | 切断席の表示あり | 30 秒猶予で代行、復帰で hydrate、別端末は ws-token で可 | **切断席の表示** (誰が落ちているか、あと何秒で代行か) を卓に出す。回数制限は要らない |
| 観戦 / 牌譜 | 観戦は 5 分遅れ、牌譜は予告なく削除あり | 観戦あり | 牌譜の公開 URL と局面リンク | 観戦あり、公開 URL は 09-14 に実装済み | 済み |
| 演出の軽量化 | DOM 軽量 | 画質 / 演出の設定 | 不明 | 無し | 2.3 の 3 |
| 進行の可視化 | 秒読み音 | 秒読み | 不明 | 無し | 上の残り秒表示で兼ねる。「止まっている」と「相手が考えている」の区別が付く |
| ミス報告 | 無し | サポート | 不明 | 🐛 通報 + ダンプ (ドリオ方式) | 4.3 の 2 で自動化 |

出典: 天鳳マニュアル https://tenhou.net/man/ 、雀魂 FAQ https://mahjongsoul.com/faq 、norosh1 は `tmp/norosh-out/bundle.readable.js` (09-13 抜き出し)。

## 7. やる順と手間

1. 5 (ゲート 3 つ、半日)。これが無いと 2〜4 の修正で壊しても気づけない
2. 4.3 の 1 (cancelLizhi、1 時間) と 4.3 の 3 (部屋の停止監視 + ログの timestamp、半日)
3. 3.3 の 2 (不変条件、半日) と 3.3 の 1 (golden 回帰、1 日)。3.3 の 3 (裁定) はリョー待ちで並行
4. 4.3 の 2 (solo の stuck 検知、1 日) と 6 の残り秒 / 切断席の表示 (1 日)
5. 2.3 の 1 (cutin 中の凍結、1〜2 日) → 計器で確認 → 2.3 の 3 (軽量モード、半日) → 2.3 の 2 (分割) は数字を見てから
6. 4.3 の 4 (夜間 fuzz、1 時間) と 2.3 の 4 (dice-box 撤去、30 分) は隙間で

実装は駿 (アンミカの担当)。俺は計器と検収。

## 8. 前提と見ていない物

- 処理落ちの計測は headless Chromium の CPU x4 で、実機の GPU / メモリ / 熱は入っていない。実機で同じ現象が出るかは、リョーのスマホで `chrome://inspect` の Performance を 1 回取れば確定する (手順は俺が書く)
- online の負荷 (3 人同時) は計っていない。今は使われていないので、使う前に `tests/rotation_cycle.spec.ts` を x4 で回せば足りる
- norosh1 の内部 (サーバ側の進行不能対策) は外から見えない。bundle に出る UI 文字列だけ
