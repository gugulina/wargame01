#!/usr/bin/env python
"""把任意音频解成 44.1k 单声道 float32 裸流，顺便给出频谱指标。

为什么要单独一个 python 步骤：node 没有原生解码器，而 ffmpeg 不在这台机器上。
miniaudio 支持 wav / mp3 / flac / ogg-vorbis，够用；**m4a/aac 不支持**，
遇到会抛错，请先转成 wav。

两种用法：
  decode-f32.py <源音频> <输出裸流> <采样率>
      解码 + 落盘 + 打指标
  decode-f32.py --f32 <裸流> <采样率>
      只分析不落盘。导入工具拿它看**处理之后**的那一段——
      切窗、EQ、归一化都会改频谱，看处理前的数字定不了参。

stdout 一行 JSON：时长 / 峰值 / RMS / 三频段占比 / 重心。
"""
import sys
import json
import numpy as np
import miniaudio


def stats(a, sr):
    peak = float(np.max(np.abs(a)) + 1e-12)
    rms = float(np.sqrt(np.mean(a * a)) + 1e-12)
    W = np.abs(np.fft.rfft(a * np.hanning(len(a))))
    f = np.fft.rfftfreq(len(a), 1.0 / sr)
    tot = float(W.sum()) + 1e-12
    # 两个口径，别混用：
    #   幅度（low/mid/high）    = |X| 求和。衡量"频谱铺多宽"，历史表格用的就是这个。
    #   能量（lowE/midE/highE） = |X|² 求和。衡量"能量落在哪"，判断听感看这个。
    # 窄带低频（引擎、螺旋桨）在幅度口径下会被严重低估——高频有几百个 bin、
    # 每个都很低，加起来却压过几个高 bin。实测同一段飞机录音：
    # 高频 幅度 0.294 / 能量 0.011，差 27 倍。
    P = W ** 2
    tp = float(P.sum()) + 1e-12
    return {
        'n': int(len(a)),
        'dur': round(len(a) / sr, 3),
        'peak': round(float(20 * np.log10(peak)), 2),
        'rms': round(float(20 * np.log10(rms)), 2),
        'low': round(float(W[f < 200].sum() / tot), 3),
        'mid': round(float(W[(f >= 200) & (f < 2000)].sum() / tot), 3),
        'high': round(float(W[f >= 2000].sum() / tot), 3),
        'cen': round(float((W * f).sum() / tot), 0),
        'lowE': round(float(P[f < 200].sum() / tp), 3),
        'midE': round(float(P[(f >= 200) & (f < 2000)].sum() / tp), 3),
        'highE': round(float(P[f >= 2000].sum() / tp), 3),
        'cenE': round(float((P * f).sum() / tp), 0),
    }


if sys.argv[1] == '--f32':
    _sr = int(sys.argv[3])
    _a = np.fromfile(sys.argv[2], dtype=np.float32)
    print(json.dumps(stats(_a, _sr)))
else:
    src, dst, sr = sys.argv[1], sys.argv[2], int(sys.argv[3])
    d = miniaudio.decode_file(
        src,
        output_format=miniaudio.SampleFormat.SIGNED16,
        nchannels=1,          # 短音效用单声道即可
        sample_rate=sr,
    )
    a = np.frombuffer(d.samples, dtype=np.int16).astype(np.float32) / 32768.0
    a.tofile(dst)
    print(json.dumps(stats(a, sr)))
