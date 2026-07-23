// [2026-07-24 4人回し, Sol設計] test 専用 WS 起動 entry。
// testControlsEnabled は env で有効化できない設計のため、rotation 境界の統合テスト
// [tests/rotation_cycle.spec.ts] はこの entry を明示 spawn する。
// production の起動は server/ws_server.ts [testControlsEnabled 常時 false] のまま。
import { createWsRuntime } from './ws_server.ts';

createWsRuntime({ testControlsEnabled: true });
