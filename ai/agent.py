#!/usr/bin/env python3
"""anmika 麻雀 AI - policy network 雛形 + random baseline

使い方:
  python agent.py --mode random --episodes 100    # random agent baseline
  python agent.py --mode train  --episodes 1000   # REINFORCE 学習
  python agent.py --mode eval   --episodes 50 --ckpt ai/ckpt.pt

依存: torch [optional, train モード時のみ]
"""

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path

# ------- JSON-RPC client -------


class EnvClient:
    def __init__(self):
        cwd = Path(__file__).parent
        self.proc = subprocess.Popen(
            ["npx", "tsx", str(cwd / "env_server.ts")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(cwd.parent),
            text=True,
            bufsize=1,
        )
        self._id = 0

    def _rpc(self, method, params=None):
        self._id += 1
        req = {"method": method, "id": self._id}
        if params is not None:
            req["params"] = params
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("env_server EOF")
        res = json.loads(line)
        if "error" in res:
            raise RuntimeError(res["error"])
        return res["result"]

    def reset(self):
        return self._rpc("reset")

    def step(self, action):
        return self._rpc("step", {"action": action})

    def expert_action(self):
        return self._rpc("expert_action")

    def close(self):
        try:
            self._rpc("close")
        finally:
            self.proc.terminate()


# ------- agent ------

OBS_DIM = 192  # 動的に reset の obs.length で上書きされる
N_ACTIONS = 14  # 手牌 index 0..13


def detect_obs_dim(env):
    """env.reset を 1 回呼んで obs の次元を検出、 module 内 OBS_DIM を更新"""
    global OBS_DIM
    res = env.reset()
    obs = res.get("obs", [])
    if isinstance(obs, list) and len(obs) > 0:
        OBS_DIM = len(obs)
    return OBS_DIM


def random_action(legal_actions, obs=None):
    if not legal_actions:
        return 0
    return random.choice(legal_actions)


def run_episode(env, agent, record=False):
    res = env.reset()
    legal = res.get("legalActions", [])
    obs = res.get("obs", [0.0] * OBS_DIM)
    total = 0.0
    steps = 0
    trajectory = []
    while True:
        out = agent(legal, obs)
        if isinstance(out, tuple):
            a, logp = out
        else:
            a, logp = out, None
        if record:
            trajectory.append((obs, a, logp))
        step_res = env.step(a)
        r = step_res.get("reward", 0)
        total += r
        if record and trajectory:
            trajectory[-1] = trajectory[-1] + (r,)
        steps += 1
        if step_res.get("done"):
            break
        legal = step_res.get("legalActions", [])
        obs = step_res.get("obs", obs)
        if steps > 500:
            print("WARN: step cap hit", file=sys.stderr)
            break
    return total, steps, trajectory


# ------- policy net (torch) -------


def make_policy(hidden=128, obs_dim=None):
    import torch
    import torch.nn as nn

    if obs_dim is None:
        obs_dim = OBS_DIM

    class Policy(nn.Module):
        def __init__(self):
            super().__init__()
            self.fc1 = nn.Linear(obs_dim, hidden)
            self.fc2 = nn.Linear(hidden, hidden)
            self.fc3 = nn.Linear(hidden, hidden)
            self.head = nn.Linear(hidden, N_ACTIONS)
            self.value = nn.Linear(hidden, 1)

        def forward(self, x):
            h = torch.relu(self.fc1(x))
            h = torch.relu(self.fc2(h))
            h = torch.relu(self.fc3(h))
            return self.head(h), self.value(h)

    return Policy()


def make_policy_agent(policy, deterministic=False):
    import torch
    from torch.distributions import Categorical

    def agent(legal_actions, obs):
        if not legal_actions:
            a = 0
            logp = torch.tensor(0.0)
            val = torch.tensor(0.0)
            ent = torch.tensor(0.0)
            return a, (logp, val, ent)
        obs_t = torch.tensor(obs, dtype=torch.float32)
        logits, val = policy(obs_t)
        val = val.squeeze(-1)
        mask = torch.full_like(logits, float("-inf"))
        for i in legal_actions:
            if 0 <= i < N_ACTIONS:
                mask[i] = 0.0
        masked = logits + mask
        dist = Categorical(logits=masked)
        if deterministic:
            a = int(masked.argmax().item())
        else:
            a = int(dist.sample().item())
        logp = dist.log_prob(torch.tensor(a))
        ent = dist.entropy()
        return a, (logp, val, ent)

    return agent


def train_reinforce(env, args):
    """REINFORCE with value baseline (A2C-lite) + entropy bonus."""
    import torch
    import torch.nn.functional as F
    import torch.optim as optim

    policy = make_policy(hidden=args.hidden, obs_dim=OBS_DIM)
    if args.ckpt and Path(args.ckpt).exists():
        try:
            policy.load_state_dict(torch.load(args.ckpt))
            print(f"loaded ckpt: {args.ckpt}")
        except Exception as e:
            print(f"ckpt load skip [{e}]")
    opt = optim.Adam(policy.parameters(), lr=args.lr)
    agent = make_policy_agent(policy)

    gamma = args.gamma
    entropy_coef = 0.01
    value_coef = 0.5
    ep_rewards = []
    for ep in range(args.episodes):
        total, steps, traj = run_episode(env, agent, record=True)
        ep_rewards.append(total)
        # discount return
        G = 0.0
        returns = []
        for entry in reversed(traj):
            r = entry[3] if len(entry) >= 4 else 0.0
            G = r + gamma * G
            returns.append(G)
        returns.reverse()
        if not returns:
            continue
        returns_t = torch.tensor(returns, dtype=torch.float32)

        logps = []
        vals = []
        ents = []
        for entry in traj:
            if len(entry) < 4:
                continue
            _, _, logp_pack, _ = entry
            if isinstance(logp_pack, tuple):
                lp, v, en = logp_pack
            else:
                lp, v, en = logp_pack, torch.tensor(0.0), torch.tensor(0.0)
            logps.append(lp)
            vals.append(v)
            ents.append(en)
        if not logps:
            continue
        logps_t = torch.stack(logps)
        vals_t = torch.stack(vals)
        ents_t = torch.stack(ents)
        adv = returns_t - vals_t.detach()
        if adv.std() > 1e-6:
            adv_norm = (adv - adv.mean()) / (adv.std() + 1e-6)
        else:
            adv_norm = adv
        policy_loss = -(logps_t * adv_norm).mean()
        value_loss = F.smooth_l1_loss(vals_t, returns_t)
        entropy_loss = -ents_t.mean()
        loss = policy_loss + value_coef * value_loss + entropy_coef * entropy_loss
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
        opt.step()
        if (ep + 1) % 10 == 0:
            avg = sum(ep_rewards[-10:]) / 10
            print(
                f"ep {ep + 1}/{args.episodes}  last10 avg = {avg:.2f}  steps {steps} p_loss={policy_loss.item():.3f} v_loss={value_loss.item():.3f}"
            )
    if args.ckpt:
        Path(args.ckpt).parent.mkdir(parents=True, exist_ok=True)
        torch.save(policy.state_dict(), args.ckpt)
        print(f"saved ckpt: {args.ckpt}")
    return ep_rewards


def train_bc(env, args):
    """Behavior Cloning - expert [pickBestDiscard] action を policy に教師あり学習

    各 episode:
      - reset → 学習者番で expert_action() で (obs, action) 収集
      - 同じ action を env.step() に渡して局を expert で進める
      - episode 終了で 蓄積した sample に対し cross-entropy で minibatch 更新

    REINFORCE と違い random より確実に上回る、 sample efficient。
    """
    import torch
    import torch.nn as nn
    import torch.optim as optim

    policy = make_policy(hidden=args.hidden, obs_dim=OBS_DIM)
    if args.ckpt and Path(args.ckpt).exists():
        try:
            policy.load_state_dict(torch.load(args.ckpt))
            print(f"loaded ckpt: {args.ckpt}")
        except Exception as e:
            print(f"ckpt load skip [{e}]")
    opt = optim.Adam(policy.parameters(), lr=args.lr)
    loss_fn = nn.CrossEntropyLoss()
    batch_size = max(8, args.batch_size)

    ep_rewards = []
    buffer_obs: list = []
    buffer_act: list = []
    for ep in range(args.episodes):
        # 各 episode 開始 [この時点で env は train 開始前 reset 済 or 直前 ep step 内で done]
        ex = env.expert_action()
        obs = ex.get("obs", [])
        a = ex.get("action", 0)
        total = 0.0
        steps = 0
        while True:
            buffer_obs.append(list(obs))
            buffer_act.append(int(a))
            step_res = env.step(a)
            total += step_res.get("reward", 0)
            steps += 1
            if step_res.get("done"):
                break
            if steps > 500:
                print("WARN: step cap hit (bc)", file=sys.stderr)
                break
            ex = env.expert_action()
            obs = ex.get("obs", obs)
            a = ex.get("action", 0)
        ep_rewards.append(total)

        # buffer から minibatch sample → 学習
        if len(buffer_obs) >= batch_size:
            # 全 buffer を 1 epoch で 通す [簡易版]、 buffer は次 ep へ持ち越し
            n = len(buffer_obs)
            idx = list(range(n))
            random.shuffle(idx)
            losses = []
            for start in range(0, n, batch_size):
                chunk = idx[start : start + batch_size]
                xb = torch.tensor([buffer_obs[i] for i in chunk], dtype=torch.float32)
                yb = torch.tensor([buffer_act[i] for i in chunk], dtype=torch.long)
                logits, _ = policy(xb)
                loss = loss_fn(logits, yb)
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
                opt.step()
                losses.append(loss.item())
            # buffer 上限 抑制 [5000 sample]
            if len(buffer_obs) > 5000:
                buffer_obs = buffer_obs[-5000:]
                buffer_act = buffer_act[-5000:]
            if (ep + 1) % 10 == 0:
                avg_r = sum(ep_rewards[-10:]) / min(10, len(ep_rewards))
                avg_l = sum(losses) / max(1, len(losses))
                print(
                    f"bc ep {ep + 1}/{args.episodes}  last10 r={avg_r:.2f}  steps={steps}  loss={avg_l:.4f}  buf={len(buffer_obs)}"
                )
        # 次 episode の reset
        if ep + 1 < args.episodes:
            env.reset()

    if args.ckpt:
        Path(args.ckpt).parent.mkdir(parents=True, exist_ok=True)
        torch.save(policy.state_dict(), args.ckpt)
        print(f"saved ckpt: {args.ckpt}")
    return ep_rewards


def eval_policy(env, args):
    import torch

    policy = make_policy(hidden=args.hidden, obs_dim=OBS_DIM)
    if args.ckpt and Path(args.ckpt).exists():
        policy.load_state_dict(torch.load(args.ckpt))
    policy.eval()
    agent = make_policy_agent(policy, deterministic=True)
    rewards = []
    for ep in range(args.episodes):
        with torch.no_grad():
            total, _, _ = run_episode(env, agent, record=False)
        rewards.append(total)
    return rewards


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", default="random", choices=["random", "train", "eval", "bc"])
    p.add_argument("--episodes", type=int, default=100)
    p.add_argument("--hidden", type=int, default=64)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--batch-size", type=int, default=32, dest="batch_size")
    p.add_argument("--ckpt", type=str, default="ai/ckpt.pt")
    args = p.parse_args()

    env = EnvClient()
    rewards = []
    try:
        # obs_dim を env から動的取得 [reset 経由]
        detect_obs_dim(env)
        print(f"detected OBS_DIM = {OBS_DIM}", file=sys.stderr)
        if args.mode == "random":
            for ep in range(args.episodes):
                r, s, _ = run_episode(env, random_action)
                rewards.append(r)
                if (ep + 1) % 10 == 0:
                    avg = sum(rewards[-10:]) / 10
                    print(f"ep {ep + 1}/{args.episodes}  last10 avg = {avg:.2f}  steps {s}")
        elif args.mode == "train":
            rewards = train_reinforce(env, args)
        elif args.mode == "bc":
            rewards = train_bc(env, args)
        elif args.mode == "eval":
            rewards = eval_policy(env, args)
    finally:
        env.close()

    print("---")
    print(f"mode: {args.mode}")
    print(f"episodes: {len(rewards)}")
    if rewards:
        print(f"mean reward: {sum(rewards) / len(rewards):.2f}")
        print(f"min/max: {min(rewards):.2f} / {max(rewards):.2f}")


if __name__ == "__main__":
    main()
