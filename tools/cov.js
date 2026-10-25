/* 覆盖率报告：哪一块代码从来没被执行过。
   用法：
     node tools/cov.js                 跑 selftest + briefcheck，打印报告
     node tools/cov.js --min=85        低于 85% 时退出码 1（CI 用）
     node tools/cov.js --top=40        最多列 40 个没执行的函数
     node tools/cov.js --only=brief    只跑某一支（selftest / brief / level / check）

   为什么要这个工具：v4.6 体检时"588 项断言"听着很扎实，但 NODE_V8_COVERAGE
   量出来 413 个函数块里有 119 个一次都没跑——`runAI`（整个敌方 AI）、
   `judgeFinal`、`_showCutin`、`renderHQ`（唯一的存档出入口）全在盲区里。
   断言数量不等于覆盖面，没有工具就只能靠猜。

   两个必须记住的坑：
   ① V8 覆盖里的 url 带 query（…campaign.html?lv=T1&nointro=1），
      用 endsWith('campaign.html') 过滤会一条都匹配不上，看起来像"0 覆盖率"。
      过滤要用 includes。
   ② 临时目录不能用 /tmp —— 这台机器上 Git Bash 会把它解析成 C:\tmp，
      node 侧写不进去。用项目内的 _cov（.gitignore 的 `_*` 已经盖住）。 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'game', 'campaign.html');
const COV_DIR = path.join(ROOT, '_cov');

const argv = process.argv.slice(2);
function arg(name, def) {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}
const MIN = arg('min', null) === null ? null : Number(arg('min'));
const TOP = Number(arg('top', '20'));
const ONLY = arg('only', null);

/* 每支工具跑什么、要不要 NODE_PATH（jsdom）都在这里 */
const SUITES = [
  { key: 'selftest', name: 'selftest（机制回归）', cmd: ['tools/selftest.js'] },
  { key: 'brief', name: 'briefcheck（真实 DOM）', cmd: ['tools/briefcheck.js'], jsdom: true },
  { key: 'level', name: 'levelcheck（解锁链）', cmd: ['tools/levelcheck.js'], jsdom: true }
];

function runSuite(s) {
  const env = { ...process.env, NODE_V8_COVERAGE: COV_DIR };
  if (s.jsdom && !env.NODE_PATH) {
    /* jsdom 装在项目 node_modules 里。npm test 里是靠外面设 NODE_PATH，
       这里兜一下，免得"能跑测试、覆盖率工具却 import 不到 jsdom"。 */
    env.NODE_PATH = path.join(ROOT, 'node_modules');
  }
  const r = cp.spawnSync(process.execPath, s.cmd, {
    cwd: ROOT, encoding: 'utf8', env, timeout: 300000
  });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

function readCoverage() {
  if (!fs.existsSync(COV_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(COV_DIR)) {
    if (!f.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(COV_DIR, f), 'utf8')); }
    catch (e) { continue; }
    out.push(j);
  }
  return out;
}

/* 把多支工具的结果并起来：同一个函数在两支里都跑过，取大的那个 count。
   只看 ranges[0]（整个函数体）——嵌套函数的字节会被重复计入，
   所以这个百分比只能横向比（改前 vs 改后），不能当"物理真值"看。

   坑③：**同一个 url 下有两个 <script> 块**（<head> 里的兜底脚本 + 引擎本体），
   各自有自己的 offset 空间。不加区分地合起来，函数数会翻倍、行号全错、
   覆盖率被那 30 行没跑过的兜底代码拉低十几点。区分不了脚本 id，
   就用 functions.length 分组——引擎四百多个函数，兜底三个，差得很开。 */
function collect(reports) {
  const groups = new Map();        // functions.length -> [script…]
  for (const rep of reports) {
    for (const s of rep.result || []) {
      /* 坑①：url 带 query，必须用 includes */
      if (!String(s.url || '').includes('campaign.html')) continue;
      const k = (s.functions || []).length;
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
  }
  if (!groups.size) return { script: null, fnCount: 0, deadCount: 0, bytes: 0, covered: 0, pct: 0, dead: [] };
  let bestKey = 0;
  for (const k of groups.keys()) if (k > bestKey) bestKey = k;

  const byFn = new Map();
  for (const s of groups.get(bestKey)) {
    for (const fn of s.functions || []) {
      const r0 = fn.ranges && fn.ranges[0];
      if (!r0) continue;
      const key = fn.functionName + '@' + r0.startOffset;
      const prev = byFn.get(key);
      if (!prev || r0.count > prev.count) {
        byFn.set(key, {
          name: fn.functionName || '(匿名)',
          start: r0.startOffset,
          end: r0.endOffset,
          count: r0.count || 0
        });
      }
    }
  }
  const fns = [...byFn.values()];
  let bytes = 0, covered = 0;
  const dead = [];
  for (const f of fns) {
    const len = Math.max(0, f.end - f.start);
    bytes += len;
    if (f.count > 0) covered += len;
    else dead.push(f);
  }
  return {
    script: groups.get(bestKey)[0],
    fnCount: fns.length,
    deadCount: dead.length,
    bytes,
    covered,
    pct: bytes ? (covered / bytes * 100) : 0,
    dead: dead.sort((a, b) => a.start - b.start)
  };
}

function lineOf(src, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

(function main() {
  const suites = ONLY ? SUITES.filter(s => s.key === ONLY) : SUITES;
  if (!suites.length) {
    console.error('未知的 --only=' + ONLY + '，可选：' + SUITES.map(s => s.key).join(' / '));
    process.exit(1);
  }
  fs.rmSync(COV_DIR, { recursive: true, force: true });
  fs.mkdirSync(COV_DIR, { recursive: true });

  let allOk = true;
  suites.forEach((s, i) => {
    process.stdout.write('[' + (i + 1) + '/' + suites.length + '] ' + s.name + ' ... ');
    const r = runSuite(s);
    console.log(r.ok ? 'ok' : '失败（覆盖数据仍会统计，但这次结果不可信）');
    if (!r.ok) {
      allOk = false;
      console.log(r.out.split('\n').filter(l => l.trim().startsWith('✗')).slice(0, 5)
        .map(l => '    ' + l.trim()).join('\n'));
    }
  });

  const stat = collect(readCoverage());
  fs.rmSync(COV_DIR, { recursive: true, force: true });

  if (!stat.script) {
    console.error('\n没读到 campaign.html 的覆盖数据——脚本可能根本没跑起来。');
    process.exit(1);
  }

  const src = fs.readFileSync(ENGINE, 'utf8');
  /* V8 的 offset 是"相对脚本块开头"的，直接拿去 lineOf 会给出一堆假行号
     （2 / 20 / 81）。先把脚本块在 HTML 里的起点找出来加回去。
     这里取最长的那块，和 load.js 的 extractScript 同一个判据。 */
  let scriptStart = 0, scriptLines = 0;
  {
    const all = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    let best = null;
    for (const m of all) if (!best || m[1].length > best[1].length) best = m;
    if (best) {
      scriptStart = best.index + '<script>'.length;
      scriptLines = best[1].split('\n').length;
    }
  }
  const pct = stat.pct.toFixed(1);
  console.log('');
  console.log('引擎脚本 ' + scriptLines + ' 行 · 函数块 ' + stat.fnCount +
              ' 个，执行过 ' + (stat.fnCount - stat.deadCount) + ' 个');
  console.log('字节覆盖 ' + pct + '%' + (MIN === null ? '' : '（门槛 ' + MIN + '%）'));

  if (stat.dead.length) {
    console.log('');
    console.log('从未执行的函数（' + stat.dead.length + ' 个，按行号）：');
    for (const d of stat.dead.slice(0, TOP)) {
      console.log('  ' + String(lineOf(src, scriptStart + d.start)).padStart(5) + '  ' + d.name +
                  '  (' + (d.end - d.start) + ' 字节)');
    }
    if (stat.dead.length > TOP) {
      console.log('  …还有 ' + (stat.dead.length - TOP) + ' 个（--top=N 多看几个）');
    }
  } else {
    console.log('');
    console.log('每个函数块都执行过了。');
  }

  if (MIN !== null) {
    if (stat.pct < MIN) {
      console.log('');
      console.error('覆盖率 ' + pct + '% 低于门槛 ' + MIN + '%。');
      process.exit(1);
    }
    if (!allOk) {
      /* 测试本身红了就别报"覆盖率达标"——那只是跑过的部分恰好够多。 */
      console.error('测试有失败项，覆盖率数字不代表质量。');
      process.exit(1);
    }
  }
  process.exit(allOk ? 0 : 1);
})();
