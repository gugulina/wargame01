#!/usr/bin/env python
"""把任意音频解成 44.1k 单声道 float32 裸流，顺便给出频谱指标。

为什么要单独一个 python 步骤：node 没有原生解码器，而 ffmpeg 不在这台机器上。
miniaudio 支持 wav / mp3 / flac / ogg-vorbis，够用；**m4a/aac 不支持**，
遇到会抛错，请先转成 wav。

输出两样东西：
  argv[2]  裸 float32 流（没有 wav 头），node 直接按 Float32Array 读，
           省掉一个 wav 解析器——少一处能写错的地方。
  stdout   一行 JSON：时长 / 峰值 / RMS / 三频段占比 / 重心，
           和 audiostat.py 的口径一致，导入前后能直接对比。
"""
import sys
import json
import numpy as np
import miniaudio

src, dst, sr = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = miniaudio.decode_file(
    src,
    output_format=miniaudio.SampleFormat.SIGNED16,
    nchannels=1,          # 短音效用单声道即可
    sample_rate=sr,
)
a = np.frombuffer(d.samples, dtype=np.int16).astype(np.float32) / 32768.0
a.tofile(dst)

peak = float(np.max(np.abs(a)) + 1e-12)
rms = float(np.sqrt(np.mean(a * a)) + 1e-12)
W = np.abs(np.fft.rfft(a * np.hanning(len(a))))
f = np.fft.rfftfreq(len(a), 1.0 / sr)
tot = float(W.sum()) + 1e-12
print(json.dumps({
    'n': int(len(a)),
    'dur': round(len(a) / sr, 3),
    'peak': round(float(20 * np.log10(peak)), 2),
    'rms': round(float(20 * np.log10(rms)), 2),
    'low': round(float(W[f < 200].sum() / tot), 3),
    'mid': round(float(W[(f >= 200) & (f < 2000)].sum() / tot), 3),
    'high': round(float(W[f >= 2000].sum() / tot), 3),
    'cen': round(float((W * f).sum() / tot), 0),
}))
