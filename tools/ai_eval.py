"""ai_eval.py - 学習済 PPO policy の妥当性 verification
リョー指示 2026-05-13、 「AI v6 PPO 妥当性 verify」

検証項目:
  1. illegal action 比率: legal_mask 強制で 0% である事 [本来 0、 確認]
  2. action distribution: random vs trained policy で entropy 差
  3. 平均 reward 比較: 100 episode で trained vs random
  4. action 種別ヒストグラム: trained policy が dapai/lizhi/tsumo にどう寄せるか

使い方:
  python3 tools/ai_eval.py --policy out/policy_v6_ep200.pt --episodes 50
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from ai_env import AnmikaEnv
from ai_train import ActorCritic


def get_dims(env: AnmikaEnv) -> tuple[int, int]:
    meta = env.meta()
    return int(meta["obs_dim"]), int(meta["action_space"])


def run_episode(env: AnmikaEnv, model: ActorCritic | None, seed: int) -> dict:
    """1 episode 実行、 結果を返す"""
    obs = env.reset(seed=seed)
    rew_total = 0.0
    actions: list[int] = []
    illegal_attempts = 0
    steps = 0
    while not obs["done"] and steps < 1000:
        legals = [i for i, b in enumerate(obs["legal_mask"]) if b]
        if model is None:
            # random policy: legal action から uniform pick
            if legals:
                action = int(np.random.choice(legals))
            else:
                action = 94  # PASS
        else:
            obs_t = torch.tensor(obs["obs"], dtype=torch.float32).unsqueeze(0)
            mask_t = torch.tensor(obs["legal_mask"], dtype=torch.bool).unsqueeze(0)
            with torch.no_grad():
                dist, _ = model(obs_t, mask_t)
                action = int(dist.sample().item())
            # illegal 検出 [trained でも mask 不整合あれば cnt]
            if obs["legal_mask"][action] is False:
                illegal_attempts += 1
        actions.append(action)
        obs = env.step(action)
        rew_total += obs["reward"]
        steps += 1
    return {
        "steps": steps,
        "total_reward": rew_total,
        "actions": actions,
        "illegal_attempts": illegal_attempts,
        "done": obs["done"],
    }


def summarize(results: list[dict], label: str) -> dict:
    rewards = [r["total_reward"] for r in results]
    steps = [r["steps"] for r in results]
    illegals = [r["illegal_attempts"] for r in results]
    all_actions: list[int] = []
    for r in results:
        all_actions.extend(r["actions"])
    cnt = Counter(all_actions)
    # action 区分: dapai 0-38 / 副露 39-83 / lizhi 84-91 / tsumo 92 / ron 93 / pass 94 / 北 95 / 華 96 / cont 97 / next 98
    by_kind = {
        "dapai": sum(cnt.get(i, 0) for i in range(0, 39)),
        "fulou": sum(cnt.get(i, 0) for i in range(39, 84)),
        "lizhi": sum(cnt.get(i, 0) for i in range(84, 92)),
        "tsumo": cnt.get(92, 0),
        "ron": cnt.get(93, 0),
        "pass": cnt.get(94, 0),
        "nuki_bei": cnt.get(95, 0),
        "other": sum(cnt.get(i, 0) for i in [96, 97, 98]),
    }
    return {
        "label": label,
        "episodes": len(results),
        "mean_reward": float(np.mean(rewards)),
        "std_reward": float(np.std(rewards)),
        "mean_steps": float(np.mean(steps)),
        "total_actions": len(all_actions),
        "illegal_attempts_total": sum(illegals),
        "illegal_pct": (round(100 * sum(illegals) / len(all_actions), 3) if all_actions else 0),
        "action_distribution": by_kind,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", type=str, default="out/policy_v6_ep200.pt")
    parser.add_argument("--episodes", type=int, default=30)
    parser.add_argument("--max_rounds", type=int, default=4)
    parser.add_argument("--seed_base", type=int, default=10000)
    args = parser.parse_args()

    env = AnmikaEnv(active=0, max_rounds=args.max_rounds)
    try:
        obs_dim, act_dim = get_dims(env)
        # random baseline
        random_results = []
        for ep in range(args.episodes):
            r = run_episode(env, None, args.seed_base + ep)
            random_results.append(r)
        random_summary = summarize(random_results, "random")

        # trained policy
        trained_summary = None
        policy_path = Path(args.policy)
        if policy_path.exists():
            model = ActorCritic(obs_dim, act_dim)
            model.load_state_dict(torch.load(policy_path, map_location="cpu"))
            model.eval()
            trained_results = []
            for ep in range(args.episodes):
                r = run_episode(env, model, args.seed_base + ep)
                trained_results.append(r)
            trained_summary = summarize(trained_results, f"trained({policy_path.name})")
        else:
            print(f"[ai_eval] policy not found: {policy_path}", flush=True)
    finally:
        env.close()

    out = {"random": random_summary, "trained": trained_summary}
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
