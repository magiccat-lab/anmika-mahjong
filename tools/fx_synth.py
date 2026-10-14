"""パチンコっぽい効果音を numpy で作る (ラフ用)。48kHz mono wav"""
import numpy as np, wave, sys, os
SR = 48000
OUT = sys.argv[1]
def save(name, x):
    x = x / max(1e-9, np.max(np.abs(x))) * 0.85
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())
def t(d): return np.arange(int(SR * d)) / SR
def env(n, a=0.005, r=0.2):
    e = np.ones(n); na = int(SR * a); nr = min(n, int(SR * r))
    e[:na] = np.linspace(0, 1, na); e[-nr:] *= np.linspace(1, 0, nr) ** 2; return e
def sweep(f0, f1, d, shape='sin', curve=1.0):
    tt = t(d); f = f0 + (f1 - f0) * (tt / d) ** curve
    ph = 2 * np.pi * np.cumsum(f) / SR
    if shape == 'saw': return 2 * ((ph / (2 * np.pi)) % 1) - 1
    if shape == 'sq': return np.sign(np.sin(ph))
    return np.sin(ph)
def verb(x, d=0.6, dec=0.35):
    ir = np.random.default_rng(1).standard_normal(int(SR * d)) * np.exp(-t(d) / dec * 3)
    y = np.convolve(x, ir)[:len(x) + len(ir) - 1] * 0.05
    out = np.zeros(len(y)); out[:len(x)] += x; return out + y
# キュイン: 一気に上がる高い音 + 揺れ。当たり確定の音
k = sweep(900, 3600, 0.22, 'sq', 0.6) * 0.5 + sweep(1800, 7200, 0.22, 'sin', 0.6) * 0.3
k2 = np.concatenate([k, sweep(3600, 3600, 0.35, 'sq') * 0.5 * (1 + 0.5 * np.sin(2 * np.pi * 28 * t(0.35)))])
save('kyuin', verb(k2 * env(len(k2), 0.003, 0.25)))
# ガシャン: 役物が落ちる。低いドン + 金属のノイズ
rng = np.random.default_rng(2)
n = rng.standard_normal(int(SR * 0.5)) * np.exp(-t(0.5) * 9)
thump = np.sin(2 * np.pi * np.cumsum(np.linspace(140, 40, int(SR * 0.5))) / SR) * np.exp(-t(0.5) * 7)
metal = sum(np.sin(2 * np.pi * f * t(0.5)) * np.exp(-t(0.5) * dd) for f, dd in ((1230, 6), (2470, 8), (3710, 10), (5150, 12))) * 0.25
save('gashan', verb(thump * 1.2 + n * 0.5 + metal))
# ピキーン: 高い澄んだ音 (チャンスアップ)
p = sum(np.sin(2 * np.pi * f * t(1.2)) * np.exp(-t(1.2) * dd) * a for f, dd, a in ((2093, 3, 1), (4186, 4, .5), (6279, 6, .3), (3136, 3.5, .5)))
save('pikiin', verb(p * env(len(p), 0.002, 0.5), 1.0, 0.5))
# ギュイーン: 長く上がるうなり (リーチ ・ 溜め)
g = sweep(110, 880, 1.6, 'saw', 1.3) * 0.5 + sweep(220, 1760, 1.6, 'saw', 1.3) * 0.3
g *= (0.7 + 0.3 * np.sin(2 * np.pi * np.linspace(6, 30, len(g)) * t(1.6)))
save('gyuiin', g * env(len(g), 0.05, 0.08))
# ドン: 低い太鼓
d = np.sin(2 * np.pi * np.cumsum(np.linspace(120, 45, int(SR * 0.6))) / SR) * np.exp(-t(0.6) * 6)
save('don', d + rng.standard_normal(len(d)) * np.exp(-t(0.6) * 40) * 0.3)
# PUSH を押した音: ズキューン
z = sweep(2400, 300, 0.25, 'sq', 0.5) * 0.4 + sweep(1200, 150, 0.25, 'saw', 0.5) * 0.3
save('push', verb(z * env(len(z), 0.002, 0.1)))
# キラキラ: 細かい高い音の粒
kk = np.zeros(int(SR * 1.4))
for i in range(28):
    st = int(SR * i * 0.04); f = rng.uniform(3000, 8000); dd = 0.25
    seg = np.sin(2 * np.pi * f * t(dd)) * np.exp(-t(dd) * 14)
    kk[st:st + len(seg)] += seg[:len(kk) - st] * rng.uniform(.3, 1)
save('kira', kk)
# ハズレ: 下がる鈍い音
h = sweep(330, 110, 0.9, 'saw', 1.0) * 0.4 * env(int(SR * 0.9), 0.01, 0.4)
save('hazure', h)
# 心臓の音 (溜め)
hb = np.zeros(int(SR * 0.9))
for st in (0, 0.22):
    s = int(SR * st); seg = np.sin(2 * np.pi * np.cumsum(np.linspace(80, 40, int(SR * .18))) / SR) * np.exp(-t(.18) * 18)
    hb[s:s + len(seg)] += seg
save('heart', hb)
# 回転音 (サイコロが転がる): カラカラ
kr = np.zeros(int(SR * 1.5))
for i in range(40):
    st = int(SR * (i * 0.035 + rng.uniform(0, .01))); seg = rng.standard_normal(int(SR * .02)) * np.exp(-t(.02) * 200)
    kr[st:st + len(seg)] += seg * (1 - i / 45)
save('roll', kr)
print('ok')
