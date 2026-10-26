/* 音效合成器
   ------------------------------------------------------------------
   和 bgm-render.js 是同一套思路：确定性噪声 + 手写 DSP，一条命令出文件。
   但音效和音乐要的原语不一样，所以单独一个文件，不硬塞进 BGM 渲染器：

     音乐靠织体和和声，音效靠**瞬态**。决定一发炮响不响的，
     是起振那 3 毫秒的形状，其次才是音色。所以这里多了三样东西：
       · Biquad（一阶滤波器切不出 1.5–4 kHz 的枪声频段）
       · 饱和失真（tanh，爆炸的"爆"来自谐波，不是来自音量）
       · Schroeder 混响（没有混响的音效是贴脸的，不是"在空间里"的）

   用法：
     node tools/sfx-synth.js              全部
     node tools/sfx-synth.js amb shell    只做指定音效
     node tools/sfx-synth.js --keep-wav   保留 wav 中间产物

   产出文件名带 -synth 后缀，**不覆盖** assets/sfx 里现有的素材，
   方便 A/B 对照；听定之后改一行 ASSETS 才生效。
   ------------------------------------------------------------------ */

const fs = require('fs');
const path = require('path');

const SR = 44100;
const ROOT = path.resolve(__dirname, '..');
const OUTDIR = path.join(ROOT, 'game/assets/sfx');

const args = process.argv.slice(2);
const KEEP_WAV = args.includes('--keep-wav');
const NO_OGG = args.includes('--no-ogg');
const only = args.filter(a => !a.startsWith('--'));

/* ══════════ 确定性噪声 ══════════
   同 BGM：两次跑出来的字节一样，否则"这首怎么听着变了"永远查不清。 */
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

const TAU = Math.PI * 2;

/* ══════════ Biquad（RBJ cookbook） ══════════ */
class Biquad {
  constructor() { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set('lp', 1000, 0.707); }
  set(type, f0, Q = 0.707) {
    const w0 = TAU * Math.min(f0, SR * 0.45) / SR;
    const cs = Math.cos(w0), sn = Math.sin(w0);
    const alpha = sn / (2 * Q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else if (type === 'bp') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else { b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/* ══════════ 包络 ══════════
   线性起振 + 指数衰减。attack 是"硬度"的唯一来源：
   0.3 ms 是枪，3 ms 是爆，30 ms 是闷响。 */
const envAD = (t, atk, tau) => t < atk ? t / atk : Math.exp(-(t - atk) / tau);

/* 带 hold 的版本 —— 冲击类音效必须用这个。
   纯 envAD 在起振结束的瞬间就开始衰减，结果是波峰因数 24 dB：
   峰值很高、平均能量极低，听起来"啪一下但没份量"。
   真实的枪口冲击和爆炸都有一个 5–15 ms 的 plateau（空气还没散开），
   那一段才是"炸"的体感所在。 */
const envAHD = (t, atk, hold, tau) =>
  t < atk ? t / atk : (t < atk + hold ? 1 : Math.exp(-(t - atk - hold) / tau));

/* 饱和：tanh 的软拐点，drive 上去之后是"糊"而不是"破" */
const sat = (x, drive) => Math.tanh(x * drive) / Math.tanh(drive);

/* ══════════ Schroeder 混响 ══════════
   4 个并联 comb（带阻尼）+ 左右延迟错开 8 个样本，避免单声道化。
   为什么不用卷积：音效只有 0.2–3 秒，冲激响应要另做一份素材，
   反而是纯合成的场合最不需要引入第二个文件。 */
function addReverb(L, R, o) {
  const n = L.length;
  const size = o.size || 1, wet = o.wet == null ? 0.25 : o.wet;
  const fb = o.fb == null ? 0.78 : o.fb;
  const damp = o.damp == null ? 0.32 : o.damp;
  const dBase = [1116, 1188, 1277, 1356];
  const wetL = new Float32Array(n), wetR = new Float32Array(n);

  for (let k = 0; k < 4; k++) {
    const dL = Math.max(2, Math.round(dBase[k] * size));
    const dR = dL + 8;
    const bL = new Float32Array(dL), bR = new Float32Array(dR);
    let iL = 0, iR = 0, fL = 0, fR = 0;
    for (let i = 0; i < n; i++) {
      const yL = bL[iL], yR = bR[iR];
      fL = yL * (1 - damp) + fL * damp;
      fR = yR * (1 - damp) + fR * damp;
      bL[iL] = L[i] + fL * fb;
      bR[iR] = R[i] + fR * fb;
      wetL[i] += yL; wetR[i] += yR;
      if (++iL >= dL) iL = 0;
      if (++iR >= dR) iR = 0;
    }
  }
  for (let i = 0; i < n; i++) {
    L[i] += wetL[i] * wet * 0.25;
    R[i] += wetR[i] * wet * 0.25;
  }
}

/* ══════════ 各音效 ══════════ */

/* ── 炮击：三层叠加 ──
   1 爆裂（宽带噪声，2 ms 起振，40 ms 衰减）
   2 低频冲击（正弦 62→26 Hz 下滑，这才是"炮"而不是"拍手"的识别点）
   3 混响尾（场地反射）
   峰值靠 tanh 压住而不是靠归一化，因为爆裂层必须先削成方波才有"炸"。 */
function sShell(seed) {
  const dur = 2.40, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = makeRng(seed);

  const bpL = new Biquad().set('bp', 1500, 1.15);
  const bpR = new Biquad().set('bp', 1620, 1.15);
  const hpL = new Biquad().set('hp', 130, 0.7);
  const hpR = new Biquad().set('hp', 130, 0.7);

  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    /* 爆裂：带通那层给"脆"，旁路一小部分干噪声给"边缘"。
       全走带通会糊——biquad 的群延迟把 2 ms 的起振拖成 1 ms 以上。 */
    const e1 = envAHD(t, 0.0015, 0.010, 0.050);
    const nzL = rng(), nzR = rng();
    let l = (bpL.p(nzL) * 1.25 + nzL * 0.22) * e1;
    let r = (bpR.p(nzR) * 1.25 + nzR * 0.22) * e1;
    /* 超低频冲击：频率从 62 滑到 26，前 40 ms 完成。
       这一层是"重"，不是"响"——电平必须低于爆裂层，
       压过头就只剩闷雷，没人听得出是炮弹。 */
    const f = 26 + 36 * Math.exp(-t / 0.035);
    phase += TAU * f / SR;
    const e2 = envAHD(t, 0.001, 0.020, 0.16) * 0.62;
    l += Math.sin(phase) * e2;
    r += Math.sin(phase * 1.004) * e2;
    /* 谐波饱和：让爆裂层带方波边 */
    L[i] = sat(hpL.p(l), 2.4);
    R[i] = sat(hpR.p(r), 2.4);
  }
  addReverb(L, R, { size: 1.35, wet: 0.30, fb: 0.80 });
  return { L, R, dur, note: '炮击 · 电视纪录片的方向，不追求大' };
}

/* ── 枪响：单发步枪 ──
   上限 0.8 秒，一回合可能响 3–5 次，长了就是噪音墙。
   起振 0.3 ms 是硬指标——合成音做不到实弹的 0.2 ms，
   所以这一条注定不如现有的 .22 实弹录音，只在风格统一上有优势。 */
function sFire(seed) {
  const dur = 0.62, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = makeRng(seed);

  const bpL = new Biquad().set('bp', 2300, 0.95);
  const bpR = new Biquad().set('bp', 2450, 0.95);
  const dryL = new Biquad().set('hp', 620, 0.7);   // 干路要切低频，否则重心被拉下来
  const dryR = new Biquad().set('hp', 620, 0.7);
  const lpL = new Biquad().set('lp', 8200, 0.7);
  const lpR = new Biquad().set('lp', 8200, 0.7);

  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    /* 冲击：0.3 ms 起振 + 2.5 ms plateau。没有这段 plateau，
       波峰因数会到 22 dB——数字上"很尖"，听感上"很轻"。 */
    const crack = envAHD(t, 0.0003, 0.0025, 0.014);
    const body = envAHD(t, 0.0005, 0.006, 0.048);   // 膛压余响
    const nzL = rng(), nzR = rng();
    /* 干路占 35%：不带窄带滤波的瞬间，这才是"啪"的来源。
       全走带通的话，群延迟会让 0.3 ms 的起振变成 0.8 ms——
       测出来的数字好看不了，听起来也就成了"闷响"。 */
    let l = lpL.p(bpL.p(nzL) * 1.5 + dryL.p(nzL) * 0.62) * crack;
    let r = lpR.p(bpR.p(nzR) * 1.5 + dryR.p(nzR) * 0.62) * crack;
    /* 低频"身"：只加厚度，不抢重心。上一版这里给到 0.55，
       能量重心掉到 145 Hz，听起来像有人在隔壁摔门。 */
    ph += TAU * 155 / SR;
    l += Math.sin(ph) * body * 0.24;
    r += Math.sin(ph * 1.007) * body * 0.24;
    L[i] = sat(l, 1.7);
    R[i] = sat(r, 1.7);
  }
  addReverb(L, R, { size: 0.55, wet: 0.13, fb: 0.62 });
  return { L, R, dur, note: '直射 · 起振 0.3ms，实弹录音仍是这一项的天花板' };
}

/* ── 电报：战役事件 ──
   现有 event.ogg 是通用提示音，而"这份情报是电报来的"这个设定没人听见。
   编码的是 GT（General Telegram）的节律，不是随便点几下。 */
function sEvent(seed) {
  const dur = 0.54, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const bpL = new Biquad().set('bp', 900, 1.6);
  const bpR = new Biquad().set('bp', 940, 1.6);
  const hp = new Biquad().set('hp', 320, 0.8);

  /* 点 60ms / 划 180ms，间隔 60ms */
  const marks = [
    [0.00, 0.18, 1], [0.24, 0.06, 0], [0.36, 0.18, 1], [0.60, 0.06, 0], [0.72, 0.18, 1]
  ];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const [st, len, isDash] of marks) {
      if (t >= st && t < st + len) {
        const lt = t - st;
        const e = Math.min(1, lt / 0.004) * Math.min(1, (st + len - t) / 0.006);
        v += (Math.sin(TAU * 760 * t) > 0 ? 1 : -1) * 0.5 + Math.sin(TAU * 1520 * t) * 0.25;
        v *= e;
      }
    }
    const s = sat(hp.p(bpL.p(v)), 1.4);
    L[i] = s;
    R[i] = sat(hp.p(bpR.p(v)), 1.4);
  }
  addReverb(L, R, { size: 0.4, wet: 0.10, fb: 0.55 });
  return { L, R, dur, note: '事件 · 电报点划，替掉通用提示音' };
}

/* ── 警报：手摇防空警报器 ──
   现有 alarm-v2 是影视式电子警报。二战阵地用的是手摇/电动转轮，
   特征是**转速跟不上**——升调时音高上不去，回落时还会拖一点。 */
function sAlarm(seed) {
  const dur = 1.90, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);

  const bpL = new Biquad().set('bp', 1300, 0.8);
  const bpR = new Biquad().set('bp', 1380, 0.8);
  const lp = new Biquad().set('lp', 3800, 0.7);
  const hp = new Biquad().set('hp', 420, 0.7);

  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const cyc = 1.15;                          // 一个升降周期
    const p = (t % cyc) / cyc;                 // 0→1
    /* 转速曲线：升得快、到顶软、回落拖 —— 机械惯性 */
    const rise = Math.min(1, p / 0.42);
    const fall = p < 0.42 ? 0 : Math.min(1, (p - 0.42) / 0.58);
    const shape = rise * (1 - fall * 0.85);
    const f = 330 + 300 * Math.pow(shape, 1.35) + Math.sin(TAU * 5.5 * t) * 6;
    ph += TAU * f / SR;
    /* 转轮音色：锯齿 + 一点点二次谐波 */
    const saw = 2 * (ph / TAU - Math.floor(ph / TAU + 0.5));
    let v = saw * 0.55 + Math.sin(ph * 2) * 0.14;
    const fade = Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.10);
    v *= fade;
    L[i] = sat(hp.p(lp.p(bpL.p(v))), 1.7);
    R[i] = sat(hp.p(lp.p(bpR.p(v))), 1.7);
  }
  addReverb(L, R, { size: 1.6, wet: 0.26, fb: 0.82 });
  return { L, R, dur, note: '增援 · 手摇转轮，不是电子警报' };
}

/* ── 构筑工事：三锹土 + 一记夯 ──
   现有 build.ogg 是 Kenney 的通用音。工事音该有"铁锹入土"的摩擦感，
   关键在中频那段 600–1600 Hz 的砾石摩擦，而不是低频砸地。 */
function sBuild(seed) {
  const dur = 1.00, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = makeRng(seed);

  const hits = [[0.00, 0.9], [0.30, 0.75], [0.56, 0.85]];
  const bq = [];
  for (let k = 0; k < 3; k++) bq.push(new Biquad().set('bp', 900 + k * 220, 0.75));
  const hpL = new Biquad().set('hp', 180, 0.7);
  const hpR = new Biquad().set('hp', 180, 0.7);
  let ph = 0;

  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let l = 0, r = 0;
    hits.forEach(([st, amp], k) => {
      if (t < st) return;
      const lt = t - st;
      /* 砾石摩擦：稍长的衰减，才有"沙子落下去" */
      const e = envAD(lt, 0.004, 0.055) * amp;
      const nz = rng();
      l += bq[k].p(nz) * e;
      r += bq[k].p(nz * 0.92) * e;
    });
    /* 夯击：最后一下才有的低频 */
    if (t >= 0.56) {
      const lt = t - 0.56;
      const e = envAD(lt, 0.002, 0.05) * 0.55;
      ph += TAU * 96 / SR;
      l += Math.sin(ph) * e;
      r += Math.sin(ph * 1.01) * e;
    }
    L[i] = hpL.p(l) * 0.8;
    R[i] = hpR.p(r) * 0.8;
  }
  addReverb(L, R, { size: 0.7, wet: 0.16, fb: 0.66 });
  return { L, R, dur, note: '工事 · 铁锹入土，不是通用打击音' };
}

/* ── 移动：履带/拖行 ──
   上限 0.2 秒，轻，不能抢。现有 move.ogg 是"闷响"，
   而实际是**摩擦**——带颗粒的连续体，不是一次撞击。 */
function sMove(seed) {
  const dur = 0.18, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = makeRng(seed);

  const bpL = new Biquad().set('bp', 260, 0.8);
  const bpR = new Biquad().set('bp', 285, 0.8);
  const lp = new Biquad().set('lp', 900, 0.7);

  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = Math.min(1, t / 0.012) * Math.min(1, (dur - t) / 0.05);
    /* 颗粒：慢速随机调制，像履带板一节一节轧过去 */
    const grain = 0.6 + 0.4 * Math.sin(TAU * 46 * t + Math.sin(TAU * 7 * t) * 2);
    const nzL = rng(), nzR = rng();
    L[i] = lp.p(bpL.p(nzL * grain)) * e * 0.85;
    R[i] = lp.p(bpR.p(nzR * grain)) * e * 0.85;
  }
  return { L, R, dur, note: '移动 · 摩擦颗粒，轻' };
}

/* ── 战场底噪：唯一真缺的槽 ──
   60 秒无缝循环。四层：
     低频轰鸣（远处持续炮击的空气声，20–90 Hz）
     风（300–1200 Hz，慢速起伏）
     零星远处炮点（随机位置，低频 + 长混响）
     极稀的远枪声
   要防的不是"不好听"，是**听得出重复**：所有 LFO 周期取互质数，
   爆点位置由随机种子决定，60 秒内没有第二次一样的间隔。 */
function sAmb(seed) {
  const dur = 60.0, tail = 3.0;
  const total = Math.round((dur + tail) * SR);
  const L = new Float32Array(total), R = new Float32Array(total);
  const rng = makeRng(seed);

  const loL = new Biquad().set('lp', 92, 0.8);
  const loR = new Biquad().set('lp', 98, 0.8);
  const hiL = new Biquad().set('bp', 620, 0.6);
  const hiR = new Biquad().set('bp', 680, 0.6);

  for (let i = 0; i < total; i++) {
    const t = i / SR;
    /* 低频轰鸣：7 / 11 / 13 秒三个互质周期叠加，60 秒内不重复相位组合 */
    const m1 = 0.55 + 0.45 * Math.sin(TAU * t / 7.3);
    const m2 = 0.5 + 0.5 * Math.sin(TAU * t / 11.7 + 1.1);
    const m3 = 0.6 + 0.4 * Math.sin(TAU * t / 13.9 + 2.3);
    const dr = (m1 * 0.5 + m2 * 0.3 + m3 * 0.2);
    const nL = rng(), nR = rng();
    L[i] = loL.p(nL) * 0.55 * dr * 3.0;
    R[i] = loR.p(nR) * 0.55 * dr * 3.0;
    /* 风：慢起伏 */
    const w = 0.5 + 0.5 * Math.sin(TAU * t / 17.3 + 0.7);
    L[i] += hiL.p(nL) * 0.10 * w;
    R[i] += hiR.p(nR) * 0.10 * w;
  }

  /* 远处炮点：60 秒约 14 次，间隔随机 2.5–7 秒 */
  let t = 1.2;
  while (t < dur - 1) {
    const st = Math.round(t * SR);
    const amp = 0.30 + 0.45 * Math.abs(rng());
    const f = 44 + 18 * Math.abs(rng());
    const tl = Math.round(2.2 * SR);
    const pan = rng();
    let ph = 0;
    for (let i = 0; i < tl && st + i < total; i++) {
      const lt = i / SR;
      const e = envAD(lt, 0.02, 0.42) * amp;
      ph += TAU * (f * (1 + 0.4 * Math.exp(-lt / 0.2))) / SR;
      const v = Math.sin(ph) * e;
      const gl = 0.5 - pan * 0.3, gr = 0.5 + pan * 0.3;
      L[st + i] += v * gl;
      R[st + i] += v * gr;
    }
    t += 2.5 + Math.abs(rng()) * 4.5;
  }

  /* 远枪声：更稀，5 发左右，极短 */
  let t2 = 3.5;
  while (t2 < dur - 1) {
    const st = Math.round(t2 * SR);
    const tl = Math.round(0.35 * SR);
    const amp = 0.10 + 0.12 * Math.abs(rng());
    const bp = new Biquad().set('bp', 1400 + rng() * 600, 1.2);
    for (let i = 0; i < tl && st + i < total; i++) {
      const lt = i / SR;
      const e = envAD(lt, 0.004, 0.05) * amp;
      const v = bp.p(rng()) * e;
      L[st + i] += v * 0.8;
      R[st + i] += v * 1.0;
    }
    t2 += 8 + Math.abs(rng()) * 9;
  }

  addReverb(L, R, { size: 2.2, wet: 0.22, fb: 0.86, damp: 0.25 });

  /* 尾巴折叠回开头：和 BGM 同一套做法。
     不做这一步，最后一个炮点的衰减被硬切，每圈"啪"一声。 */
  const len = Math.round(dur * SR);
  const outL = new Float32Array(len), outR = new Float32Array(len);
  outL.set(L.subarray(0, len));
  outR.set(R.subarray(0, len));
  const wrap = Math.min(total - len, len);
  for (let i = 0; i < wrap; i++) { outL[i] += L[len + i]; outR[i] += R[len + i]; }

  /* 首尾 0.5 秒互补交叉淡化：底噪没有"小节"概念，
     靠折叠之外再加一层，保证接缝处能量连续。 */
  const xf = Math.round(0.5 * SR);
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    outL[i] = outL[i] * k + outL[len - xf + i] * (1 - k);
    outR[i] = outR[i] * k + outR[len - xf + i] * (1 - k);
  }

  return { L: outL, R: outR, dur, note: '战场底噪 · 60 秒循环，四层互质周期' };
}

/* ══════════ 软限幅 ══════════
   拐点以下不动，以上用 tanh 渐进到 ceiling。
   为什么需要它：爆炸和枪响的 crest factor 有 16–20 dB，按 RMS 归一
   必然峰值爆表；而"压低增益让峰值合规"等于把炮声改小——这是两件不同的事。
   限幅保住了平均能量，只削掉几个过冲样本。 */
function softClip(x, knee, ceil) {
  const a = Math.abs(x);
  if (a <= knee) return x;
  const t = (a - knee) / (1 - knee);
  const y = knee + (ceil - knee) * Math.tanh(t * 1.6) / Math.tanh(1.6);
  return x < 0 ? -y : y;
}

/* ══════════ 电平 ══════════
   每个音效"该有多响"是相对的，不是都归一到同一个数字。
   关键分歧：**爆炸/枪声的响度感来自峰值，持续音的响度感来自 RMS。**
   对枪响按 RMS 定标，会得到一发声"不够响但峰值顶格"的东西——
   因为那 20 dB 的瞬间落差被平均掉了。

   引擎侧 vol.sfx = 0.65 / vol.bgm = 0.35。底噪和 BGM 都常驻，
   所以底噪的实际电平要按 vol 差异换算后再比 BGM 低一截：
     BGM  有效 ≈ -20.0 + 20log10(0.35) = -29.1 dBFS
     amb  有效 ≈ -31.0 + 20log10(0.65) = -34.7 dBFS  → 比 BGM 低 5.6 dB
   底噪是垫层，不该跟音乐抢；差太少会在两者之间打架，听久了发闷。 */
const SPEC = {
  /* mode:'peak' 目标峰值 dBFS / mode:'rms' 目标 RMS dBFS */
  shell: { fn: sShell, seed: 0x51A3, mode: 'peak', target: -1.0, out: 'shell-synth' },
  fire:  { fn: sFire,  seed: 0x7C21, mode: 'peak', target: -3.0, out: 'fire-synth'  },
  build: { fn: sBuild, seed: 0x2D99, mode: 'rms',  target: -17.0, out: 'build-synth' },
  event: { fn: sEvent, seed: 0x6E11, mode: 'rms',  target: -18.0, out: 'event-synth' },
  alarm: { fn: sAlarm, seed: 0x3A77, mode: 'rms',  target: -15.5, out: 'alarm-synth' },
  move:  { fn: sMove,  seed: 0x1F45, mode: 'rms',  target: -21.0, out: 'move-synth'  },
  amb:   { fn: sAmb,   seed: 0x4B73, mode: 'rms',  target: -31.0, out: 'amb-synth'  }
};

/* ══════════ 归一化 ══════════ */
function normalize(L, R, target, mode) {
  const n = L.length;
  let sum = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    sum += L[i] * L[i] + R[i] * R[i];
    const am = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (am > peak) peak = am;
  }
  const rms = Math.sqrt(sum / (n * 2));
  if (rms < 1e-9) return { rms: 0, peak, gain: 1 };

  const want = Math.pow(10, target / 20);
  const gain = mode === 'peak' ? want / peak : want / rms;

  for (let i = 0; i < n; i++) {
    L[i] = softClip(L[i] * gain, 0.72, 0.945);
    R[i] = softClip(R[i] * gain, 0.72, 0.945);
  }

  let s2 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    s2 += L[i] * L[i] + R[i] * R[i];
    const am = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (am > p2) p2 = am;
  }
  return { rms: Math.sqrt(s2 / (n * 2)), peak: p2, gain, mode };
}

/* ══════════ 写 WAV ══════════ */
function writeWav(file, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 4, 40);
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

async function toOgg(L, R, quality) {
  const { createOggEncoder } = require('wasm-media-encoders');
  const enc = await createOggEncoder();
  enc.configure({ sampleRate: SR, channels: 2, vbrQuality: quality });
  return Buffer.concat([Buffer.from(enc.encode([L, R])), Buffer.from(enc.finalize())]);
}

/* ══════════ 主流程 ══════════ */
(async () => {
  const ids = only.length ? only : Object.keys(SPEC);
  console.log('合成 ' + ids.length + ' 个音效 @ ' + SR + ' Hz\n');
  const rows = [];

  for (const id of ids) {
    const spec = SPEC[id];
    if (!spec) { console.log('  ? 没有这个音效：' + id); continue; }
    const r = spec.fn(spec.seed);
    const norm = normalize(r.L, r.R, spec.target, spec.mode);

    const wavPath = path.join(OUTDIR, spec.out + '.wav');
    const oggPath = path.join(OUTDIR, spec.out + '.ogg');
    writeWav(wavPath, r.L, r.R);

    let bytes = 0, ext = '.wav';
    if (!NO_OGG) {
      bytes = (await toOgg(r.L, r.R, 0.62)).length;
      fs.writeFileSync(oggPath, await toOgg(r.L, r.R, 0.62));
      ext = '.ogg';
      if (!KEEP_WAV) fs.unlinkSync(wavPath);
    } else {
      bytes = fs.statSync(wavPath).size;
    }

    rows.push({
      id, dur: r.dur, rms: norm.rms, peak: norm.peak, bytes, ext,
      note: r.note, mode: spec.mode, target: spec.target,
      driven: norm.gain
    });
  }

  console.log('音效     时长    定位         实到RMS  实到峰值  体积    说明');
  console.log('─'.repeat(98));
  for (const r of rows) {
    const tag = (r.mode === 'peak' ? '峰值 ' : 'RMS ') + r.target.toFixed(1);
    console.log(
      r.id.padEnd(6),
      r.dur.toFixed(2).padStart(6) + 's',
      tag.padStart(10),
      (20 * Math.log10(r.rms)).toFixed(1).padStart(7) + 'dB',
      (20 * Math.log10(r.peak)).toFixed(1).padStart(7) + 'dB',
      ((r.bytes / 1024).toFixed(0) + 'KB').padStart(8),
      r.note
    );
  }
  console.log('─'.repeat(98));
  console.log('峰值型（爆炸/枪响）按峰值定标、RMS 型（持续音）按 RMS 定标；');
  console.log('两者不可互换 —— 见上面 softClip 处的注释。');
})();
