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

/* ── 步兵火力：栓动步枪 + 冲锋枪 ──
   一个步兵营的齐射不是"一声枪响 ×N"。现场里三支步枪的射击点
   彼此错开 60–120 ms，中间夹着自动武器的短点射——这个**疏密不均**
   才是步兵交火；等间隔连响听起来像电子游戏，不像打仗。

   单发核沿用 sFire：那一版为了躲开 145 Hz 的"隔壁摔门"坑，
   已经把低频 body 压到 0.24、干路占到 35%，参数是踩过坑的。
   两型枪只在这三处不同：
     栓动   —— body 更重（.30）、尾更长（55 ms）、音高 158 Hz
     冲锋枪 —— body 更轻（.16）、尾更短（30 ms）、音高 176 Hz
   冲锋枪连点 32 ms 一发：低于 28 ms 会听成一长声，高于 40 ms
   又断成彼此独立的枪，32 ms 正好是"突突"那个区间。 */
function sRifle(seed) {
  const dur = 0.78, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = makeRng(seed);

  /* 一发。amp = 远近，pan = 偏哪边——
     六发全居中会听起来像同一个人开的同一条枪。 */
  function shot(t0, amp, pan, heavy) {
    const st = Math.round(t0 * SR);
    if (st >= n) return;
    const bpL = new Biquad().set('bp', 2300, 0.95);
    const bpR = new Biquad().set('bp', 2450, 0.95);
    /* 膛音层：500–1600 Hz 的空气冲击。少了这一层，枪声只剩"嘶"和"咚"，
       中间是空的——实测重心会飘到 5 kHz，听着像撕纸不像开枪。 */
    const mdL = new Biquad().set('bp', 650, 0.85);
    const mdR = new Biquad().set('bp', 710, 0.85);
    const dryL = new Biquad().set('hp', heavy ? 560 : 700, 0.7);
    const dryR = new Biquad().set('hp', heavy ? 560 : 700, 0.7);
    const lpL = new Biquad().set('lp', 8200, 0.7);
    const lpR = new Biquad().set('lp', 8200, 0.7);
    const gl = 0.5 - pan * 0.35, gr = 0.5 + pan * 0.35;
    const bodyF = heavy ? 158 : 176;
    const bodyAmp = heavy ? 0.20 : 0.11;
    const bodyTau = heavy ? 0.055 : 0.030;
    const len = Math.min(Math.round(0.11 * SR), n - st);
    let phL = 0, phR = 0, phmL = 0, phmR = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      /* 0.3 ms 起振 + 2.5 ms plateau：这段 hold 是"有份量"的全部来源，
         删掉它波峰因数会跳到 24 dB，数字很尖、听着很轻。 */
      const crack = envAHD(t, 0.0003, 0.0025, heavy ? 0.016 : 0.011);
      const body = envAHD(t, 0.0005, 0.006, bodyTau);
      const nzL = rng(), nzR = rng();
      const mid = mdL.p(nzL) * 1.10;
      let l = lpL.p(bpL.p(nzL) * 0.95 + dryL.p(nzL) * 0.28) * crack + mid * crack;
      let r = lpR.p(bpR.p(nzR) * 0.95 + dryR.p(nzR) * 0.28) * crack + mdR.p(nzR) * 1.10 * crack;
      phL += TAU * bodyF / SR;
      phR += TAU * bodyF * 1.007 / SR;
      l += Math.sin(phL) * body * bodyAmp;
      r += Math.sin(phR) * body * bodyAmp;
      /* 管腔共鸣：200–1500 Hz 那一段不是噪声，是枪管里的驻波。
         用带通噪声去补它，窄带的能量密度太低，怎么加都填不满
         （实测加到权重 2.3，中频也只从 0.15 爬到 0.19）。
         换成两根衰减正弦，能量集中在 520 / 780 Hz，一下就实了。 */
      phmL += TAU * 520 / SR;
      phmR += TAU * 520 * 1.009 / SR;
      const bore = envAHD(t, 0.0004, 0.003, 0.019) * (heavy ? 0.34 : 0.24);
      l += (Math.sin(phmL) + Math.sin(phmL * 1.5) * 0.45) * bore;
      r += (Math.sin(phmR) + Math.sin(phmR * 1.5) * 0.45) * bore;
      /* 先饱和再 pan：反过来的话两侧饱和程度不同，声像会随音量漂 */
      L[st + i] += sat(l, 1.7) * amp * gl * 2;
      R[st + i] += sat(r, 1.7) * amp * gr * 2;
    }
  }

  /* 时间表：三发栓动，中间夹三连点射。
     点射必须落在两发栓动之间，否则跟单发糊成一坨，
     听不出"这里有一挺冲锋枪"。 */
  shot(0.000, 1.00, -0.35, true);   // 栓动 1
  shot(0.082, 0.82,  0.22, true);   // 栓动 2
  shot(0.152, 0.56,  0.46, false);  // 冲锋枪 · 点射
  shot(0.184, 0.53,  0.32, false);
  shot(0.216, 0.50,  0.55, false);
  shot(0.298, 0.68, -0.12, true);   // 栓动 3

  addReverb(L, R, { size: 0.72, wet: 0.16, fb: 0.66 });
  return { L, R, dur, note: '步兵火力 · 3 发栓动 + 3 连点，疏密错开' };
}

/* ── 脚步：两步 ──
   一步得是三样东西叠起来，缺一样就不像人走路：
     踩实（96→62 Hz 下滑正弦，8 ms 起振）—— 体重
     摩擦（2.4–4 kHz 带通噪声，22 ms）—— 鞋底与地面
     磕碰（5 kHz 极短瞬态，只在第一步给）—— 水壶、枪带、装具
   两步间隔 135 ms（约 1.5 步/秒，负重行军的节奏）。
   左右脚换中心频率：完全同一声会被听成复制粘贴。
   这是全场触发最密的音效——一回合能走六七支部队，
   所以时长压在 0.38 秒，绝不拖尾。 */
function sStep(seed) {
  const dur = 0.38, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = makeRng(seed);

  function step(t0, amp, pan, f0, fric, clank) {
    const st = Math.round(t0 * SR);
    if (st >= n) return;
    const bpL = new Biquad().set('bp', fric, 1.1);
    const bpR = new Biquad().set('bp', fric * 1.06, 1.1);
    /* 中频"土"层：300–800 Hz 才是鞋底真正踩在土/碎石上的声音。
       只有 92 Hz 的沉闷 + 2.6 kHz 的沙沙，中间是空的，
       实测重心会飙到 3.8 kHz，听着像在沙纸上蹭鞋。 */
    const mdL = new Biquad().set('bp', 420, 0.9);
    const mdR = new Biquad().set('bp', 470, 0.9);
    const ckL = new Biquad().set('bp', 5200, 1.8);
    const ckR = new Biquad().set('bp', 5450, 1.8);
    const gl = 0.5 - pan * 0.4, gr = 0.5 + pan * 0.4;
    const len = Math.min(Math.round(0.17 * SR), n - st);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      /* 起振 2.5 ms 而不是 8 ms：脚落地是一记撞击，不是"渐强"。
         上一版给到 8 ms，测出来起振 8.3 ms，听着像脚在棉花上。 */
      const thud = envAHD(t, 0.0025, 0.010, 0.032);
      /* 落地瞬间频率高一截，脚掌压下去才沉下来——这个下滑是"体重"的来源 */
      const f = f0 * (1 + 0.5 * Math.exp(-t / 0.02));
      ph += TAU * f / SR;
      const nzL = rng(), nzR = rng();
      const fricE = envAHD(t, 0.005, 0.004, 0.014);
      const mdE = envAHD(t, 0.003, 0.006, 0.020);
      let l = Math.sin(ph) * thud * 1.00
            + bpL.p(nzL) * fricE * 0.18
            + mdL.p(nzL) * mdE * 0.75;
      let r = Math.sin(ph * 1.01) * thud * 1.00
            + bpR.p(nzR) * fricE * 0.18
            + mdR.p(nzR) * mdE * 0.75;
      if (clank) {
        const ce = envAHD(t, 0.002, 0.001, 0.009);
        l += ckL.p(nzL) * ce * 0.20;
        r += ckR.p(nzR) * ce * 0.20;
      }
      L[st + i] += l * amp * gl * 1.6;
      R[st + i] += r * amp * gr * 1.6;
    }
  }

  step(0.000, 1.00, -0.30,  92, 2600, true);
  step(0.135, 0.86,  0.28,  84, 3000, false);
  addReverb(L, R, { size: 0.34, wet: 0.10, fb: 0.55 });
  return { L, R, dur, note: '脚步 · 两步，踩实 + 摩擦 + 装具磕碰' };
}

/* ── 车辆引擎：轮式（摩托化 / 牵引炮兵） ──
   四个成分，少一个就不像发动机：
     点火基频（42→58 Hz 起步加速，锯齿）
     半频（21 Hz）—— 柴油机的"闷"全在这一层
     点火调制（按 4 缸点火频率 28 Hz 起伏，平稳的锯齿听着像风琴）
     机械噪声（1.2 kHz 带通，随转速爬升）
   **和履带的分野是节拍**：轮式是连续噪声，履带一下一下地撞。
   时长 1.05 秒、两端各留 0.1–0.3 秒渐变，是因为它是 RMS 定标，
   硬起硬停在持续音上会"啪"一下。 */
function sEngine(seed) {
  const dur = 1.05, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = makeRng(seed);
  const bpL = new Biquad().set('bp', 1200, 0.85);
  const bpR = new Biquad().set('bp', 1320, 0.85);
  const lpL = new Biquad().set('lp', 700, 0.7);
  const lpR = new Biquad().set('lp', 760, 0.7);
  let p1 = 0, p2 = 0, p3 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    /* 起音 0.05 秒：这是"移动了"的反馈音，不是真的在听发动机冷启动。
       上一版 ramp 给到 0.11 秒，实测峰值落在 298 ms，
       前 300 ms 只有 -34 dBFS——玩家点完移动，半秒后才听见动静。 */
    const e = (1 - Math.exp(-t / 0.03)) * Math.min(1, (dur - t) / 0.28);
    const f = 42 + 16 * (1 - Math.exp(-t / 0.35));
    p1 += f / SR; if (p1 >= 1) p1 -= 1;
    p2 += f * 0.5 / SR; if (p2 >= 1) p2 -= 1;
    p3 += f * 2 / SR; if (p3 >= 1) p3 -= 1;
    const saw = (p1 * 2 - 1) * 0.55 + (p2 * 2 - 1) * 0.30 + (p3 * 2 - 1) * 0.10;
    const fire = 0.55 + 0.45 * Math.sin(TAU * 28 * t);
    const nzL = rng(), nzR = rng();
    /* 机械噪声只留 0.05：上一版 0.16 把重心顶到 2.1 kHz，
       听着像吸尘器而不是柴油机。锯齿才是主体。 */
    const l = lpL.p(saw * fire) * 0.95 + bpL.p(nzL) * 0.05;
    const r = lpR.p(saw * fire * 1.01) * 0.95 + bpR.p(nzR) * 0.05;
    L[i] = sat(l * e, 1.5);
    R[i] = sat(r * e, 1.5);
  }
  addReverb(L, R, { size: 0.9, wet: 0.10, fb: 0.60 });
  return { L, R, dur, note: '轮式引擎 · 42→58Hz 起步，无金属节拍' };
}

/* ── 履带：坦克机动 ──
   履带板一块一块轧过诱导轮，每秒 42 下，每下是一记金属撞击。
   **这个节拍就是它和轮式的唯一分野**——去掉节拍，剩下的
   低频轰鸣跟 sEngine 几乎一样。三层：
     低频轰鸣（36→52 Hz 锯齿）
     履带板撞击（1.5 kHz 带通瞬态，衰减 12 ms）
     沙土摩擦（3 kHz 以上，低电平，一直在）
   撞击的包络不用逐次触发采样，而是拿 t×42 的小数部分做
   exp(-frac/0.16)：相位过整数就自然放一拍，代码里没有循环。 */
function sTrack(seed) {
  const dur = 1.15, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = makeRng(seed);
  const lpL = new Biquad().set('lp', 620, 0.72);
  const lpR = new Biquad().set('lp', 660, 0.72);
  const mtL = new Biquad().set('bp', 1500, 1.3);
  const mtR = new Biquad().set('bp', 1620, 1.3);
  const frL = new Biquad().set('hp', 3000, 0.7);
  const frR = new Biquad().set('hp', 3200, 0.7);
  let p = 0;
  const rate = 42;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    /* 同 engine：起音 0.05 秒。上一版 0.09 秒 + 节拍累积，
       峰值跑到 554 ms——玩家已经走到位了才听见履带。 */
    const e = (1 - Math.exp(-t / 0.03)) * Math.min(1, (dur - t) / 0.30);
    const f = 36 + 16 * (1 - Math.exp(-t / 0.40));
    p += f / SR; if (p >= 1) p -= 1;
    const rumble = (p * 2 - 1) * 0.8;
    const ph = t * rate;
    const frac = ph - Math.floor(ph);
    const hit = Math.exp(-frac / 0.11);
    const nzL = rng(), nzR = rng();
    /* 沙土摩擦只留 0.03：上一版 0.10 把重心推到 5.3 kHz、
       波峰因数压到 7.7 dB——听感是"一阵风声"，没有履带该有的重量。 */
    const l = lpL.p(rumble) * 0.88 + mtL.p(nzL) * hit * 0.42 + frL.p(nzL) * 0.03;
    const r = lpR.p(rumble * 1.01) * 0.88 + mtR.p(nzR) * hit * 0.42 + frR.p(nzR) * 0.03;
    L[i] = sat(l * e, 1.25);
    R[i] = sat(r * e, 1.25);
  }
  addReverb(L, R, { size: 1.0, wet: 0.12, fb: 0.64 });
  return { L, R, dur, note: '履带 · 42 次/秒金属节拍 + 低频轰鸣' };
}

/* ── 舰体推进：给实录水声垫一层低频 ──
   实录里能拿到的只有浪。61012 实测 2 kHz 以上占 0.55、20–120 Hz 只占 0.035，
   那是有"水"没有"船"：螺旋桨空化与主机的推力在浪声里根本不存在，
   也没法从浪里提出来，只能补一层。

   和 sEngine 的差别不只是频率低。**这一层是循环垫子，不能有起振也不能渐弱**，
   两端振幅必须一样，否则 loop 每次回头都"轰"一下。所以不写 e 包络，
   呼吸用一个**周期整除时长**的 LFO（1.6 秒正好一整个周期），接缝处相位连续。
   engine 那层反过来必须有起振——它是"点了一下移动"的反馈，不是背景。 */
function sHull(seed) {
  const dur = 1.6, n = Math.round(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = makeRng(seed);
  const lpL = new Biquad().set('lp', 320, 0.7);
  const lpR = new Biquad().set('lp', 340, 0.7);
  const spL = new Biquad().set('bp', 1100, 0.9);
  const spR = new Biquad().set('bp', 1200, 0.9);
  /* 出口再低通一次。sat 会把 45 Hz 的锯齿推出十几阶谐波，
     不挡的话重心落在 2.8 kHz —— 听感是"嗡嗡的电机"，不是"船在推水"。
     加了这道 220 Hz 之后 20–120 Hz 占比从 0.26 提到 0.6 上下。 */
  const outL = new Biquad().set('lp', 220, 0.72);
  const outR = new Biquad().set('lp', 235, 0.72);
  let p1 = 0, p2 = 0, p3 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    /* 45 Hz 基频：螺旋桨叶频就在 40–60 Hz 这一段，再低就成"地震"了 */
    const f = 45;
    p1 += f / SR; if (p1 >= 1) p1 -= 1;
    p2 += f * 2 / SR; if (p2 >= 1) p2 -= 1;
    p3 += f * 3 / SR; if (p3 >= 1) p3 -= 1;
    const saw = (p1 * 2 - 1) * 0.62 + (p2 * 2 - 1) * 0.24 + (p3 * 2 - 1) * 0.09;
    /* 1.6 秒一次的呼吸：不是节拍，是螺旋桨负荷随浪起伏 */
    const breathe = 1 + 0.10 * Math.sin(TAU * t / dur);
    const nzL = rng(), nzR = rng();
    /* 水声只垫 0.03、频段压到 1.1 kHz：它要和实录那层接得上，不能自己冒出来 */
    const l = lpL.p(saw * breathe) * 0.97 + spL.p(nzL) * 0.03;
    const r = lpR.p(saw * 1.004 * breathe) * 0.97 + spR.p(nzR) * 0.03;
    L[i] = outL.p(sat(l, 1.15));
    R[i] = outR.p(sat(r, 1.15));
  }
  return { L, R, dur, note: '舰体推进 · 45Hz 稳态，循环垫子（无起振）' };
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
  /* event 原来是 rms −18，结果峰值只到 −12、进游戏还要再乘 vol.sfx 0.65，
     输出峰值 −15.7——比全库其余音效低 10 dB，等于没有。
     它是**一次性提示音**，不是环境层，论"喊住玩家"该看峰值：
     import 那边同名槽的规格一直是 peak −4.0，两边口径对齐。 */
  event: { fn: sEvent, seed: 0x6E11, mode: 'peak', target: -4.0, out: 'event-synth' },
  alarm: { fn: sAlarm, seed: 0x3A77, mode: 'rms',  target: -15.5, out: 'alarm-synth' },
  move:  { fn: sMove,  seed: 0x1F45, mode: 'rms',  target: -21.0, out: 'move-synth'  },
  /* 以下四个是"按兵种分派"那一层要用的槽。
     定标口径按用途分：开枪是瞬态，看峰值；引擎/履带是持续音，看 RMS——
     RMS 定标会让引擎的实际响度落在枪声之下 10 dB 以上，这正是要的
     （它是背景动作，不该跟交火抢耳朵）。 */
  rifle: { fn: sRifle,  seed: 0x8B31, mode: 'peak', target: -2.5, out: 'rifle-synth'  },
  step:  { fn: sStep,   seed: 0x5C07, mode: 'peak', target: -7.0, out: 'step-synth'   },
  engine:{ fn: sEngine, seed: 0x2A9D, mode: 'rms',  target: -19.0, out: 'engine-synth' },
  track: { fn: sTrack,  seed: 0x6F53, mode: 'rms',  target: -19.5, out: 'track-synth'  },
  /* hull 不是独立音效，是**叠层**：实录只有浪，推进的低频得自己补。
     定标比主层低 1 dB——它是垫在下面的，叠的时候还要再乘 0.6 左右。 */
  hull:  { fn: sHull,   seed: 0x37C1, mode: 'rms',  target: -22.0, out: 'hull-synth'  },
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
