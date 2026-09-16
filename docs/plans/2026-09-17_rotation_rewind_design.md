# 交代 [抜け番ローテ] の巻き戻し 設計

日付: 2026-09-17 / 対象HEAD: 627d183 / 状態: **設計のみ・未実装**
リョー要件: 「交代を巻き戻す設計もつけといて」

前提の読み: ここでいう「交代」は 4人回しの抜け番ローテーションで席が入れ替わること
[`server/rotation.ts` の `mappingFor` / `nextMappingForMatch`]。交代は `nextMatch` を
accept した 1 点でしか起きないので、その 1 点を戻す設計として書く。
別物 [対局中に打ち手を差し替える「代打ち」機能そのもの] を指していたら、ここは土台にならない。

---

## 0. 先に結論

| # | 何を | なぜ |
|---|---|---|
| 1 | 巻き戻しに「交代をまたぐ」モードを足す | 今の `🔧 局頭に戻す` は直前の `nextRound` / `nextMatch` までしか戻らず、交代の手前へは一生戻れない |
| 2 | 戻した試合は **消さずに無効化** する [`matches.is_void`] | 牌譜の公開 URL を配っているので、行ごと消すと死にリンクになる |
| 3 | チップと戦績の戻しを同じ transaction に入れる | 今 `rewindRoom` は command log と snapshot しか触らず、`users.chip_total` が二重に残る |
| 4 | 1 回押して 1 交代だけ戻す | 2 交代分まとめて戻すと、どの試合を無効にしたのか人が追えなくなる |

---

## 1. 今どうなっているか

### 1.1 巻き戻しの境界

`computeRewindPlan` [`server/ws_server.ts:1052-1069`] は command 列を舐めて、
最後の `nextRound` **または** `nextMatch` の revision を `keepThrough` にする。
つまり戻り先は必ず「**今**の局の頭」で、交代の手前には届かない。
交代直後に押すと `kept.length === commands.length` になって
`already at round head` で弾かれる [`:2516-2519`]。

### 1.2 席とチップ台帳は既に戻せる

巻き戻し本体 [`:2536-2552`] は、捨てた command の delta を持ち込まないよう
`foldRoomState(snapshot.start, kept)` [`server/rotation.ts:131-143`] で
`roomChipLedger` と `activeMapping` を start から畳み直している。
**境界さえ越えられれば、席の並びと 4 人分のチップ台帳は正しく前の試合の形に戻る。**
ここは新規に作る必要がない。

### 1.3 戻せないのは DB 側

試合が終わると host の client が `POST /api/matches` を投げ、server が同じ transaction で

- `matches` 行を INSERT [`server/app.py:1763`。`room_id+match_no` UNIQUE / `room_id+match_uuid` UNIQUE]
- `users.chip_total += delta`、打った 3 人だけ `games_played += 1` [`:1788-1797`]
- `match_player_stats` を upsert [`:1800-1820`]

を書く。一方 `persistence.rewindRoom` [`server/persistence.ts:104-117`] は
`room_accepted_commands` の revision 超過分を DELETE して snapshot を save するだけ。

**今のまま境界だけ越えると、こうなる:**

1. 交代前に戻って前の試合を打ち直す
2. `match_uuid` は POST 成功時に sessionStorage から消えている [`src/App.svelte:2087`] ので、
   打ち直しは **新しい uuid** で飛ぶ → 409 idempotency に当たらない
3. `matches` が 2 行、`users.chip_total` が二重加算、`match_player_stats` も 2 試合分

この 3 点を締めるのが本題。

---

## 2. 何を「交代の巻き戻し」と呼ぶか [scope]

**直前の `nextMatch` を無かったことにして、その前の試合の最後の局頭に戻す。**

- 1 手ずつの取り消しではない
- 交代は `nextMatch` accept の 1 点 [`server/ws_server.ts:1484-1496`] でしか起きないので、
  そこだけを境界にすれば、席 / 台帳 / DB の 3 つを 1 つの原子操作に閉じ込められる
- `matchId` は DB の `match_no` と独立に回る [`rotation.ts` の決定則は `match_no` に依存しない]。
  この設計もその独立を崩さない

---

## 3. 設計

### 3.1 境界計算に「交代をまたぐ」を足す

```ts
// server/ws_server.ts
export function computeRewindPlan(
  commands: Array<Pick<AcceptedRoomCommand, 'revision' | 'action'>>,
  opts?: { crossMatch?: boolean },
): { keepThrough: number; matchId: number; roundId: number; voidsFinishedMatch: boolean }
```

- `crossMatch` 無し [既定] は今と完全に同じ挙動 — 既存の呼出と e2e を壊さない
- `crossMatch: true`:
  - 最後の `nextMatch` command を探し、**その 1 つ手前**の revision を `keepThrough` にする
  - `nextMatch` が 1 つも無ければ `voidsFinishedMatch: false` で「戻せない」を返す [試合 1 の途中]
  - 落とす範囲に `nextMatch` が 2 個以上入る形は作らない [1 回で 1 交代]
- `voidsFinishedMatch: true` = 「締め済みの試合が 1 つ無効になる」の合図。
  **どの `matches` 行かは WS 側が決めない** — 部屋の `matchId` と DB の `match_no` は
  §3.5 のとおりズレうるので、序数で指名すると外す。行の特定は DB 側の規則 [§3.2] に任せる

**fast-forward との関係**: `nextMatch` の直前で自動消化される post-win command
[`:1445-1462`] は `nextMatch` より小さい revision なので keep される。
つまり **前の試合は「終わった状態」のまま戻る**。これは狙いどおりで、
「もう一度締める」操作からやり直せる [サイコロの振り直しを含む]。

### 3.2 DB の後始末 [無効化。削除はしない]

`matches` に 2 列足す:

| 列 | 型 | 意味 |
|---|---|---|
| `is_void` | INTEGER NOT NULL DEFAULT 0 | 1 = 巻き戻しで無効になった試合 |
| `voided_at` | TEXT NOT NULL DEFAULT '' | 無効にした時刻 |

`/internal/rewind-room` は `voidsFinishedMatch` を返し、FastAPI 側 [`app.py` の `rewind_room`] が
**1 transaction** で:

0. 無効にする行を決める:
   `SELECT ... FROM matches WHERE room_id=? AND is_void=0 ORDER BY match_no DESC LIMIT 1`
   [1 交代 = 締め済みの試合 1 つ。最新の生きている行がそれに当たる]。
   行が無ければ何もせず「DB 側は戻すものが無い」で通す [部屋だけ戻す]
1. その行の `chip_delta_json` / `members_json` を取る
2. `users.chip_total -= delta`、`played_uids` と同じ集合だけ `games_played -= 1`
   [INSERT 時の集合定義 `app.py:1788-1792` と必ず同じ式を使う]
3. `DELETE FROM match_player_stats WHERE match_id = ?`
4. `UPDATE matches SET is_void=1, voided_at=..., rewound_from=match_no WHERE match_id = ?`
5. 冪等性は step 0 の `is_void=0` 条件が担う。二重に押されても、次の 1 行は
   「1 つ前の試合」なので**必ず巻き戻しと対で動く** [巻き戻せない = DB も動かない]

**削除ではなく無効化にする理由**: 牌譜の公開 URL [2026-09-14 で入れた] を配った後だと、
行ごと消すとリンクが 404 になる。無効化なら「この牌譜は巻き戻しで無効になりました」を
出せて、リンクは生きたまま残る。

**読み出し側で `is_void` を外す場所**:

- `/api/matches` 一覧、戦績集計 [`app.py:1863-1891` の stats クエリ]
- チップ総計の SSoT [`matches.chip_delta_json` の `json_each` fold]
- 公開牌譜の取得は**外さない**。開けるが「無効」バッジを出す

### 3.3 順序と失敗時の倒れ方

**DB を先に締めて、WS の巻き戻しは後。**

```
FastAPI: 1) ws に dry-run 問い合わせ [voidedMatchIds を取るだけ、まだ巻き戻さない]
         2) DB transaction で無効化 [上の 1-5]
         3) ws に本番の rewind-room [crossMatch=true] を投げる
```

- 2 で失敗 → 3 を投げない。部屋は無傷、DB も無傷。押し直せる
- 3 で失敗 → 無効化済みの試合が残り、部屋は交代後のまま。
  これは「チップだけ戻って盤面は進んでいる」状態なので、
  **`is_void` を戻す補償 UPDATE** をその場で打つ [2 の逆操作。同じ delta を足し直す]
- 逆順 [WS 先] にすると、DB が失敗した時にチップが二重のまま盤面だけ戻る = 気付けない

### 3.4 client

- `🔧 局頭に戻す` の隣に `⏪ 交代を取り消す` を置く [`src/App.svelte:2687` の並び]
- 同じ復帰パスワード [`ANMIKA_RECOVERY_PASSWORD`]。未設定なら両方とも出さない
- 押す前に確認文を出す:
  「試合 N の結果を無効にして、交代の前 [試合 N-1 の最後の局頭] に戻します。
   チップと戦績もその試合の分だけ戻ります」
- 巻き戻し後の `sendSync` [`:2563-2568`] で client は再 hydrate される。
  `matchStartChipLedger` は projection 由来 [`src/App.svelte:1319` / `:1403`] なので
  自動で前の試合の baseline に戻る — 追加の配線は要らない [**要検証**]
- `sessionStorage` の `anmikaMatchUuid:<roomId>` は sync 受信時に**消す**。
  POST 途中で落ちた uuid が残っていると、打ち直しが同じ uuid で飛んで 409 になり、
  「保存したのに記録されない」に化ける

### 3.5 match_no は飛ぶ [許容する]

打ち直した試合は `next_match_no = MAX(match_no)+1` [`app.py:1559`] で入るので、
`is_void` にした 3 の次は 4 になる。部屋の `snapshot.matchId` は 3 に戻っているので両者はズレる。

**これは許容する。** `rotation.ts` の決定則はもともと `match_no` に依存しない設計
[「pure `mappingFor(matchOrdinal, initialOrder)`。DB match_no / qijia に依存させない」]
なので、席の公平性には影響しない。追えるように `matches` へ
`rewound_from INTEGER NOT NULL DEFAULT 0` [無効にした元の match_no] を残す。

---

## 4. テスト

| # | 何を見るか | 置き場所 |
|---|---|---|
| 1 | `computeRewindPlan(cmds, { crossMatch: true })` が `nextMatch` の 1 手前を返す | `src/lib/__tests__/` の単体 |
| 2 | `nextMatch` が無い部屋では戻せない [`voidsFinishedMatch: false`] | 同上 |
| 3 | 既定呼出 [opts 無し] の戻り先が現状と 1 bit も変わらない | 既存 `codex_r1_adversarial_2026_07_23.test.ts` に並べる |
| 4 | 巻き戻し後の `activeMapping` が交代前の trio に戻る | `tests/rotation_cycle.spec.ts` 系 |
| 5 | 巻き戻し後の `roomChipLedger` が `foldRoomState` の値と一致する | 同上 |
| 6 | 無効化 → `users.chip_total` が試合前の値に戻る / `games_played` も戻る | `server/test_stats.py` に足す |
| 7 | 2 回続けて押しても 1 回分しか戻らない [冪等] | 同上 |
| 8 | 無効化した試合が戦績集計と一覧から消え、公開リンクは開ける | 同上 |
| 9 | 打ち直して POST すると新しい `match_no` で 1 行だけ増える | e2e |

---

## 5. 実装順

1. `matches` の列追加 [`is_void` / `voided_at` / `rewound_from`] + 読み出し側の除外
2. `computeRewindPlan` の `crossMatch` 対応 + 単体テスト [既定の挙動は据え置き]
3. `/internal/rewind-room` に dry-run と `crossMatch` を足す
4. FastAPI 側の無効化 transaction と補償 UPDATE
5. client のボタンと確認文、`anmikaMatchUuid` の掃除
6. e2e [交代 → 巻き戻し → 打ち直し → 集計が 1 試合分]

---

## 6. やらないこと [今回の範囲外]

- 1 手ずつの取り消し [command 単位の undo]
- 2 交代以上をまとめて戻す
- 抜け番の順番を手で決める / 打ち手を差し替える [「代打ち」機能そのもの]
- 巻き戻しの履歴を UI に並べる [ログには残すが画面には出さない]

---

## 7. 未決 [リョーに聞くこと]

1. 無効にした試合の牌譜は**残す**前提で書いた。消したいなら 3.2 を DELETE に変える
2. 無効化でチップを戻す範囲は「その試合の `chip_delta` 全員分 [抜け番のサイコロ精算込み]」で良いか
3. 交代を戻したあと、**同じ抜け番の並びで**打ち直すのか、もう一度 rotation を計算し直すのか
   [今の設計は前者。`nextMatch` を落とすので、次に押した時に同じ `matchOrdinal` から
    同じ mapping が出る]
