import os, sys, json
import numpy as np
import miniaudio
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

SR = 48000

def load(path):
    d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.SIGNED16,
                              nchannels=1, sample_rate=SR)
    a = np.frombuffer(d.samples, dtype=np.int16).astype(np.float32) / 32768.0
    return a

def envelope(a, win=64):
    """64 样本 ≈ 1.33ms 的滑动 RMS 包络"""
    n = len(a)
    k = n // win
    if k < 2:
        return np.abs(a), win
    e = np.sqrt(np.mean(a[:k * win].reshape(k, win) ** 2, axis=1) + 1e-12)
    return e, win

def stats(a):
    peak = float(np.max(np.abs(a)))
    if peak <= 0:
        return None
    e, win = envelope(a)
    ep = e.max()
    # 起振：包络首次到峰值 10%
    i10 = int(np.argmax(e >= ep * 0.1))
    i90 = int(np.argmax(e >= ep * 0.9))
    i99 = int(np.argmax(e >= ep * 0.99))
    t10 = i10 * win / SR * 1000
    rise = (i99 - i10) * win / SR * 1000       # 10% → 99% 起振耗时
    # 裁剪后起点（留 15ms 前导）
    cut = max(0, i10 * win - int(0.015 * SR))
    # 有效尾巴：最后一个 > 峰值 3% 的点
    idx = np.where(np.abs(a) > peak * 0.03)[0]
    tail = int(idx[-1]) / SR * 1000 if len(idx) else 0
    eff = tail - cut / SR * 1000

    seg = a[cut:int(idx[-1]) + 1] if len(idx) else a[cut:]
    if len(seg) < 1024:
        seg = a
    W = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    tot = W.sum() + 1e-12
    P = W ** 2 + 1e-12
    return dict(
        peak_dbfs=20 * np.log10(peak),
        crest=20 * np.log10(peak / (np.sqrt(np.mean(a * a)) + 1e-12)),
        t10=t10, rise=rise, cut_ms=cut / SR * 1000, eff_ms=eff,
        centroid=float((W * f).sum() / tot),
        low=float(W[f < 200].sum() / tot),
        mid=float(W[(f >= 200) & (f < 2000)].sum() / tot),
        high=float(W[f >= 2000].sum() / tot),
        vhigh=float(W[f >= 6000].sum() / tot),
        flat=float(np.exp(np.mean(np.log(P))) / np.mean(P)),
        clip=float(np.mean(np.abs(a) >= 0.999) * 100),
        _cut=cut,
    )

D = sys.argv[1]
outdir = os.path.join(D, '_viz')
os.makedirs(outdir, exist_ok=True)

files = [f for f in sorted(os.listdir(D)) if f.lower().endswith(('.mp3', '.ogg', '.wav'))]
rows = []
cache = {}
for fn in files:
    try:
        a = load(os.path.join(D, fn))
        s = stats(a)
        if s:
            s['file'] = fn
            s['kb'] = os.path.getsize(os.path.join(D, fn)) / 1024
            s['dur'] = len(a) / SR * 1000
            s['_a'] = a
            rows.append(s)
            cache[fn] = a
    except Exception as e:
        print('ERR', fn, str(e)[:50])

print('%-15s %5s %5s %5s %5s %5s %6s %5s %5s %5s %5s' %
      ('file', 'dur', 'eff', 'atk', 'rise', 'crest', 'cent', 'low', 'vhi', 'flat', 'clip'))
for r in sorted(rows, key=lambda x: x['rise']):
    print('%-15s %5.0f %5.0f %5.1f %5.1f %5.1f %6.0f %5.2f %5.2f %5.3f %5.2f' % (
        r['file'], r['dur'], r['eff_ms'], r['t10'], r['rise'], r['crest'],
        r['centroid'], r['low'], r['vhigh'], r['flat'], r['clip']))

json.dump([{k: (float(v) if isinstance(v, (np.floating, float)) else v)
            for k, v in r.items() if not k.startswith('_')} for r in rows],
          open(os.path.join(D, '_stat2.json'), 'w'), indent=1)

# ---- 画拼图 ----
def draw(names, tag, title):
    n = len(names)
    if n == 0:
        return
    fig, axes = plt.subplots(n, 2, figsize=(11, 1.55 * n), squeeze=False)
    for i, nm in enumerate(names):
        a = cache[nm]
        r = next(x for x in rows if x['file'] == nm)
        ax = axes[i][0]
        t = np.arange(len(a)) / SR
        ax.plot(t, a, lw=0.35, color='#c8a253')
        ax.set_xlim(0, min(len(a) / SR, 2.2))
        ax.set_yticks([])
        ax.set_title('%s  %.0fms  crest%.1f  rise%.1fms' % (nm, r['dur'], r['crest'], r['rise']),
                     fontsize=7.5, loc='left', pad=1)
        ax.tick_params(labelsize=6, length=2)
        ax.grid(alpha=.15, lw=.4)
        ax2 = axes[i][1]
        ax2.specgram(a, NFFT=512, Fs=SR, noverlap=384, cmap='inferno', vmin=-110, scale='dB')
        ax2.set_ylim(0, 8000)
        ax2.set_yticks([])
        ax2.tick_params(labelsize=6, length=2)
        ax2.set_title('spec', fontsize=6, loc='left', pad=1)
    plt.tight_layout(pad=0.35)
    p = os.path.join(outdir, tag + '.png')
    plt.savefig(p, dpi=110, facecolor='#141312')
    plt.close()
    print('wrote', p)

def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

# 只画短促、瞬态好的候选
short = [r for r in rows if 100 <= r['dur'] <= 2600 and r['crest'] > 17 and r['rise'] < 30]
short.sort(key=lambda x: x['rise'])
print('\n短促高动态候选 %d 个: %s' % (len(short), ' '.join(r['file'] for r in short)))
for i, part in enumerate(chunks([r['file'] for r in short], 8)):
    draw(part, 'short%d' % i, 'short')

# 长音（炮击/爆炸）
long = [r for r in rows if 900 <= r['dur'] <= 6000 and r['crest'] > 17 and r['low'] > 0.3]
long.sort(key=lambda x: -x['low'])
print('低频重候选 %d 个: %s' % (len(long), ' '.join(r['file'] for r in long)))
for i, part in enumerate(chunks([r['file'] for r in long], 8)):
    draw(part, 'low%d' % i, 'low')
