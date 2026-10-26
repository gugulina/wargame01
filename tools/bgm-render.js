/* BGM 渲染器
   ------------------------------------------------------------------
   读 game/audio-lab/bgm-tracks.js 的事件谱，合成成音频，出 ogg 到
   game/assets/bgm/。

   为什么自己写合成而不在浏览器点五次：
     1. 五次导出意味着五次手改设置，迟早导错一首；
     2. 参数改了要能一条命令重来（`npm run bgm`）；
     3. 渲染是确定性的——噪声用固定种子的 PRNG，两次跑出来的字节一样，
        以后发现"这首怎么听着变了"时，能排除随机因素。

   用法：
     node tools/bgm-render.js                全部五首
     node tools/bgm-render.js battle tension 只渲指定曲目
     node tools/bgm-render.js --no-ogg       只出 wav（没装编码器时）
     node tools/bgm-render.js --keep-wav     保留 wav 中间产物

   ogg 编码依赖 wasm-media-encoders（devDependency，仅渲染用，游戏本体不需要）。
   ------------------------------------------------------------------ */

const fs = require('fs');
const path = require('path');

const SR = 44100;
const ROOT = path.resolve(__dirname, '..');
const TRACKS = require(path.join(ROOT, 'game/audio-lab/bgm-tracks.js'));
const OUTDIR = path.join(ROOT, 'game/assets/bgm');

const args = process.argv.slice(2);
const WANT_OGG = !args.includes('--no-ogg');
const KEEP_WAV = args.includes('--keep-wav');
const only = args.filter(a => !a.startsWith('--'));

/* ══════════ 混音电平 ══════════
   这套数字决定"谁在前面"。改之前在 demo 页听一遍，
   别只在波形上看——峰值看不出来谁挡着谁。 */
const MIX = {
  pulse: 0.30, piano: 0.26, cello: 0.17, pad: 0.14, bass: 0.24,
  snare: 0.24, timp: 0.30, air: 0.12, tick: 0.10, bell: 0.18
};

/* ══════════ 确定性噪声 ══════════ */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/* ══════════ 基础波形 ══════════ */
const TAU = Math.PI * 2;
const tri = p => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1;
const saw = p => 2 * (p - Math.floor(p + 0.5));

/* 一阶低通：Web Audio 的 BiquadFilter 在 Node 里没有，自己搭一个够用的 */
function lpCoeff(hz) { return 1 - Math.exp(-TAU * hz / SR); }
function hpCoeff(hz) { return Math.exp(-TAU * hz / SR); }

/* ══════════ 各乐器：写进 out[0](左) out[1](右) ══════════ */
function synthPulse(ev, L, R, start, rng) {
  const len = Math.floor(ev.dur * SR);
  const a = lpCoeff(420);
  let y = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = t < 0.006 ? t / 0.006 : Math.exp(-(t - 0.006) / 0.075);
    if (env < 0.0005) break;
    y += a * (tri(ev.f * t) - y);
    const v = y * env * ev.vel * MIX.pulse;
    L[start + i] += v; R[start + i] += v;
  }
}

function synthPiano(ev, L, R, start) {
  const len = Math.floor(Math.min(ev.dur, 4) * SR);
  const parts = [[1, 1.0], [2, 0.26], [3.01, 0.08]];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const att = t < 0.012 ? t / 0.012 : 1;
    const env = att * Math.exp(-t / 0.85);
    if (env < 0.0004) break;
    let s = 0;
    for (const [m, amp] of parts) s += Math.sin(TAU * ev.f * m * t) * amp;
    const v = s * env * ev.vel * MIX.piano * 0.42;
    L[start + i] += v; R[start + i] += v;
  }
}

/* 大提琴 / 低音提琴 / 弦乐垫共用：锯齿失谐 + 慢起音 + 长持续 */
function synthString(ev, L, R, start, opts) {
  const len = Math.floor(ev.dur * SR);
  const a = lpCoeff(opts.cut);
  const rel = Math.floor(Math.min(opts.release, ev.dur) * SR);
  const attack = Math.floor(opts.attack * SR);
  const det = opts.detune || 0;
  let yL = 0, yR = 0;
  const g = ev.vel * opts.mix;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let env = t < opts.attack ? t / opts.attack : 1;
    const toEnd = len - i;
    if (toEnd < rel) env *= toEnd / rel;
    if (env < 0.0005 && i > attack) break;
    const p1 = ev.f * t;
    const p2 = ev.f * (1 + det) * t;
    const sL = (saw(p1) + 0.7 * saw(p2)) * 0.5;
    const sR = (saw(p1 * (1.0012)) + 0.7 * saw(p1 * (1 + det))) * 0.5;
    yL += a * (sL - yL);
    yR += a * (sR - yR);
    L[start + i] += yL * env * g;
    R[start + i] += yR * env * g;
  }
}

function synthTimp(ev, L, R, start, rng) {
  const len = Math.floor(1.2 * SR);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = ev.f * (1.8 - 0.8 * Math.min(t / 0.09, 1));
    phase += f / SR;
    const env = t < 0.008 ? t / 0.008 : Math.exp(-(t - 0.008) / 0.30);
    if (env < 0.0005) break;
    const v = (Math.sin(TAU * phase) * env + rng() * Math.exp(-t / 0.02) * 0.5) * ev.vel * MIX.timp;
    L[start + i] += v; R[start + i] += v;
  }
}

/* 小军鼓：腔体（三角 225Hz）+ 响弦（噪声带通 2.4k），900Hz 高通去糊 */
function synthSnare(ev, L, R, start, rng) {
  const len = Math.floor(0.2 * SR);
  const vel = Math.min(ev.vel, 0.7);
  const a = lpCoeff(4200), h = hpCoeff(900);
  let y = 0, yh = 0, ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 225 - 57 * Math.min(t / 0.045, 1);
    ph += f / SR;
    const bodyEnv = t < 0.004 ? t / 0.004 : Math.exp(-(t - 0.004) / 0.045);
    const snareEnv = t < 0.003 ? t / 0.003 : Math.exp(-(t - 0.003) / 0.048);
    y += a * (rng() - y);
    yh += h * (y - yh);
    if (bodyEnv < 0.001 && snareEnv < 0.001) break;
    const v = (tri(ph) * bodyEnv * 0.55 + yh * snareEnv * 1.6) * vel * MIX.snare;
    L[start + i] += v; R[start + i] += v;
  }
}

function synthAir(ev, L, R, start) {
  const len = Math.floor(ev.dur * SR);
  const att = Math.floor(2.5 * SR);
  const rel = Math.floor(Math.min(1.6, ev.dur) * SR);
  const parts = [[1, 1.0], [1.0035, 0.8], [2.004, 0.35], [3.006, 0.14]];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let env = i < att ? i / att : 1;
    const toEnd = len - i;
    if (toEnd < rel) env *= toEnd / rel;
    if (env < 0.0006 && i > att) break;
    let sL = 0, sR = 0;
    for (const [m, amp] of parts) {
      sL += Math.sin(TAU * ev.f * m * t) * amp;
      sR += Math.sin(TAU * ev.f * m * 1.0016 * t) * amp;
    }
    const v = ev.vel * MIX.air * 0.30 * env;
    L[start + i] += sL * v;
    R[start + i] += sR * v;
  }
}

/* 秒表滴答：极短，高频噪声 + 一个 2.6k 的音，只在耳朵边上响一下 */
function synthTick(ev, L, R, start, rng) {
  const len = Math.floor(0.07 * SR);
  const h = hpCoeff(2200);
  let y = 0, ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.006);
    if (env < 0.002) break;
    y += h * (rng() - y);
    ph += 2600 / SR;
    const v = (y * 1.2 + Math.sin(TAU * ph) * 0.5) * env * ev.vel * MIX.tick;
    L[start + i] += v; R[start + i] += v;
  }
}

function synthBell(ev, L, R, start) {
  const len = Math.floor(Math.min(ev.dur, 5) * SR);
  const parts = [[1, 1.0], [2.76, 0.5], [5.4, 0.22], [8.93, 0.10]];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = t < 0.005 ? t / 0.005 : Math.exp(-t / 1.2);
    if (env < 0.0004) break;
    let s = 0;
    for (const [m, amp] of parts) s += Math.sin(TAU * ev.f * m * t) * amp;
    const v = s * env * ev.vel * MIX.bell * 0.35;
    L[start + i] += v; R[start + i] += v;
  }
}

const INSTR = {
  pulse:  (ev, L, R, s, rng) => synthPulse(ev, L, R, s, rng),
  piano:  (ev, L, R, s) => synthPiano(ev, L, R, s),
  cello:  (ev, L, R, s) => synthString(ev, L, R, s, { cut:620, attack:1.6, release:1.4, detune:0.0025, mix:MIX.cello * 1.5 }),
  bass:   (ev, L, R, s) => synthString(ev, L, R, s, { cut:340, attack:0.5, release:1.0, detune:0.0018, mix:MIX.bass * 1.6 }),
  pad:    (ev, L, R, s) => synthString(ev, L, R, s, { cut:900, attack:2.4, release:2.0, detune:0.004, mix:MIX.pad * 1.4 }),
  timp:   (ev, L, R, s, rng) => synthTimp(ev, L, R, s, rng),
  snare:  (ev, L, R, s, rng) => synthSnare(ev, L, R, s, rng),
  air:    (ev, L, R, s) => synthAir(ev, L, R, s),
  tick:   (ev, L, R, s, rng) => synthTick(ev, L, R, s, rng),
  bell:   (ev, L, R, s) => synthBell(ev, L, R, s)
};

/* ══════════ 环境层 ══════════ */
function synthAmb(track, L, R, total, rng) {
  const cfg = track.amb;
  if (!cfg) return;
  const conf = {
    room: { hi: 320, lo: 1400, wide: 0.15 },   // 房间：带通，像在室内
    dry:  { hi: 500, lo: 2600, wide: 0.05 },   // 干：更窄，窒息
    wide: { hi: 180, lo: 3400, wide: 0.45 }    // 宽：更开阔，用于结局
  }[cfg.type] || { hi: 320, lo: 1400, wide: 0.15 };

  const aL = lpCoeff(conf.lo), hL = hpCoeff(conf.hi);
  const aR = lpCoeff(conf.lo * 1.06), hR = hpCoeff(conf.hi * 0.94);
  let yL = 0, zL = 0, yR = 0, zR = 0;
  for (let i = 0; i < total; i++) {
    const nL = rng(), nR = rng();
    yL += aL * (nL - yL); zL += hL * (yL - zL);
    yR += aR * (nR - yR); zR += hR * (yR - zR);
    const fade = Math.min(1, i / (SR * 0.4));
    L[i] += zL * cfg.level * 0.16 * fade;
    R[i] += zR * cfg.level * 0.16 * fade;
  }
}

/* ══════════ 渲染一首 ══════════ */
function renderTrack(track) {
  const barLen = track.barLen;
  const body = track.bars * barLen;
  const tail = barLen * 1.5;              // 多渲一节，让最后一个音的尾巴收完
  const total = Math.ceil(SR * (body + tail));
  const L = new Float32Array(total);
  const R = new Float32Array(total);

  const rng = makeRng(0x9E3779B9 ^ track.id.length * 2654435761);

  synthAmb(track, L, R, total, rng);

  const events = track.events.slice().sort((a, b) => a.t - b.t);
  for (const ev of events) {
    const start = Math.round(ev.t * SR);
    if (start >= total) continue;
    const fn = INSTR[ev.inst];
    if (!fn) continue;
    fn(ev, L, R, start, rng);
  }

  /* ── 折叠尾巴：60 秒之后还在响的残音叠回开头 ──
     不做这一步，最后一个音的衰减被硬切，每圈接缝"啪"一声。 */
  const len = Math.round(SR * body);
  const outL = new Float32Array(len), outR = new Float32Array(len);
  outL.set(L.subarray(0, len));
  outR.set(R.subarray(0, len));
  const wrap = Math.min(total - len, len);
  for (let i = 0; i < wrap; i++) { outL[i] += L[len + i]; outR[i] += R[len + i]; }

  /* ── 响度：先按 RMS 归到 -20 dBFS，再用峰值兜底 ──
     游戏里 vol.bgm 固定 0.35 且没有设置面板，动态范围一大，安静段就听不见。 */
  let sum = 0;
  for (let i = 0; i < len; i++) sum += outL[i] * outL[i] + outR[i] * outR[i];
  const rms = Math.sqrt(sum / (len * 2));
  let gain = rms > 1e-6 ? 0.1 / rms : 1;

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(outL[i] * gain), Math.abs(outR[i] * gain));
  if (peak > 0.94) gain *= 0.94 / peak;

  for (let i = 0; i < len; i++) { outL[i] *= gain; outR[i] *= gain; }

  /* 归一化后重新量一遍再报 —— 报原始值会让人以为 battle（-26.5）比 tension（-18.9）
     轻一大截，其实两端都归到同一个响度了。 */
  let sumOut = 0, peakOut = 0;
  for (let i = 0; i < len; i++) {
    const a = outL[i], b = outR[i];
    sumOut += a * a + b * b;
    const am = Math.max(Math.abs(a), Math.abs(b));
    if (am > peakOut) peakOut = am;
  }
  const g2 = peakOut > 0.94 ? 0.94 / peakOut : 1;
  if (g2 !== 1) { for (let i = 0; i < len; i++) { outL[i] *= g2; outR[i] *= g2; } }

  return {
    L: outL, R: outR, seconds: body, len,
    rms: Math.sqrt(sumOut / (len * 2)) * g2,
    peak: peakOut * g2
  };
}

/* ══════════ 写 16bit WAV ══════════ */
function writeWav(file, L, R) {
  const n = L.length, ch = 2;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const arr of [L, R]) {
      const s = Math.max(-1, Math.min(1, arr[i]));
      buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), o);
      o += 2;
    }
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

/* ══════════ 编码 ogg ══════════ */
async function toOgg(L, R, quality) {
  const { createOggEncoder } = require('wasm-media-encoders');
  const enc = await createOggEncoder();
  enc.configure({ sampleRate: SR, channels: 2, vbrQuality: quality });
  const parts = [Buffer.from(enc.encode([L, R])), Buffer.from(enc.finalize())];
  return Buffer.concat(parts);
}

/* ══════════ 主流程 ══════════ */
(async () => {
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
  const ids = only.length ? only : Object.keys(TRACKS);
  console.log('渲染 ' + ids.length + ' 首 @ ' + SR + ' Hz\n');

  for (const id of ids) {
    const track = TRACKS[id];
    if (!track) { console.log('  跳过 ' + id + '（没有这首）'); continue; }
    const t0 = Date.now();
    const { L, R, seconds, len, rms, peak } = renderTrack(track);
    const wavPath = path.join(OUTDIR, id + '.wav');
    const wavBytes = writeWav(wavPath, L, R);

    let line = '  ' + id.padEnd(8) + seconds.toFixed(3) + 's  '
      + 'RMS ' + (20 * Math.log10(rms)).toFixed(1) + ' dBFS  '
      + '峰值 ' + peak.toFixed(2) + '  ';

    if (WANT_OGG) {
      try {
        const ogg = await toOgg(L, R, 0.9);
        fs.writeFileSync(path.join(OUTDIR, id + '.ogg'), ogg);
        line += 'ogg ' + (ogg.length / 1024).toFixed(0) + ' KB';
        if (!KEEP_WAV) fs.unlinkSync(wavPath);
      } catch (e) {
        line += 'wav ' + (wavBytes / 1048576).toFixed(1) + ' MB（ogg 失败：' + e.message.slice(0, 40) + '）';
      }
    } else {
      line += 'wav ' + (wavBytes / 1048576).toFixed(1) + ' MB';
    }
    console.log(line + '  ' + (Date.now() - t0) + 'ms');
  }
  console.log('\n输出目录: ' + OUTDIR);
})().catch(e => { console.error('渲染失败:', e); process.exit(1); });
