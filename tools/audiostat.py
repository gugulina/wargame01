import os, sys, json
import numpy as np
import miniaudio

D = sys.argv[1] if len(sys.argv) > 1 else 'game/_cand'

def load(path):
    d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.SIGNED16,
                              nchannels=1, sample_rate=48000)
    a = np.frombuffer(d.samples, dtype=np.int16).astype(np.float32) / 32768.0
    return a, d.sample_rate

def feats(a, sr):
    n = len(a)
    peak = float(np.max(np.abs(a)))
    if peak <= 0:
        return None
    rms = float(np.sqrt(np.mean(a * a)))
    crest = 20 * np.log10(peak / rms) if rms > 0 else 0

    # attack: 首个超过 5% 峰值 → 峰值
    idx = np.where(np.abs(a) > peak * 0.05)[0]
    start = int(idx[0]) if len(idx) else 0
    pk = int(np.argmax(np.abs(a)))
    attack_ms = (pk - start) / sr * 1000

    # 衰减到 -20dB(10%) 的时间
    below = np.where(np.abs(a[pk:]) < peak * 0.1)[0]
    decay_ms = (int(below[0]) / sr * 1000) if len(below) else (n - pk) / sr * 1000

    # 有效长度：最后超过 2% 峰值的点
    t = np.where(np.abs(a) > peak * 0.02)[0]
    eff_ms = (int(t[-1]) / sr * 1000) if len(t) else n / sr * 1000

    # 频谱特征（取峰值附近 200ms 窗口）
    w = a[max(0, pk - int(0.02 * sr)): pk + int(0.2 * sr)]
    if len(w) < 1024:
        w = a
    W = np.abs(np.fft.rfft(w * np.hanning(len(w))))
    f = np.fft.rfftfreq(len(w), 1 / sr)
    tot = W.sum() + 1e-12
    centroid = float((W * f).sum() / tot)
    low = float(W[f < 200].sum() / tot)
    mid = float(W[(f >= 200) & (f < 2000)].sum() / tot)
    high = float(W[f >= 2000].sum() / tot)
    # 谱平坦度：几何均值/算术均值，噪声接近 1，音调接近 0
    P = W ** 2 + 1e-12
    flat = float(np.exp(np.mean(np.log(P))) / np.mean(P))
    # 高频能量带宽占比：>6kHz
    vhigh = float(W[f >= 6000].sum() / tot)

    return dict(dur_ms=n / sr * 1000, peak_dbfs=20 * np.log10(peak), rms_dbfs=20 * np.log10(rms + 1e-12),
                crest=crest, attack_ms=attack_ms, decay_ms=decay_ms, eff_ms=eff_ms,
                centroid=centroid, low=low, mid=mid, high=high, vhigh=vhigh, flat=flat,
                clip_pct=float(np.mean(np.abs(a) >= 0.999) * 100))

rows = []
for fn in sorted(os.listdir(D)):
    if not fn.lower().endswith(('.mp3', '.ogg', '.wav', '.m4a', '.flac')):
        continue
    p = os.path.join(D, fn)
    try:
        a, sr = load(p)
        q = feats(a, sr)
        if q:
            q['file'] = fn
            q['kb'] = os.path.getsize(p) / 1024
            rows.append(q)
    except Exception as e:
        print('ERR', fn, str(e)[:60])

hdr = ['file', 'KB', 'ms', 'peak', 'crest', 'atk', 'dcy', 'eff', 'cent', 'low', 'mid', 'high', 'vhi', 'flat', 'clip']
print('%-16s %5s %6s %6s %6s %5s %6s %6s %6s %5s %5s %5s %5s %5s %5s' % tuple(hdr))
for r in sorted(rows, key=lambda x: -x['crest']):
    print('%-16s %5.0f %6.0f %6.1f %6.1f %5.1f %6.0f %6.0f %6.0f %5.2f %5.2f %5.2f %5.2f %5.3f %5.2f' % (
        r['file'], r['kb'], r['dur_ms'], r['peak_dbfs'], r['crest'], r['attack_ms'],
        r['decay_ms'], r['eff_ms'], r['centroid'], r['low'], r['mid'], r['high'],
        r['vhigh'], r['flat'], r['clip_pct']))

json.dump(rows, open(os.path.join(D, '_feat.json'), 'w'), indent=1)
