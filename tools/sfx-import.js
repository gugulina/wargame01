#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   音效导入：把从素材站下载的原始音频塞进指定槽位。

   为什么要有这一步——素材站的原始文件和游戏里能用的文件差四件事：
     1. **头尾有静音**。混音台上听不出来，游戏里就是"点了按钮，0.3 秒后
        才响"。手感全靠这一段。
     2. **电平不齐**。有的站给 −3 dBFS 母带，有的给 −20，直接丢进去
        就是一发大炮一发在隔壁。这里统一到各槽自己的目标值。
     3. **太长**。一段 4 秒的炮击在回合制里会盖住下一回合的报点。
     4. **格式**。浏览器能放的容器有限，而且仓库里统一 ogg/mp3。

   用法：
     node tools/sfx-import.js rifle  ~/Downloads/kar98k.wav
     node tools/sfx-import.js track  ~/Downloads/tank_idle.mp3
     node tools/sfx-import.js shell  ~/Downloads/zis3.wav --at 3.01   ← 从第 3.01 秒起截
     node tools/sfx-import.js track  ~/Downloads/t26.wav --pick --low 5
     node tools/sfx-import.js --list          ← 看所有槽位的要求
     node tools/sfx-import.js fire x.wav --dry ← 只测量，不写盘不改编

   --at <秒>   从指定时刻开始截（长素材里有好几发，先定位再截）
   --pick      自动挑能量最集中的一段（不知道该截哪儿时用）
   --low <dB>  200 Hz 低频搁架增益。战场录音多是手机/摄像机收的，
               80–200 Hz 天然薄，履带和炮声不加这一段就是"敲纸箱"
   --dry       只测量，不写盘、不改 ASSETS

   导入后会**自动改 campaign.html 里 ASSETS 的那一行**，文件名按
   `<槽位>-take<N>.ogg` 递增——不留同名覆盖，否则浏览器拿缓存，
   本地听着"没变化"能查半天。

   解码走 tools/decode-f32.py（miniaudio）。**m4a/aac 不支持**，
   那类文件先用任意播放器转成 wav。
   ════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { createOggEncoder } = require('wasm-media-encoders');

const SR = 44100;
const ROOT = path.join(__dirname, '..');
const OUTDIR = path.join(ROOT, 'game/assets/sfx');
const ENGINE = path.join(ROOT, 'game/campaign.html');
const BUDGET_KB = 250;   // briefcheck [23] 守的就是这个数

/* ══════════ 槽位规格 ══════════
   mode/target 决定归一化口径，不能互换：
     peak —— 一次性音效（枪、炮、UI）。看峰值，因为它们在混音里要"顶出来"。
     rms  —— 循环底噪（引擎、履带）。看 RMS，峰值归一会让起振瞬间过冲。
   这正是记忆里那条"两套口径不可互换"的落点。 */
const SLOT = {
  /* ── 按兵种分派新增的四个 ── */
  rifle:  { mode: 'peak', target: -2.5,  maxDur: 1.20, kind: 'shot',
            want: '单发或短点射。要有膛音（200–1500 Hz 那一段），只有高频嘶声会像气枪' },
  step:   { mode: 'peak', target: -3.0,  maxDur: 0.45, kind: 'shot',
            want: '落地踩实，一步或两步。要鞋底/土，不要草地沙沙' },
  engine: { mode: 'rms',  target: -21.0, maxDur: 1.60, kind: 'loop',
            want: '轮式怠速或起步。连续、**没有节拍**——有节拍就听成履带了' },
  track:  { mode: 'rms',  target: -21.0, maxDur: 1.60, kind: 'loop',
            want: '履带。要比引擎多一层金属板撞击的**节拍**，这是两者唯一的区别' },
  prop:   { mode: 'rms',  target: -21.0, maxDur: 1.60, kind: 'loop',
            want: '螺旋桨。60–400 Hz 的桨叶拍频 + 2 kHz 以上的桨尖成分。' +
                  '现场收音常混进开关门与鸟叫，挑段时看包络有没有孤立尖峰' },
  ship:   { mode: 'rms',  target: -21.0, maxDur: 1.60, kind: 'loop',
            want: '舰体。40–120 Hz 推进轰鸣占主导，高频只剩水声嘶嘶。' +
                  '**不能有金属敲击节拍**——那是履带；只有浪没有低频就是"水在响船没动"' },

  /* ── 已有槽位，留着以便整库换素材 ── */
  fire:    { mode: 'peak', target: -3.0, maxDur: 1.00, kind: 'shot', want: '直射枪声' },
  shell:   { mode: 'peak', target: -3.0, maxDur: 2.60, kind: 'shot',
             want: '炮击。既要低频冲击也要 2 kHz 以上的爆裂，缺一样就是"闷响"或"拍手"' },
  hit:     { mode: 'peak', target: -3.0, maxDur: 0.50, kind: 'shot', want: '命中，短爆裂' },
  kill:    { mode: 'peak', target: -3.0, maxDur: 2.00, kind: 'shot', want: '歼灭，多点殉爆' },
  alarm:   { mode: 'peak', target: -3.0, maxDur: 3.00, kind: 'shot', want: '警报，能听出是警报不是发射' },
  move:    { mode: 'peak', target: -6.0, maxDur: 0.30, kind: 'shot', want: '通用机动，轻' },
  uiClick: { mode: 'peak', target: -6.0, maxDur: 0.20, kind: 'shot', want: '按钮' },
  select:  { mode: 'peak', target: -6.0, maxDur: 0.20, kind: 'shot', want: '选中兵牌' },
  build:   { mode: 'peak', target: -4.0, maxDur: 2.00, kind: 'shot', want: '构筑工事' },
  event:   { mode: 'peak', target: -4.0, maxDur: 2.00, kind: 'shot', want: '剧情提示' },
  win:     { mode: 'peak', target: -3.0, maxDur: 4.00, kind: 'shot', want: '胜利' },
  lose:    { mode: 'peak', target: -3.0, maxDur: 4.00, kind: 'shot', want: '失败' },
  amb:     { mode: 'rms',  target: -31.0, maxDur: 70.0, kind: 'loop', want: '战场底噪，60 秒循环' },
};

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const atSec = flag('at', null);          // 从第几秒开始切
const pick = argv.includes('--pick');    // 自动挑能量最集中的一段
const lowDb = parseFloat(flag('low', '0'));   // 低频搁架增益，dB
/* 低通截止。实录现场常常"亮"得不像机械声（泵机啸叫、反射嘶嘶），
   那是噪声不是音色，低通砍掉比抬低频更有效——抬低频只是把底下垫厚，
   尖的那层还在。0 = 不处理。 */
const lpHz = parseFloat(flag('lp', '0'));
/* 显式时长。"取前 2 秒"这种要求不能靠槽位上限（那是**最大**值，
   不是**目标**值）——不管上限多大都会一路带到底，把后面第二发也卷进来。 */
const durSec = flag('dur', null) === null ? null : parseFloat(flag('dur', null));
/* 叠层可以给多次，每一层是独立的 文件[@秒][:增益]。
   环境层要的是"好几门炮在不同距离上响"，一次 --also 只能塞一发，
   所以这里收全部出现，不是取第一个。 */
const alsoList = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--also' && argv[i + 1] && !argv[i + 1].startsWith('--')) alsoList.push(argv[i + 1]);
}

/* 带值的开关，它的下一个词是参数不是位置参数。
   不做这一步的话 `--at 3.0` 里的 3.0 会被当成槽位名。 */
const VALUED = new Set(['--at', '--low', '--also', '--dur', '--lp']);
const rest = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.has(argv[i - 1])));

/* "x.wav@2.05:0.55" → { file:'x.wav', sec:2.05, gain:0.55 }
   路径里也有冒号（C:/...），所以只认**结尾**的 :数字，中途的一概不动。 */
function parseAlso(s) {
  let file = s, gain = 1, sec = null;
  const mg = file.match(/:([0-9]*\.?[0-9]+)$/);
  if (mg) { gain = parseFloat(mg[1]); file = file.slice(0, mg.index); }
  const ma = file.match(/@([0-9]*\.?[0-9]+)$/);
  if (ma) { sec = parseFloat(ma[1]); file = file.slice(0, ma.index); }
  return { file, sec, gain };
}

if (!rest.length || argv.includes('--list') || argv.includes('-h')) {
  console.log('\n用法：node tools/sfx-import.js <槽位> <音频文件> [--dry]\n');
  const pad = (s, n) => { const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
    return String(s) + ' '.repeat(Math.max(0, n - w)); };
  console.log(pad('槽位', 11) + pad('口径', 7) + pad('目标', 9) + pad('上限', 8) + '要找什么样的声音');
  console.log('─'.repeat(96));
  for (const [k, v] of Object.entries(SLOT)) {
    console.log(pad(k, 11) + pad(v.mode === 'peak' ? '峰值' : 'RMS', 7) +
      pad(v.target.toFixed(1) + 'dB', 9) + pad(v.maxDur.toFixed(2) + 's', 8) + v.want);
  }
  console.log('\npeak 看峰值，rms 看能量均方——一次性音效和循环底噪不能混用同一套口径。');
  process.exit(rest.length ? 0 : 1);
}

const slot = rest[0];
const srcFile = rest[1];
const spec = SLOT[slot];
if (!spec) { console.error('没有这个槽位：' + slot + '（加 --list 看全部）'); process.exit(1); }
if (!srcFile || !fs.existsSync(srcFile)) { console.error('文件不存在：' + srcFile); process.exit(1); }

/* ══════════ 读数 ══════════ */
function stats(x) {
  let peak = 0, sum = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; sum += x[i] * x[i]; }
  const rms = Math.sqrt(sum / Math.max(1, x.length));
  return { peak, rms,
    peakDb: 20 * Math.log10(peak + 1e-12),
    rmsDb: 20 * Math.log10(rms + 1e-12),
    crest: 20 * Math.log10((peak + 1e-12) / (rms + 1e-12)) };
}

/* 掐掉头尾静音。门限取相对峰值的 −55 dB：再低会把房间底噪当内容留下，
   再高会把枪声的自然衰减尾巴切掉，听感变成"啪"一下就没了。 */
function trimSilence(x, lead = 0.003) {
  const st = stats(x);
  const thr = st.peak * Math.pow(10, -55 / 20);
  let a = 0, b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) <= thr) a++;
  while (b > a && Math.abs(x[b]) <= thr) b--;
  const pre = Math.round(lead * SR);
  const s = Math.max(0, a - pre), e = Math.min(x.length, b + pre + 1);
  return { x: x.subarray(s, e), cutHead: s / SR, cutTail: (x.length - e) / SR };
}

/* 收尾淡出：硬切会在结尾留一个阶跃，那就是"咔"一声。20 ms 够听不出，
   又不会像慢淡出那样把尾音抹平。 */
function fadeTail(x, ms) {
  const n = Math.min(x.length, Math.round(ms / 1000 * SR));
  for (let i = 0; i < n; i++) {
    x[x.length - 1 - i] *= 0.5 + 0.5 * Math.cos(Math.PI * i / n);
  }
}

/* 循环音的接缝：只有边缘振幅真的不为零时才补淡入淡出。
   引擎这种连续噪声，两端的样本值本来就随机，不补一定"啪"；
   但补 8 ms 在循环里听不出（相当于多一个包络凹陷）。 */
function fadeEdgesForLoop(x) {
  const st = stats(x);
  const lim = st.peak * Math.pow(10, -40 / 20);
  const head = Math.abs(x[0]) > lim, tail = Math.abs(x[x.length - 1]) > lim;
  if (head) { const n = Math.min(x.length, Math.round(0.008 * SR));
    for (let i = 0; i < n; i++) x[i] *= i / n; }
  if (tail) { const n = Math.min(x.length, Math.round(0.008 * SR));
    for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n; }
  return { head, tail };
}

function applyGain(x, g) { for (let i = 0; i < x.length; i++) x[i] *= g; }

/* 等长窗里能量最大的一段，返回起点样本号。
   用前缀和算，整段扫一遍 O(n)；逐窗重算是 O(n·L)，48 秒的要跑十几秒。 */
function loudestStart(x, L) {
  if (x.length <= L) return 0;
  const pre = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i] * x[i];
  let best = 0, bestE = -1;
  for (let s = 0; s + L <= x.length; s++) {
    const e = pre[s + L] - pre[s];
    if (e > bestE) { bestE = e; best = s; }
  }
  return best;
}

/* RBJ 低频搁架（low shelf）。这里必须用二阶：一阶搁架从 20 Hz 就慢慢爬，
   而我们要抬的正是 80–200 Hz 这一段，只有二阶才有那个"台阶"的形状。 */
function lowShelf(x, f0, gainDb, S = 0.9) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * f0 / SR, cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const sq = 2 * Math.sqrt(A) * alpha;
  const b0 = A * ((A + 1) - (A - 1) * cw + sq);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cw);
  const b2 = A * ((A + 1) - (A - 1) * cw - sq);
  const a0 = (A + 1) + (A - 1) * cw + sq;
  const a1 = -2 * ((A - 1) + (A + 1) * cw);
  const a2 = (A + 1) + (A - 1) * cw - sq;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
  }
}

/* RBJ 二阶低通。实录的"亮"有两种来源，要分开看：
     泵机啸叫 / 现场反射的嘶嘶   → 是噪声，低通可以砍
     引擎真正的谐波             → 在 200–800 Hz，砍过头就没声了
   所以截止点通常选在 1.2–1.5 kHz 之间，别一上来就 800。 */
function lowPass(x, f0, Q = 0.707) {
  const w0 = 2 * Math.PI * f0 / SR, cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * Q);
  const b0 = (1 - cw) / 2, b1 = 1 - cw, b2 = (1 - cw) / 2;
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
  }
}

function nextTake() {
  let n = 1;
  while (fs.existsSync(path.join(OUTDIR, `${slot}-take${n}.ogg`))) n++;
  return `${slot}-take${n}.ogg`;
}

/* ══════════ 解码 & 预处理 ══════════ */
function decodeF32(file) {
  const tmp = path.join(os.tmpdir(), `sfx-${process.pid}-${Math.floor(Math.random() * 1e6)}.f32`);
  let meta;
  try {
    const out = execFileSync('python', [path.join(__dirname, 'decode-f32.py'), file, tmp, String(SR)],
      { encoding: 'utf8' });
    meta = JSON.parse(out.trim().split('\n').pop());
  } catch (e) {
    console.error('解码失败：' + file + '\nminiaudio 不支持 m4a/aac，请先转成 wav。');
    console.error(String(e.stderr || e.message).split('\n').slice(0, 3).join('\n'));
    return null;
  }
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return { x: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), meta };
}

/* 处理**之后**的指标。原来 --dry 只能看到"切之前整段"的数字，于是
   "低频要抬几 dB 才够"这种问题永远要真导一次才知道——切窗、EQ、归一化
   每一样都改频谱，看处理前的数字定不了参。

   把裸流交给 python 的 --f32 分支，不重复解码。失败就返回 null，
   不因为量不出数就把整个导入拦下来。 */
function measureProcessed(x) {
  const tmp = path.join(os.tmpdir(), `sfx-m-${process.pid}-${Math.floor(Math.random() * 1e6)}.f32`);
  try {
    fs.writeFileSync(tmp, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
    const out = execFileSync('python',
      [path.join(__dirname, 'decode-f32.py'), '--f32', tmp, String(SR)], { encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop());
  } catch (e) {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* 临时文件删不掉不算错 */ }
  }
}


/* 把一条原始流处理成"能用的一段"：定位 → 掐静音 → 截上限 → 收尾淡出。
   抽成函数是因为 --also 要再走一遍同样的路，两处逻辑必须完全一致，
   否则主声音干净、叠进来的那条还带着 300 ms 静音头，一对齐就错位。 */
function prep(raw, atS, doPick, spec, durS = null) {
  const notes = [];
  let cut = raw;
  /* 长素材必须先定位：一段 48 秒的齐射里有十发，从第 0 秒切只会切到静场。
     --pick 自动找能量最集中的一段（等长窗内能量最大），--at 手动指定秒数。 */
  if (doPick) {
    const L = Math.round(spec.maxDur * SR);
    if (cut.length > L) {
      const st = loudestStart(cut, L);
      cut = cut.subarray(st);
      notes.push(`自动挑能量窗 @${(st / SR).toFixed(2)}s`);
    }
  } else if (atS !== null) {
    const st = Math.min(cut.length - 1, Math.round(atS * SR));
    cut = cut.subarray(st);
    notes.push(`从 ${atS}s 起`);
  }

  /* 时长限定放在掐静音**之前**：先按时间轴锁定"哪 2 秒"，
     再让 trimSilence 去掉真正的静场——顺序反了就会按掐完的长度算，
     时长随素材头部静音多少而漂移。 */
  if (durS !== null) {
    const L = Math.round(durS * SR);
    if (cut.length > L) { cut = cut.subarray(0, L); notes.push(`限定 ${durS}s`); }
  }

  const t = trimSilence(cut);
  let x = t.x;
  if (t.cutHead > 0.002) notes.push(`掐头静音 ${(t.cutHead * 1000).toFixed(0)}ms`);
  if (t.cutTail > 0.002) notes.push(`掐尾静音 ${(t.cutTail * 1000).toFixed(0)}ms`);

  if (x.length / SR > spec.maxDur) {
    const keep = Math.round(spec.maxDur * SR);
    x = x.subarray(0, keep).slice();     // slice() 拷贝，后面要就地改
    fadeTail(x, 60);
    notes.push(`截到 ${spec.maxDur}s（尾 60ms 淡出）`);
  } else {
    x = Float32Array.from(x);
  }
  fadeTail(x, 20);                        // 硬切会在结尾留阶跃，就是"咔"一声
  return { x, notes };
}

/* ══════════ 主流程 ══════════ */
(async () => {
  const d = decodeF32(srcFile);
  if (!d) process.exit(1);
  const raw = d.x, meta = d.meta;

  console.log(`\n源文件  ${path.basename(srcFile)}`);
  console.log(`  时长 ${meta.dur}s   峰值 ${meta.peak}dB`);
  /* 两套口径都印，但**判读看能量那行**。
     幅度口径（|X| 求和）衡量的是"频谱铺多宽"：高频有几百个 bin、每个都很低，
     加起来能压过几个高 bin，窄带低频因此被低估到失真的地步——
     同一段飞机录音，高频幅度 0.294、能量 0.011，差 27 倍。
     历史表格用的是幅度口径，所以两行都留着，别只留一行。 */
  console.log(`  能量 低 ${meta.lowE} / 中 ${meta.midE} / 高 ${meta.highE}   重心 ${meta.cenE}Hz  ← 判读看这行`);
  console.log(`  谱宽 低 ${meta.low} / 中 ${meta.mid} / 高 ${meta.high}   重心 ${meta.cen}Hz（幅度口径，只说铺多宽）`);
  console.log(`\n目标槽  ${slot}（${spec.kind === 'loop' ? '循环底噪' : '一次性'}，` +
    `${spec.mode === 'peak' ? '峰值' : 'RMS'} ${spec.target}dB，上限 ${spec.maxDur}s）`);
  console.log(`  要的声音：${spec.want}`);

  /* 处理链的每一步都要能对着原文说清为什么，出问题才知道拆哪一段 */
  const p = prep(raw, atSec, pick, spec, durSec);
  let x = p.x;
  const notes = p.notes;

  /* 叠层：两条不同射速的连发错开叠起来，才是"一个排在开火"。
     --also 文件[@秒][:增益]，两个文件在各自切点对齐到 t=0。 */
  if (alsoList.length) {
    let acc = x;
    for (const spec2 of alsoList) {
      const a2 = parseAlso(spec2);
      const d2 = decodeF32(a2.file);
      if (!d2) process.exit(1);
      /* 叠层不做 --at 定位，但**掐静音要留着**：掐掉头静音之后
         击发点正好落在 --also 指定的秒数上，这才是"第 6.4 秒开炮"。 */
      const p2 = prep(d2.x, null, false, spec);
      const off = Math.round((a2.sec || 0) * SR);
      const L = Math.max(acc.length, off + p2.x.length);
      const mix = new Float32Array(L);
      mix.set(acc);
      for (let i = 0; i < p2.x.length; i++) mix[off + i] += p2.x[i] * a2.gain;
      acc = mix;
      notes.push(`叠 ${path.basename(a2.file)}@${(a2.sec || 0)}s ×${a2.gain}`);
    }
    x = acc;
    if (x.length > Math.round(spec.maxDur * SR)) {
      x = x.subarray(0, Math.round(spec.maxDur * SR)).slice();
      fadeTail(x, 60);
    }
  }

  if (spec.kind === 'loop') {
    const f = fadeEdgesForLoop(x);
    if (f.head || f.tail) notes.push(`接缝补淡变（${[f.head && '头', f.tail && '尾'].filter(Boolean).join('/')}）`);
  }

  /* 低频搁架：战场录音多半是摄像机/手机麦克风，80–200 Hz 天然薄。
     履带和炮声没有这一段就"轻"，像在敲纸箱。放在归一化之前，
     否则归一化会把这个增益又抵消掉。 */
  if (lowDb) {
    lowShelf(x, 200, lowDb);
    notes.push(`${lowDb > 0 ? '+' : ''}${lowDb}dB 低频搁架 @200Hz`);
  }

  /* 低通放在搁架之后：先决定"底下垫多厚"，再决定"上面留多少"。
     反过来也能做，但两次都是线性的、顺序无关，所以按读起来顺的顺序写。 */
  if (lpHz) {
    lowPass(x, lpHz);
    notes.push(`低通 ${lpHz}Hz`);
  }

  const before = stats(x);
  const g = Math.pow(10, spec.target / 20) / (spec.mode === 'peak' ? before.peak : before.rms);
  applyGain(x, g);
  let after = stats(x);
  if (after.peak > 0.99) {              // RMS 口径下峰值可能顶出去
    const fix = 0.99 / after.peak;
    applyGain(x, fix);
    after = stats(x);
    notes.push(`峰值顶到 0dBFS，整体再让 ${(20 * Math.log10(fix)).toFixed(1)}dB`);
  }

  console.log(`\n处理   ${notes.length ? notes.join('；') : '原样（头尾本来就干净）'}`);
  console.log(`  增益 ${(20 * Math.log10(g)).toFixed(1)}dB  →  峰值 ${after.peakDb.toFixed(1)}dB  ` +
    `RMS ${after.rmsDb.toFixed(1)}dB  波峰因数 ${after.crest.toFixed(1)}dB  ${(x.length / SR).toFixed(2)}s`);

  /* 处理之后的频谱。定参只看这一行——上面"源文件"那两行是整段原素材，
     切窗、EQ、归一化都还没发生。 */
  const done = measureProcessed(x);
  if (done) {
    console.log(`  成品 能量 低 ${done.lowE} / 中 ${done.midE} / 高 ${done.highE}  ` +
      `重心 ${done.cenE}Hz  ← 定参看这行`);
  }

  /* 波峰因数低于 10 基本就是"压死了"——枪炮声该在 18 以上 */
  if (spec.kind === 'shot' && after.crest < 10) {
    console.log('  ⚠ 波峰因数只有 ' + after.crest.toFixed(1) + 'dB，这个素材可能被压过头，' +
      '或者本身就是长音——一次性音效要的是瞬态。');
  }

  if (dry) { console.log('\n--dry：没有写盘，也没有改编。'); return; }

  const name = nextTake();
  const enc = await createOggEncoder();
  enc.configure({ sampleRate: SR, channels: 2, vbrQuality: 0.62 });
  const bytes = Buffer.concat([
    Buffer.from(enc.encode([x, x])),     // 单声道复制成双声道，不占额外信息量
    Buffer.from(enc.finalize()),
  ]);
  fs.writeFileSync(path.join(OUTDIR, name), bytes);

  /* 改 ASSETS：锚点必须带 \b 和对槽位名后的冒号，
     否则 `hit` 会匹配到 `rifle-hit` 这类复合名字里。
     槽位不存在时**补一行**而不是报错退出——航空和海军迟早要各自的
     `prop` / `ship`，那时候是先没有槽位、后有素材。原来这里直接 exit(1)，
     等于逼人先手工加槽位再跑工具，操作顺序是反的。 */
  let html = fs.readFileSync(ENGINE, 'utf8');
  const re = new RegExp('(\\b' + slot + ":\\s*')(sfx/[^']+)(')");
  if (re.test(html)) {
    html = html.replace(re, (_, a, __, c) => a + 'sfx/' + name + c);
  } else {
    /* 锚点必须带 \r?——campaign.html 是 **CRLF**，只写 \n 会一条都匹配不上。
       这里踩过一次：插入逻辑静默失败、退回到"需要手工改"，看着像槽位名不对。
       凡是拿行尾当定界符的正则，都要先把 CRLF 想一遍。 */
    const anchor = /(  sfx: \{\r?\n)/;
    if (!anchor.test(html)) {
      console.error('\n写盘成功（' + name + '），但引擎里找不到 sfx 资产表，需要手工加 ' + slot + ': 一行。');
      process.exit(1);
    }
    html = html.replace(anchor, (m) => m + "    " + slot + ": '" + 'sfx/' + name + "',   // 新槽（由 sfx-import 补入）\r\n");
    console.log('  ASSETS 里原本没有 ' + slot + '，已在表头补一行');
  }
  fs.writeFileSync(ENGINE, html);

  /* 预算：briefcheck [23] 守 250 KB，超了会红。
     跳过名单按**槽位名**判，不按文件名判——底噪从 amb-synth.ogg 换成
     amb-take1.ogg 的那一次，按文件名写的跳过规则当场失效，预算凭空多出 450 KB。 */
  const NO_PRELOAD = new Set(['amb']);
  let tot = 0, cnt = 0;
  const seg = html.slice(html.indexOf('sfx: {'), html.indexOf('},', html.indexOf('sfx: {')));
  for (const m of seg.matchAll(/(\w+):\s*'sfx\/([^']+)'/g)) {
    if (NO_PRELOAD.has(m[1])) continue;
    const p = path.join(OUTDIR, m[2]);
    if (fs.existsSync(p)) { tot += fs.statSync(p).size; cnt++; }
  }
  const kb = Math.round(tot / 1024);

  console.log(`\n写入   game/assets/sfx/${name}  ${(bytes.length / 1024).toFixed(0)} KB`);
  console.log(`       ASSETS.${slot} → sfx/${name}`);
  console.log(`预算   首屏预载 ${cnt} 个槽 ${kb} KB / ${BUDGET_KB} KB` + (kb > BUDGET_KB ? '  ⚠ 超了' : ''));
  console.log('\n接着跑：npm test（会验素材存在、体积、试听页内嵌块）');

  /* 死文件提示：换了素材之后，合成的那版就没人引用了 */
  const dead = fs.readdirSync(OUTDIR)
    .filter(f => /\.(ogg|mp3|wav)$/.test(f) && !html.includes('sfx/' + f) && !f.startsWith('_'));
  if (dead.length) {
    console.log(`\n不再被引用（可以删）：${dead.join('  ')}`);
  }
})();
