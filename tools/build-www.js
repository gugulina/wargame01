/* 生成 / 校验打包用的 www/ —— 这是发布物的**唯一**来源。

   为什么需要它：以前 www 是人手 cp 出来的，没人校验。v5 那个 APK 里装的是
   v4.11 的引擎（仓库已经是 v4.12）、旧快照的 data/levels.js、7eaaaef 刚删掉的
   712 KB 死素材，外加 game/_cand 16.6 MB 毛料和 audio-lab 1.4 MB 试听页——
   22.5 MB 的 web 资源里只有 3.8 MB 该在。
   `npm test` 七步全打在 game/campaign.html 上，发布物完全在射程外，所以全程绿灯。
   这和 `export-levels.js --check` 防的是同一类事故：**校验对象必须就是发布对象。**

   两个模式：
     node tools/build-www.js           重建 www/ 并写指纹清单
     node tools/build-www.js --check   只校验，不写；www 不存在就跳过

   清单是"引用驱动"而不是白名单目录整拷：菜单页 href/src 指向谁、引擎 ASSETS
   引用谁，就拷谁。好处是不用维护一份排除名单——_cand / audio-lab / prev /
   *-synth 里那些没被引用的东西，天然进不来；将来加了新素材也不用手动登记。
   代价是**漏引用检测不到**（页面里没写的资源当然不会被拷），所以下面还要有
   一条"不该出现的东西必须零命中"的反向断言撑着。 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadGame } = require('./load');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const MANIFEST = '.manifest.json';
const ENGINE = path.join(ROOT, 'game', 'campaign.html');

/* 3.8 MB 是实测值，留一倍余量。越过这条线不是"资源变多了"，是又有大件混进来：
   上次是 _cand 的 16.6 MB，再上次是试听页内嵌的 1 MB base64。 */
const MAX_BYTES = 6 * 1024 * 1024;

/* 不该出现在发布物里的路径片段。任一条命中就报错退出——**不静默跳过**：
   静默跳过等于"我帮你处理了"，下次混进来更大的东西照样没人知道。 */
const BANNED = [
  ['/_cand/', '候选毛料（原始 wav/mp3，只给 sfx-import 当输入）'],
  ['/audio-lab/', '声音实验室，开发用试听页'],
  ['/prev/', '换素材时的对照版'],
  ['.embed.html', '试听页内嵌 base64 版'],
];

const md5 = p => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

/* 从 HTML 里取本地引用。跳过外链、锚点、以及引擎里那些拼出来的
   href="' + r.url + '"（含引号或加号的都不是字面量路径）。 */
function refsOf(relHtml) {
  const html = fs.readFileSync(path.join(ROOT, relHtml), 'utf8');
  const out = [];
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (/^(?:https?:|data:|mailto:|#|\/\/)/.test(raw)) continue;
    const clean = raw.split('?')[0].split('#')[0];
    if (!clean || /['"+]/.test(clean)) continue;
    out.push(path.posix.normalize(clean));
  }
  return out;
}

/* 引擎 ASSETS 里的每个非 null 路径。base 键本身是字符串，要排掉。 */
function assetRefs() {
  const { api } = loadGame(ENGINE);
  const A = api.ASSETS || {};
  const base = A.base || 'assets/';
  const found = [];
  const walk = (obj, depth) => {
    if (depth > 4) return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string') found.push(v);
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  const { base: _drop, ...rest } = A;
  walk(rest, 0);
  return found.map(v => path.posix.normalize('game/' + base + v));
}

/* 清单：相对仓库根的路径 → 为什么要它。重复项合并，保持首次出现的理由。 */
function plan() {
  const want = new Map();
  const add = (rel, why) => {
    if (!rel) return;
    if (!want.has(rel)) want.set(rel, why);
  };

  add('index.html', '菜单页（线上与包里都是它当入口）');
  for (const r of refsOf('index.html')) add(r, '菜单页引用');
  /* 引擎引用的是 campaign.css 和一堆相对路径；campaign.html 本身没有外链，
     解析它是为了让"以后引擎新增一个 <link>"时不用回来改这里。 */
  add('game/campaign.html', '引擎');
  for (const r of refsOf('game/campaign.html')) {
    add(path.posix.normalize(path.posix.join('game', r)), '引擎引用');
  }
  for (const r of assetRefs()) add(r, '引擎 ASSETS 引用');
  /* 署名文件随包走：CC-BY 4.0 要求分发时附带授权声明，游戏里的署名页是
     另一条通道（HQ_TABS 的 credits）。两条都留着，缺一条都不算完整。 */
  add('game/assets/sfx/CREDITS.md', 'CC-BY 署名底账');

  const files = [];
  const problems = [];
  for (const [rel, why] of want) {
    const abs = path.join(ROOT, rel);
    let st = null;
    try { st = fs.statSync(abs); } catch (e) {}
    if (!st || !st.isFile()) {
      problems.push(rel + ' —— ' + why + '，但磁盘上没有这个文件');
      continue;
    }
    const norm = '/' + rel;
    for (const [seg, note] of BANNED) {
      if (norm.includes(seg)) {
        problems.push(rel + ' —— 被引用到了，但它是' + note + '，不该进发布物');
      }
    }
    files.push({ rel, why, bytes: st.size, md5: md5(abs) });
  }
  return { files, problems };
}

function rebuild() {
  const { files, problems } = plan();
  if (problems.length) {
    console.error('[www] 清单有问题，未生成：');
    for (const p of problems) console.error('  · ' + p);
    process.exit(1);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  for (const f of files) {
    const dst = path.join(OUT, f.rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f.rel), dst);
  }

  const total = files.reduce((s, f) => s + f.bytes, 0);
  const man = {
    generator: 'tools/build-www.js',
    version: require(path.join(ROOT, 'package.json')).version,
    files: Object.fromEntries(files.map(f => [f.rel, { bytes: f.bytes, md5: f.md5, why: f.why }])),
    count: files.length,
    bytes: total,
  };
  fs.writeFileSync(path.join(OUT, MANIFEST), JSON.stringify(man, null, 2) + '\n');

  console.log('[www] 已生成 ' + files.length + ' 个文件，' +
    (total / 1048576).toFixed(2) + ' MB（上限 ' + (MAX_BYTES / 1048576) + ' MB）');
  if (total > MAX_BYTES) {
    console.error('[www] 超出体积上限 —— 又有大件混进发布物了');
    process.exit(1);
  }
  return 0;
}

function verify() {
  if (!fs.existsSync(OUT)) {
    console.log('[www] 未生成，跳过（只有要打包 APK 时才需要它）');
    return 0;
  }
  let bad = 0;
  const say = (tag, msg) => { console.error('[' + tag + '] ' + msg); bad++; };

  const manPath = path.join(OUT, MANIFEST);
  if (!fs.existsSync(manPath)) {
    say('www/1', 'www/ 里没有指纹清单——它是手 cp 出来的，来源不可追溯；跑一次 node tools/build-www.js');
    return bad;
  }
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const { files, problems } = plan();

  if (problems.length) {
    for (const p of problems) say('www/2', '清单有问题：' + p);
  }

  /* a) 真源有没有在拷完之后又改过。这是"发布旧引擎"的第一现场：
        改完 campaign.html 忘了重建，www 里就还是上一版。 */
  let stale = 0;
  for (const f of files) {
    const m = man.files[f.rel];
    if (!m) { say('www/3', 'www 缺 ' + f.rel + '（' + f.why + '）'); stale++; continue; }
    if (m.bytes !== f.bytes || m.md5 !== f.md5) {
      say('www/3', f.rel + ' 已过期：真源 ' + f.bytes + ' 字节 / ' + f.md5.slice(0, 8) +
        '，www 记的是 ' + m.bytes + ' / ' + m.md5.slice(0, 8) + ' → 重跑 node tools/build-www.js');
      stale++;
    }
  }

  /* b) www 里实际躺着的东西，必须和清单一一对应。多出来的基本都是历史遗留：
        _cand、audio-lab、以及删掉的素材。 */
  const onDisk = [];
  (function walk(dir, prefix) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (rel !== MANIFEST) onDisk.push(rel);
    }
  })(OUT, '');

  const want = new Set(files.map(f => f.rel));
  for (const rel of onDisk) {
    if (!want.has(rel)) {
      const norm = '/' + rel;
      const hit = BANNED.find(([seg]) => norm.includes(seg));
      say('www/4', 'www 里多出 ' + rel + (hit ? '（' + hit[1] + '）' : '（清单里没有）') + ' → 重跑重建');
    }
  }
  /* c) 拷过去的字节要和真源一致。上面 a) 比的是清单，这里比的是磁盘：
        清单写对了但拷贝中途被打断，只有这一条抓得到。 */
  for (const f of files) {
    const abs = path.join(OUT, f.rel);
    if (!fs.existsSync(abs)) continue;      // 已在 a) 里报过
    let h = '';
    try { h = md5(abs); } catch (e) { continue; }
    if (h !== f.md5) say('www/5', 'www 里的 ' + f.rel + ' 与真源不一致（拷坏了）');
  }
  /* d) 版本三处对齐：verTag / package.json / 安卓 versionName。
        前两个 export-levels 已经管着，这里补的是**安卓那两行**——
        它们手改、没有版本控制（android/ 在 .gitignore 里），最容易游离。 */
  const pkg = require(path.join(ROOT, 'package.json')).version;
  const want2 = pkg.split('.').slice(0, 2).join('.');
  const engineHtml = fs.readFileSync(path.join(OUT, 'game', 'campaign.html'), 'utf8');
  const vm = engineHtml.match(/id="verTag">v([\d.]+)</);
  if (vm && vm[1] !== want2) {
    say('www/6', '包里引擎是 v' + vm[1] + '，package.json 是 ' + pkg + ' → 重建');
  }
  const gradle = path.join(ROOT, 'android', 'app', 'build.gradle');
  if (fs.existsSync(gradle)) {
    const g = fs.readFileSync(gradle, 'utf8');
    const name = (g.match(/versionName\s+"([^"]*)"/) || [])[1];
    const code = (g.match(/versionCode\s+(\d+)/) || [])[1];
    if (name !== want2) {
      say('www/7', '安卓 versionName 是 "' + name + '"，应为 "' + want2 + '"（与 #verTag 对齐）');
    }
    if (!code) say('www/7', 'android/app/build.gradle 里找不到 versionCode');
  }

  if (bad) {
    console.error('[www] 发布物与真源不一致，共 ' + bad + ' 处');
    return bad;
  }
  const mb = (man.bytes / 1048576).toFixed(2);
  console.log('[www] 发布物与真源一致：' + man.count + ' 个文件，' + mb + ' MB' +
    (fs.existsSync(gradle) ? '，安卓 versionName 已对齐' : ''));
  return 0;
}

const check = process.argv.includes('--check');
process.exit(check ? verify() : rebuild());
