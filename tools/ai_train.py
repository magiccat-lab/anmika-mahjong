"""AI v5 自走学習: PPO-lite trainer using AnmikaEnv [TS subprocess wrapper]

最小構成:
  - policy network: Linear(obs_dim → 256) → ReLU → Linear(256 → action_space)
  - value network: Linear(obs_dim → 256) → ReLU → Linear(256 → 1)
  - PPO clipped objective + value loss + entropy bonus
  - illegal action は legal_mask で logit を -inf に

使い方:
  python3 tools/ai_train.py --episodes 100 --lr 3e-4 --save out/policy.pt

依存: torch (cpu OK), numpy
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from ai_env import AnmikaEnv  # tools/ 直下なので cwd 次第
from torch.distributions import Categorical


def get_dims(env: AnmikaEnv) -> tuple[int, int]:
    meta = env.meta()
    return int(meta["obs_dim"]), int(meta["action_space"])


class ActorCritic(nn.Module):
    def __init__(self, obs_dim: int, act_dim: int, hidden: int = 256) -> None:
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(obs_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
        )
        self.policy_head = nn.Linear(hidden, act_dim)
        self.value_head = nn.Linear(hidden, 1)

    def forward(self, obs: torch.Tensor, mask: torch.Tensor) -> tuple[Categorical, torch.Tensor]:
        h = self.shared(obs)
        logits = self.policy_head(h)
        # illegal action は -inf でマスク
        logits = logits.masked_fill(~mask, float("-inf"))
        # 全 action illegal の保険 [pass=94 を強制 legal に]
        all_illegal = ~mask.any(dim=-1)
        if all_illegal.any():
            logits[all_illegal, 94] = 0.0
        dist = Categorical(logits=logits)
        value = self.value_head(h).squeeze(-1)
        return dist, value


def collect_rollout(
    env: AnmikaEnv,
    model: ActorCritic,
    rollout_steps: int,
    device: torch.device,
) -> dict:
    """1 batch 分の rollout を集める [可変 episode 長を rollout_steps step 回す]"""
    obs_buf, mask_buf, act_buf, logp_buf, val_buf, rew_buf, done_buf = (
        [],
        [],
        [],
        [],
        [],
        [],
        [],
    )
    obs = env.reset(seed=int(time.time() * 1000) % 1_000_000)
    for _ in range(rollout_steps):
        obs_t = torch.tensor(obs["obs"], dtype=torch.float32, device=device).unsqueeze(0)
        mask_t = torch.tensor(obs["legal_mask"], dtype=torch.bool, device=device).unsqueeze(0)
        with torch.no_grad():
            dist, value = model(obs_t, mask_t)
            action = dist.sample()
            logp = dist.log_prob(action)
        a = int(action.item())
        next_obs = env.step(a)
        obs_buf.append(obs["obs"])
        mask_buf.append(obs["legal_mask"])
        act_buf.append(a)
        logp_buf.append(float(logp.item()))
        val_buf.append(float(value.item()))
        rew_buf.append(float(next_obs["reward"]))
        done_buf.append(bool(next_obs["done"]))
        if next_obs["done"]:
            obs = env.reset(seed=int(time.time() * 1000) % 1_000_000)
        else:
            obs = next_obs
    return {
        "obs": np.array(obs_buf, dtype=np.float32),
        "mask": np.array(mask_buf, dtype=bool),
        "act": np.array(act_buf, dtype=np.int64),
        "logp": np.array(logp_buf, dtype=np.float32),
        "val": np.array(val_buf, dtype=np.float32),
        "rew": np.array(rew_buf, dtype=np.float32),
        "done": np.array(done_buf, dtype=bool),
    }


def compute_gae(
    rew: np.ndarray,
    val: np.ndarray,
    done: np.ndarray,
    gamma: float = 0.99,
    lam: float = 0.95,
) -> tuple[np.ndarray, np.ndarray]:
    T = len(rew)
    adv = np.zeros(T, dtype=np.float32)
    last_gae = 0.0
    for t in reversed(range(T)):
        next_val = val[t + 1] if t + 1 < T else 0.0
        next_nonterm = 1.0 - float(done[t])
        delta = rew[t] + gamma * next_val * next_nonterm - val[t]
        last_gae = delta + gamma * lam * next_nonterm * last_gae
        adv[t] = last_gae
    returns = adv + val
    return adv, returns


def ppo_update(
    model: ActorCritic,
    optimizer: torch.optim.Optimizer,
    batch: dict,
    adv: np.ndarray,
    ret: np.ndarray,
    epochs: int = 4,
    clip: float = 0.2,
    ent_coef: float = 0.01,
    vf_coef: float = 0.5,
    device: torch.device = torch.device("cpu"),
) -> dict:
    obs = torch.tensor(batch["obs"], dtype=torch.float32, device=device)
    mask = torch.tensor(batch["mask"], dtype=torch.bool, device=device)
    act = torch.tensor(batch["act"], dtype=torch.long, device=device)
    old_logp = torch.tensor(batch["logp"], dtype=torch.float32, device=device)
    adv_t = torch.tensor(adv, dtype=torch.float32, device=device)
    ret_t = torch.tensor(ret, dtype=torch.float32, device=device)
    # advantage normalize + return clip [v10: spike による value_loss explode 防止]
    adv_t = (adv_t - adv_t.mean()) / (adv_t.std() + 1e-8)
    ret_t = torch.clamp(ret_t, -5.0, 5.0)
    losses = {"policy": 0.0, "value": 0.0, "entropy": 0.0}
    for _ in range(epochs):
        dist, value = model(obs, mask)
        new_logp = dist.log_prob(act)
        ratio = torch.exp(new_logp - old_logp)
        surr1 = ratio * adv_t
        surr2 = torch.clamp(ratio, 1 - clip, 1 + clip) * adv_t
        policy_loss = -torch.min(surr1, surr2).mean()
        value_loss = F.mse_loss(value, ret_t)
        entropy = dist.entropy().mean()
        loss = policy_loss + vf_coef * value_loss - ent_coef * entropy
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 0.5)
        optimizer.step()
        losses["policy"] = float(policy_loss.item())
        losses["value"] = float(value_loss.item())
        losses["entropy"] = float(entropy.item())
    return losses


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--episodes", type=int, default=10)
    parser.add_argument("--rollout_steps", type=int, default=512)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--save", type=str, default="")
    parser.add_argument("--max_rounds", type=int, default=4)
    args = parser.parse_args()
    device = torch.device("cpu")
    env = AnmikaEnv(active=0, max_rounds=args.max_rounds)
    try:
        obs_dim, act_dim = get_dims(env)
        print(f"[ai_train] obs_dim={obs_dim} act_dim={act_dim} device={device}")
        model = ActorCritic(obs_dim, act_dim).to(device)
        optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
        for ep in range(args.episodes):
            t0 = time.time()
            batch = collect_rollout(env, model, args.rollout_steps, device)
            adv, ret = compute_gae(batch["rew"], batch["val"], batch["done"])
            losses = ppo_update(model, optimizer, batch, adv, ret, device=device)
            mean_rew = float(batch["rew"].mean())
            ep_count = int(batch["done"].sum())
            elapsed = time.time() - t0
            print(
                f"[ep {ep:03d}] steps={args.rollout_steps} ep_done={ep_count} "
                f"mean_rew={mean_rew:+.3f} policy_loss={losses['policy']:+.3f} "
                f"value_loss={losses['value']:.3f} entropy={losses['entropy']:.3f} "
                f"elapsed={elapsed:.1f}s"
            )
        if args.save:
            save_path = Path(args.save)
            save_path.parent.mkdir(parents=True, exist_ok=True)
            torch.save(model.state_dict(), save_path)
            print(f"[ai_train] saved policy to {save_path}")
    finally:
        env.close()


if __name__ == "__main__":
    main()
