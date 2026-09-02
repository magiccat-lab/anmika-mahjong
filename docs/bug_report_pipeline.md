# バグ通報 → 再現 → 修正 の回し方 [2026-09-02]

リョー指示「オンドリみたいにバグ通報が来たら shun が直せるようにする」。
ドリームオーダーの導線 [画面のバグ報告ボタン → jsonl → scheduler が調査タスクへ] をそのまま移植した。
症状だけ口頭で届いて再現できない、を無くすのが目的。

## 1. 導線

| 段 | 何が | どこ |
|---|---|---|
| 通報 | 画面の **🐛 バグ通報** [システム行 / 卓の設定シート / 終局画面]。本文を1行入れると、`buildDiagnosticDump` の状態ダンプ + mode + room_id + revision + seat + UA を `POST /api/bugreport` へ送る | `src/App.svelte` `reportBug()` |
| 保存 | 日付ごとの jsonl に追記。1MB/件、10件/10分/IP、400件/日 | `server/app.py` `save_bug_report`、置き場 `server/data/bugreports/YYYYMMDD.jsonl` [env `ANMIKA_BUGREPORT_DIR`] |
| 検知 | SECRETARY の scheduler job が 10 分毎に新着を alert にする。ダンプの写しを `state/anmika/bugreports/<日付>_<行>.json` に出し、payload に再現コマンド `how_to` を入れる | `secretary-v2 src/secretary/scheduler/jobs/anmika_bugreport.py` |
| 配車 | remediation が `anmika|bug_report` を AUTO_TRIAGE として **shun** のタスクにする | `secretary-v2 src/secretary/ops/remediation.py` |
| 再現 | shun が下の道具で復元して原因を特定、回帰テストを書いて直す | `tools/*.mts`、`src/lib/__tests__/` |
| 反映 | `secretary deploy-app --app anmika` [dry-run → 承認 → `--execute`]。**build は dist 直配信で即本番、API は restart しないと乗らない** | deploy-app |

## 2. 材料は mode で違う

- **solo [単人戦]**: サーバに牌譜が無い。通報に付いた状態ダンプ [`stuck_*.json` と同じ形] が唯一の材料。
  `npx tsx tools/dump_to_test.mts --dump <state/anmika/bugreports/...json>` で単人戦ストアの再現テスト雛形を出し、`src/lib/__tests__/` に置いて assert を足す
- **online / spectate**: room_id + revision があれば server 側の journal [`data/anmika.sqlite3` の `room_state_snapshots` + `room_accepted_commands`] から決定論的に復元できる。
  `cp data/anmika.sqlite3* <scratch>/` してから `npx tsx tools/replay_room.mts --db <scratch>/anmika.sqlite3 --room <ID> --upto <rev>`、client 側で受け付けられるかは `tools/hydrate_check.mts`
- 全部屋を舐めて異常を探すときは `npx tsx tools/scan_rooms.mts --db <scratch>/anmika.sqlite3 --out <scratch>/scan`

## 3. shun の手順 [チェックリスト]

1. タスクの payload を読む: `message` / `board` [mode・room・rev・手番・blocking] / `how_to` / `dump_path`
2. `how_to` をそのまま打つ。**本番 DB は必ずコピーを読む**。`data/` `server/data/` `dist/` に書かない、`npm run build` を打たない [dist 直配信で即本番]
3. 復元した状態で「最後に必要だった人間入力は何か / その入力手段が UI に見えていたか」を確かめる [`docs` の stuck dump の読み方: `blocking.cpuWinAck` は true が正常値]
4. 原因が engine なら `src/lib/game3.ts` / `store.ts`、進行なら `server/ws_server.ts` / `authority.ts`、表示なら `App.svelte`。修正の前に回帰テストを書き、fix 無しで落ちるのを確認する
5. `npm run check` と `npx vitest run` [約5分、build しない] を通す。`server/app.py` を触ったら import 検査 [`ANMIKA_DB_PATH=<scratch> .venv/bin/python3 -c "import sys; sys.path.insert(0,'.'); import importlib; importlib.import_module('server.app')"`] も通す
6. commit → `git push origin codex/all-fixes` → deploy-app dry-run → リョー承認 → `--execute` → 通報者へ返す

## 4. 既知の止まり方 [先に疑う順]

- 「ツモ和了／打牌を選択」のまま無反応: 金北の再計算失敗で `lastWinner` が残る / 加槓の槍槓評価で `lastDapai` が残る [2026-09-02 硬化済み。ダンプの `lastWinner` `lastDapai` を見る]
- 局終了後に誰も次局へ進めない: active 3席に人間がいない [4人回しの抜け番 host + CPU3席。server が代行するよう修正済み]
- 試合終了の投影を client が受け付けず resync が無限往復: `privateHand=null` [修正済み。`hydrate_check.mts` で全席 PASS を見る]
- でかぽっち [リーチ一発で 1p/2p ツモ] は本待ちなら通常ツモ [2026-09-02 リョー裁定]

## 5. 増やすときの約束

- 通報の形式を変えるなら `server/app.py` の record と scheduler job の `_summarize` / `_how_to` を同時に直す
- 通報 1 件 = テスト 1 本を目安に `src/lib/__tests__/<症状>_<日付>.test.ts` へ積む。fuzz で拾えない「人間の操作順」はテストでしか守れない
