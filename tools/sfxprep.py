import os, sys, wave
import numpy as np
import miniaudio

SR = 44100
D = 'game/_cand'
O = os.path.join(D, '_out')
os.makedirs(O, exist_ok=True)


def load(p, sr=SR):
    d = miniaudio.decode_file(p, output_format=miniaudio.SampleFormat.SIGNED16,
                              nchannels=1, sample_rate=sr)
    return np.frombuffer(d.samples, dtype=np.int16).astype(np.float32) / 32768.0


def save(p, a):
    a = np.clip(a, -1.0, 1.0)
    with wave.open(p, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((a * 32767).astype(np.int16).tobytes())


def hp(x, hz):
    """一阶高通，去掉直流与次声隆隆"""
    if hz <= 0:
        return x
    rc = 1.0 / (2 * np.pi * hz)
    dt = 1.0 / SR
    al = rc / (rc + dt)
    y = np.empty_like(x)
    prev_x = x[0]
    prev_y = 0.0
    for i in range(len(x)):
        prev_y = al * (prev_y + x[i] - prev_x)
        y[i] = prev_y
        prev_x = x[i]
    return y


def prep(src, start_ms, end_ms, peak_db=-1.5, fade_in=2.0, fade_out=35.0, hp_hz=0):
    a = load(os.path.join(D, src))
    s = max(0, int(start_ms / 1000 * SR))
    e = min(len(a), int(end_ms / 1000 * SR))
    x = a[s:e].copy()
    if hp_hz:
        x = hp(x, hp_hz)
    p = float(np.max(np.abs(x)))
    if p > 0:
        x *= (10 ** (peak_db / 20.0)) / p
    fi = int(fade_in / 1000 * SR)
    fo = min(int(fade_out / 1000 * SR), len(x) // 3)
    if fi > 1:
        x[:fi] *= np.linspace(0, 1, fi)
    if fo > 1:
        x[-fo:] *= np.linspace(1, 0, fo)
    return x


# 名称 → (源文件, 起, 止, 额外参数)
JOBS = {
    # ── fire：直射交火 ──
    'fire_a': ('22_Magnum.wav', 200, 780, dict(hp_hz=35)),
    'fire_b': ('22_Pistol.wav', 100, 1250, dict(hp_hz=35)),
    'fire_c': ('1674.mp3', 0, 200, dict()),
    'fire_d': ('Black_Powder.wav', 100, 1000, dict(hp_hz=35)),
    # ── shell：炮击 ──
    'shell_a': ('1696.mp3', 0, 2400, dict(hp_hz=25)),
    'shell_b': ('2786.mp3', 0, 3000, dict(hp_hz=25)),
    'shell_c': ('Black_Powder.wav', 100, 1200, dict(hp_hz=30)),
    # ── hit：命中 ──
    'hit_a': ('1670.mp3', 0, 420, dict()),
    'hit_b': ('1674.mp3', 0, 200, dict()),
    'hit_c': ('1694.mp3', 0, 400, dict()),
    # ── kill：歼灭 ──
    'kill_a': ('2784.mp3', 0, 2200, dict(hp_hz=25)),
    'kill_b': ('1696.mp3', 0, 3200, dict(hp_hz=25)),
    'kill_c': ('1693.mp3', 0, 1600, dict(hp_hz=25)),
    # ── alarm：敌方增援 ──
    'alarm_a': ('1679.mp3', 0, 1800, dict()),
    'alarm_b': ('1687.mp3', 0, 2000, dict(hp_hz=25)),
}

meta = []
for name, (src, s, e, kw) in JOBS.items():
    x = prep(src, s, e, **kw)
    p = os.path.join(O, name + '.wav')
    save(p, x)
    pk = np.max(np.abs(x))
    rms = np.sqrt(np.mean(x ** 2))
    meta.append((name, src, len(x) / SR * 1000, 20 * np.log10(pk), 20 * np.log10(pk / rms),
                 os.path.getsize(p) / 1024))
    print('%-9s %-18s %6.0fms  crest%5.1fdB  %6.1fKB' % (
        name, src, len(x) / SR * 1000, 20 * np.log10(pk / rms), os.path.getsize(p) / 1024))

print('\n总计 %.0f KB' % sum(m[5] for m in meta))
