// CLI driver: stdin から JSON line 受けて env.step → stdout に obs JSON 返す
// 起動: npx tsx tools/ai_env_cli.ts
//
// protocol [1 行 = 1 message、 JSON]:
//   request:  {"cmd": "reset", "seed": number, "active": 0|1|2, "max_rounds": number}
//             {"cmd": "step", "action": number}
//   response: {"obs": number[], "legal_mask": boolean[], "player": number, "done": bool, "reward": number, "info": {...}}
//             {"error": "..."}

// stdout は JSON プロトコル専用。 game 内部の console.log [qipai/zimo etc] は stderr に逃がす
const origLog = console.log;
console.log = (...args: any[]) => process.stderr.write(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
void origLog;

import { AnmikaEnv, OBS_DIM, ACTION_SPACE_SIZE } from '../src/ai/env';
import { createInterface } from 'readline';

let env: AnmikaEnv | null = null;

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(payload: any): void {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function obsToJson(o: any): any {
  return {
    obs: Array.from(o.obs as Float32Array),
    legal_mask: o.legal_mask,
    player: o.player,
    done: o.done,
    reward: o.reward,
    info: o.info,
  };
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let req: any;
  try { req = JSON.parse(line); } catch (e) {
    send({ error: 'invalid json: ' + String(e) });
    return;
  }
  try {
    if (req.cmd === 'reset') {
      env = new AnmikaEnv({ activePlayer: req.active ?? 0, maxRounds: req.max_rounds ?? 16 });
      const o = env.reset(req.seed);
      send(obsToJson(o));
    } else if (req.cmd === 'step') {
      if (!env) { send({ error: 'env not reset' }); return; }
      const o = env.step(req.action);
      send(obsToJson(o));
    } else if (req.cmd === 'meta') {
      send({ obs_dim: OBS_DIM, action_space: ACTION_SPACE_SIZE });
    } else {
      send({ error: 'unknown cmd: ' + req.cmd });
    }
  } catch (e) {
    send({ error: String(e) });
  }
});

rl.on('close', () => process.exit(0));

// ready signal
process.stderr.write('[ai_env_cli] ready\n');
