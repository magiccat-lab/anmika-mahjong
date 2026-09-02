# バグ再現ツール [tools/replay_room, hydrate_check, scan_rooms, dump_to_test]

2026-09-02 yuma。前日の 6U1V 調査で場当たりに書いた replay スクリプト群を、繰り返し使える CLI に整理したもの。
「詰まった」「進まない」「再接続しても盤面が出ない」の一次切り分けは、この 4 本で人手を掛けずに済ませる。

全部 `npx tsx tools/<name>.mts --help` で使い方が出る。型は `tsconfig.server.json` と同じ設定で通るが、
`tools/` は `npm run check` の対象外 [tsconfig の include に入っていない] なので、直した時は手で動かして確かめる。

---

## 1. データはどこにあるか

### ソロ [single-player]
サーバに状態は無い。client が落とす 2 種類の JSON だけが材料になる。

| 種類 | 作り方 | 中身 | 使えるツール |
|---|---|---|---|
| 診断ダンプ `stuck_<ts>.json` | 画面の診断ダンプ / 🐛 バグ通報 [`buildDiagnosticDump`, src/lib/store/paifuIo.ts] | `blocking` [pending*/awaiting*/roundEnded/cutin]、`flow` [message/lastZimo/lastDapai/currentPlayer/候補]、`game` [state/手牌/河/ドラ/lizhi/huapai/nukidora/chip/events]。**山と相手の伏せ牌は入っていない**。いつでも落とせる | dump_to_test |
| 牌譜 `paifu_<ts>.json` | 牌譜保存 [`buildCanonicalPaifuSnapshot`] | schemaVersion 3。山 [pai/rinshan/baopai/fubaopai] と全 field を持つので決定論的に復元できる。ただし保存点は「手番開始 [ツモ直後]」か「半荘終了」に限られ、詰まった局面では保存できない | dump_to_test / `buildStateFromPaifu` |

🐛 バグ通報は API サーバ [server/app.py `/api/bugreport`] が `server/data/bugreports/YYYYMMDD.jsonl` に 1 行 1 record で積む。
record の `dump` が診断ダンプそのもので、`mode` [solo/online/spectate]・`room_id`・`revision`・`seat` が付く。
online の通報は client dump より server 側 journal [下] が正なので、`room_id` と `revision` を持って次へ進む。

### オンライン
websocket 権威サーバ [server/ws_server.ts] が `data/anmika.sqlite3` [WAL。`-wal` `-shm` が同伴] に 2 テーブルで持つ。

- `room_state_snapshots(room_id, schema_version, revision, snapshot_json, updated_at)`: 部屋 1 行。`snapshot_json` は
  `CanonicalRoomSnapshot` [server/protocol.ts]。`start` に配牌前の山 `preShuffledPool`・`qijia`・`changshu`・`members` が入る。
  現在の盤面そのものは入っていない
- `room_accepted_commands(room_id, command_id, revision, actor_seat, action_json, ack_json, accepted_at)`: 受理コマンドの journal。
  revision 昇順に `RoomAuthority.validateAndApply` へ流すと、その revision の状態が決定論的に再現できる
  [`restoreAuthority(snapshot, commands)`]。`stamp` は状態に触れないので skip される

つまり「部屋 X の revision N の状態」は、この 2 テーブルのコピーがあればローカルで再現できる。
server のログは `ANMIKA_SERVER_DEBUG=1` の時だけ Game3 の内部ダンプを吐く [既定は無音]。

API DB `server/data/anmika.db` [FastAPI app.py] は `rooms` / `room_members` / `matches` / `match_player_stats` / `users`。
試合結果・統計・部屋のメタ [host, status, match_mode] であって、進行の journal ではない。
「試合が記録されていない」「chip が合わない」系はこちら、「進まない」系は ws store を見る。

---

## 2. DB を安全にコピーする

```sh
SCRATCH=/tmp/anmika_scratch   # 好きな場所。tools/out/ も gitignore 済みなので使える
mkdir -p $SCRATCH
cp data/anmika.sqlite3 data/anmika.sqlite3-wal data/anmika.sqlite3-shm $SCRATCH/
# glob なら: cp data/anmika.sqlite3* $SCRATCH/
# API DB も同様: cp server/data/anmika.db $SCRATCH/
```

- `-wal` を置いていくと直近の書き込みが見えない [snapshot が古い / commands が欠ける]。3 ファイルを必ず一緒に運ぶ
- コピーは 3 ファイルとも同じディレクトリ・同じ basename で置く [SQLite が `<name>-wal` で探す]
- ツールは `node:sqlite` の `DatabaseSync(path, { readOnly: true })` で開く。ただし WAL は読むだけでも `-shm` を触るので、
  既定では repo の `data/` `server/data/` 配下と `ANMIKA_DB_PATH` を **live 扱いで拒否**する。
  本番を直接読みたい時だけ `--allow-live` [read-only のまま]
- Node 22 の `node:sqlite` は起動時に `ExperimentalWarning` を stderr に出す。無害

---

## 3. ツール

### 3.1 replay_room: 部屋を復元して要約する

```sh
npx tsx tools/replay_room.mts --db $SCRATCH/anmika.sqlite3 --room 6U1V [--upto <revision>] [--json]
```

start snapshot + commands から `restoreAuthority` で権威を復元し、revision / matchId・roundId / game.state
[lunban/jushu/changbang/finished] / defen / chipLedger / pending* 全部 / awaiting / ron・pon・kan 候補 /
lizhiPending / roundEnded・lastWinner / `isPostWinResolved()` と、直近 8 command [revision, actor, type, accepted_at] を出す。
`--upto N` で revision N までだけ流す [その時点の状態を見る]。`--json` は 1 オブジェクトを stdout に出す [他の道具に渡す用]。

```
$ npx tsx tools/replay_room.mts --db $SCRATCH/anmika.sqlite3 --room 6U1V
room 6U1V  schema 3  head revision 103  replayed 103 commands through revision 103
snapshot: matchId 1  roundId 4  started true  updatedAt 2026-08-09T11:56:00.154Z  instance MSKZS35L80C8jenZXkxx7gMi
members: seat0 .noimi | seat1 arupu_ | seat2 isg.  qijia 0  changshu 1
rotation: activeMapping null  roomChipLedger {"0":110,"1":134,"2":-244}
last ack: matchId 1  roundId 4  revision 103
game: changbang 1  jushu 0  benbang 0  lizhibang 0  finished true  tongaeshi false  changshu 1
      lunban 0  currentPlayer 0  currentOya 0  paishu 96  baopai z6,z1  fubaopai p9,z2
defen: 0=19000 1=43000 2=43000   chipLedger: 0=110 1=134 2=-244
awaiting: ron=false fulou=false   lizhiPending: null
candidates: ron=[] pon=[] kan=[]  passed=[] declared=[] ronResults=0
pending: [none]
roundEnded true  lastWinner 2  lastZimo z5r  lastDapai null  cpuWinAck true
message: 🏁 半荘終了 1位 p1 43000点 / 2位 p2 43000点 / 3位 p0 19000点
isPostWinResolved: true
last 8 commands:
  rev   96  seat 2  tsumo                2026-08-09T11:55:13.324Z  _roomChipDelta={"0":20,"1":20,"2":-40} ...
  ...
  rev  103  seat 0  nextRound            2026-08-09T11:56:00.154Z  from_role="all-ready" preShuffledPool="[116]"
```

exit code: 0 復元成功 / 1 引数・部屋なし・未開始 / 2 `restoreAuthority` が throw。
2 の時は prefix を二分探索して最初に失敗する revision と、その command [actor / action] を出す。

```
room 6U1V: restore threw: cannot restore room 6U1V at revision 50: ...
first failing revision [bisect]: 50  actor seat 1  action {"type":"discard","pai":"m1"}
```

### 3.2 hydrate_check: 各席の projection が client に受理されるか

```sh
npx tsx tools/hydrate_check.mts --db $SCRATCH/anmika.sqlite3 --room 6U1V [--upto <revision>]
```

復元した権威から seat 0 / 1 / 2 / -1 [観戦] の `captureSeatProjection` を取り、`createGameStore().hydrateOnlineProjection` に
通して PASS / FAIL を出す。FAIL の席は、hydrate が見る field のうち null / 空 / 不正っぽいもの
[privateHand=null, publicHands[n].concealedCount=0, gameState.finished=true など] と、
store.ts `hydrateProjectionState` が dlog に残す reject 理由を並べる。
「再接続しても盤面が出ない」「resync が無限に往復する」は、まずここで席ごとに切り分ける
[8/9 6U1V は finished 後に privateHand=null で 3 席とも FAIL していた。今は server 側で空手牌を配るので PASS]。

```
room 6U1V  revision 103 [103 commands]  finished true  roundEnded true
seat  0: PASS
seat  1: PASS
seat  2: PASS
seat -1: PASS
result: all PASS
```

exit code: 0 全席 PASS / 1 FAIL あり・引数エラー / 2 復元が throw。

### 3.3 scan_rooms: 全部屋を 1 command ずつ流して JSONL に落とす

```sh
npx tsx tools/scan_rooms.mts --db $SCRATCH/anmika.sqlite3 [--room 6U1V,1EVR] --out $SCRATCH/scan
```

部屋ごとに `scan_<ROOM>.jsonl` [1 行 = 1 command 後の状態: rev/type/actor/at/reason/current/lunban/jushu/changbang/benbang/
defen/paishu/pending/awaiting/ron/roundEnded/lastWinner/finished/msg] と `summary.json` を書き、stdout に要約表を出す。
`reason` が付いた行 [validateAndApply の拒否 or throw] でその部屋は止まり、`first failing rev` に載る。
store 全体 [17 部屋 2500 command] でも数秒で終わる。

```
room | schema | commands | revisions | replayed | finished | first failing rev | error
-----+--------+----------+-----------+----------+----------+-------------------+------
6U1V | 3      | 103      | 1..103    | 103      | true     | -                 |
1EVR | 3      | 207      | 1..207    | 207      | false    | -                 |
```

「どの revision から pending が立ちっぱなしか」「defen がいつ動いたか」は jsonl を `jq` や grep で眺める。
例: `grep -n '"pending":"[^"]' $SCRATCH/scan/scan_6U1V.jsonl | head`。

exit code: 0 全部屋完走 / 1 引数エラー or 途中で失敗した部屋あり。

### 3.4 dump_to_test: client ダンプから vitest の雛形を作る

```sh
npx tsx tools/dump_to_test.mts --dump stuck_1723456789.json [--out src/lib/__tests__/bug_2026_09_02_xxx.test.ts]
npx tsx tools/dump_to_test.mts --dump server/data/bugreports/20260902.jsonl --index 0   # バグ通報 jsonl も直接読める
npx tsx tools/dump_to_test.mts --dump paifu_1723456789.json                              # 牌譜 v3 も可
```

診断ダンプ / バグ通報 record / 牌譜 v3 を読み、single-player store [`createGameStore()`] に同じ局面を組み立てる
テスト雛形を出す。組み方は synth*.mts と同じ [手牌は `buildShoupai(物理牌)` + `sp.zimo()`、副露・河・lizhi・huapai・
nukidora・ドラ表示・store の pending/awaiting を直接代入]。ダンプに無いものは `TODO` コメントで示す
[壁牌、kanDoraCount、yifaActive、相手の伏せ牌 など。goldHand / pochiHand / discardLog / lastZimoInfo は導出値として入る]。
`src/lib/__tests__/` に置き、`it()` の TODO [詰まった時に押した操作と本来の期待] を書けば回帰テストになる。
`--events` で `game.events` 全件も埋め込める。

雛形は生成直後の状態でも vitest が通る [buildState が走り、currentPlayer と message の一致だけ確認する]。
牌譜は山まで持つので、`buildStateFromPaifu(paifu)` [src/lib/store/paifuIo.ts] で丸ごと復元する手もある。

---

## 4. 典型フロー

1. バグ通報 jsonl の record を見る [`comment` / `mode` / `room_id` / `revision` / `seat`]
2. online なら DB をコピー → `replay_room --upto <revision>` で通報時点の状態 → `hydrate_check` で席ごとの受理 →
   `scan_rooms --room <ROOM>` で前後の遷移を眺める。復元が throw するなら bisect の revision が犯人の command
3. solo なら `dump_to_test` で雛形 → `src/lib/__tests__/` に置いて操作と assert を足す → `npx vitest run <file>`
4. 直したら同じ雛形が緑になることと `npm run check` / `npm test` で確認する

---

## 5. 本番を触らないルール

このディレクトリ [/home/m-catlab/apps/anmika-mahjong] は本番の作業ツリー直配信。調査中は次を守る。

- `npm run build` を走らせない [`dist/` は配信物。壊すと即本番に出る]
- `./dist` `./data` `./server/data` を書き換えない。DB は **必ずコピーして** コピーに対して動かす
- サービスを再起動しない。`git checkout` / `stash` / `reset` もしない [ws store は untrack 済みだが作業ツリーごと巻き戻る]
- ツールが書き込むのは `--out` で指定した場所だけ。`tools/out/` は gitignore 済みなので置き場に使える
- `--allow-live` は「コピーする余裕すら無い時に本番を read-only で覗く」用。常用しない
