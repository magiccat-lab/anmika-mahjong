# 4人回し (抜け番ローテーション) 設計 — Sol合意版

日付: 2026-07-23 / 対象HEAD: f009a10 / 状態: Phase 1-3 実装済み [Sol レビュー反映込み]
リョー要件: 部屋に4人、順番に抜け番。抜け番はサイコロだけ受け取り/払い。観戦モードで部屋は見れる。

進捗 (2026-07-23 深夜):
- Phase 1 chip effect seam: 0308974 [+ Sol P1 反映 49a7dcb]
- Phase 2 protocol v3 + mapping 層 + 4-way fold: 812a64b [+ Sol P1×2 反映 b2d7ddb]
- Phase 3 seat 契約分離 + ready 抜け番除外: 6715f79 + 28171ce
- 残り: Phase 4 [rotation 決定 + server control command 化]、Phase 5 [matches POST/stats]、Phase 6 [UI/join]
- 運用注意: snapshot schema v3 は旧 server で読めない。deploy 前 DB backup、v3 後は rollback せず前進修正

## 方針 (Sol設計回答 2026-07-23 01:41Z、原文は agmsg log id=274)

**Game3/authority は純3席のまま維持。ws 層に room seat ↔ game seat の mapping と 4-way ledger を新設する。**
Game3 の chipLedger 0-3 化 (D代替) は避ける。

### 1. dice 精算の検出 = typed chip effect seam
- `src/lib/game3/chip.ts:80-99` applyChipOall は3人固定・breakdown に target/category なし → label/before-after 差分からの dice 判定 hook は作れない (禁止)
- ChipApplyOpts に `settlementKind: 'dice' | 'normal'` + effect sink を追加。applyChipOall 確定時に {kind, gameWinner, actualN, mode} を発行
- dice の呼出は `src/lib/store.ts:2151-2209` のみ → そこだけ settlementKind='dice'
- ws は mapping で active 3-way delta を 4-way へ写像。dice なら inactive room seat から actualN を払い winner へ加算
- **callback 副作用にしない**: acceptAction (`ws_server.ts:1139-1249`) の transaction 内で `action._roomChipDelta` を command に焼き込み、4-way ledger も同じ snapshot save で更新
- restore/replay は保存済み delta を fold する。Game3 再実行時に sink を再課金しない

### 2. 永続モデル (schema bump)
- RoomStartSnapshot (`server/protocol.ts:14-21`) に: `roomMembers[0..3]`, `rotationEnabled`, `activeMapping`, `roomChipLedger`
- CanonicalRoomSnapshot (`:87-98`) に current mapping/ledger
- `start.members` は active trio 専用に保つ (seat3 を混ぜない)。roomMembers と分離
- restoreAuthority (`ws_server.ts:266-285`) / membersForAuthority (`:119-124`) は room seat 直渡し禁止、mapping で game seat へ変換

### 3. projection の seat 契約分離
- captureSeatProjection の recipientSeat = **game seat 契約**
- JWT/API の seat = **room seat 契約**。送信直前に room→game 変換。inactive は SPECTATOR_SEAT(-1) 投影
- projection へ `recipientRoomSeat` / `recipientGameSeat|null` / `activeMapping` / `roomChipLedger` を別 field で追加
- App の actorSeat (`src/App.svelte:119`) と hydrate (`:1185-1275`) は WS seat=game seat 前提 → actorGameSeat を分離
- inactive は通常観戦者と違い自分の room chip を表示
- nextMatch で mapping を atomic 交換。mappingEpoch=matchId 不一致は sync 要求

### 4. command/replay
- AcceptedRoomCommand.actorSeat (`protocol.ts:76-84`) は canonical replay 用 game seat のまま。`actorRoomSeat` を別途追加
- mapping は各 nextMatch action に server 決定値を焼く
- rewind (`ws_server.ts:1899-1959`) も _roomChipDelta/nextMapping の fold 必須

### 5. ready / deadline / cleanup
- nextRound 中 mapping 不変。maybeAdvanceAllReady (`:1286-1293`) と total (`:1255-1264`) は active human のみ、inactive 除外
- ready set は room seat 保持、issue 時に game seat 変換
- deadline currentPlayer (`:1491-1525`) / postWin owner は game→room で member を引く
- inactive は操作権/deadline/ready なし
- **4人目は room.members に残して projection だけ spectator 化** (room.spectators へ移すと members 鮮度/ledger identity を失う)
- cleanup は 4 human 全接続で判定

### 6. rotation 決定則
- 算出タイミング: nextMatch **accept 直前** (fast-forward 完了・旧試合精算確定後)、server が nextMapping を算出して action へ焼く
- appendAcceptedCommand (`protocol.ts:174-201`) の matchId 増加 command を唯一の境界にする
- pure `mappingFor(matchOrdinal, initialOrder)`。DB match_no / qijia に依存させない
- 公平案: `inactiveIndex = (initialInactiveIndex + nextMatchId - 1) % 4`
- qijia は game 内起家で別軸。連動させるなら式を明文化して結果を action に保存

### 7. 追加の罠
- host が inactive の時 validateAction (`ws_server.ts:987-988`) は通るが validateAndApply (`authority.ts:176-185`) が actorSeat -1/3 を invalid にする → nextMatch 等の room control は **server control command 化**
- matches POST も inactive host のローカル依存を避け、4人化時は server authority が matchResult + roomChipDelta を確定保存する方向へ
- stats: rounds は activeMapping の3人だけ。inactive は dice chip delta のみ

## 実装順 (次スライス)
1. chip effect seam (game3/chip.ts + store dice 呼出) + 単体テスト
2. protocol/schema bump + mapping 層 + 4-way ledger fold (restore/rewind 込み)
3. ws 接続層 (room seat JWT / inactive projection) + client actorGameSeat 分離
4. rotation + server control command 化 + ready/deadline 除外
5. matches POST の server 確定化 + stats 4人対応
6. UI (部屋4人目 join / 抜け番表示 / room chip 表示)
