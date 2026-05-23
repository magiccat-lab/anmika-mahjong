// anmika-mahjong AI env server [JSON-RPC over stdio]
// 用途: Python agent から AnmikaEnv の reset / step / observe を呼ぶ
//
// プロトコル: 1 行 = 1 JSON、 stdin で {method, params, id} 受け、 stdout に {result, id} 返す
// methods:
//   reset()                -> { obs, legal_actions }
//   step({ action })       -> { obs, legal_actions, reward, done }
//   close()                -> {}
//
// action space [v0 簡略]:
//   - 整数 0-13: 手牌位置 [tile index] を切る
//   - 14: 北抜き
//   - 15: ツモ宣言 [自摸アガリ]
//   - 16: pass [副露見送り / ロン見送り]
//   - 17: ロン [候補ある時]
//
// observation: 1500 dim flat vector [手牌 multihot + ツモ + 河 + meta + ...]
//
// CPU 進行: 学習者 player は P0 固定、 P1/P2 は random policy で進める
//
// 起動: ts-node env_server.ts [学習 script から spawn]

// console.log を stderr に redirect [Game3 dlog 等が stdout に混ざらないように]
const origLog = console.log;
console.log = (...args: any[]) => process.stderr.write(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
void origLog;

import { createGame, simpleRandomAgent } from './env_helpers.js';

interface RpcRequest { method: string; params?: any; id: number; }
interface RpcResponse { result?: any; error?: string; id: number; }

let env: any = null; // AnmikaEnv instance

function send(res: RpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

function handle(req: RpcRequest): RpcResponse {
  try {
    switch (req.method) {
      case 'reset': {
        env = createGame();
        env.advanceUntilLearnerTurn(); // CPU を学習者の番まで進める
        return { id: req.id, result: env.observe() };
      }
      case 'step': {
        if (!env) throw new Error('env not initialized, call reset first');
        const { action } = req.params ?? {};
        const stepResult = env.step(action);
        return { id: req.id, result: stepResult };
      }
      case 'expert_action': {
        if (!env) throw new Error('env not initialized, call reset first');
        return { id: req.id, result: env.expertAction() };
      }
      case 'close': {
        env = null;
        return { id: req.id, result: {} };
      }
      default:
        return { id: req.id, error: `unknown method: ${req.method}` };
    }
  } catch (e: any) {
    return { id: req.id, error: e?.message ?? String(e) };
  }
}

// stdin line-by-line
let buf = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  let idx: number;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const req = JSON.parse(line) as RpcRequest;
      send(handle(req));
    } catch (e: any) {
      send({ id: -1, error: `parse error: ${e?.message ?? String(e)}` });
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});
