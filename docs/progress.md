# アンミカ三麻 開発進捗 [2026-06-25 時点]

## 公開 URL

https://anmika.magiccatlab.com/

## 実装済み概要

基本三麻 (配/ツモ/打牌/ロン/リーチ/ポン/カン/北抜き/流局/連荘/半荘) / 厳密フリテン / 喰い替え禁止 / 三麻独自点数計算 / サイコロチャンス (3D dice UI + シュバリ) / 春夏秋冬収納効果 / 金北強化選択 / ぽっち 4 色 + 神ぽっち / フィーバー (ダブル/トリプル) / chip v7 (祝儀計算 + 全倍率) / 間八萬 / オープン立直 / ダブロン / トビ賞 / オンライン対戦 (WebSocket) / AI (リーチ/ポン/カン/打牌 ukeire)

## 残 TODO

`docs/todo.md` 参照。

## 主要ファイル

- `src/lib/game3.ts` Game3 class、 三麻ゲーム state + 役判定 / 点数計算
- `src/lib/shan3.ts` 山 / ドラ / ぽっち色 / 金 metadata
- `src/lib/store.ts` Svelte store wrapper、 action 集約
- `src/App.svelte` UI
- `src/lib/Tile.svelte` 牌画像 svg 描画
- `src/lib/OnlineGameView.svelte` オンライン対戦 view
- `src/lib/SaiKoroModal.svelte` サイコロチャンス modal
- `src/lib/diceBoxSingleton.ts` 3D dice-box singleton
- `docs/api_spec.md` majiang-core API spec + アンミカ対応表
