/* 把关卡元数据从 campaign.html 抽出来，写成 data/levels.js 给首页用。

   为什么不直接 fetch JSON：这个项目是"双击 index.html 就能玩"的纯静态页面，
   file:// 协议下 fetch/XHR 会被同源策略拦死，但 <script src> 放行。
   所以首页不能读 data/levels.json，只能读一个"把自己挂到 window 上的 js"。

   为什么不让首页自己维护一份关卡清单：清单里每一个字段（关名、日期、地点、
   一句话提要）都是 campaign.html 里那份数据的副本，手抄必然走样——
   改完关名忘了改首页，首页就会指着一个不存在的关名。这里生成、check 模式校验。

   用法：
     node tools/export-levels.js             生成 data/levels.js
     node tools/export-levels.js --check     只比对，不写文件；不一致退出码 1
*/
const fs = require('fs');
const path = require('path');
const { loadGame } = require('./load');

const root = path.join(__dirname, '..');
const gamePath = path.join(root, 'game', 'campaign.html');
const outPath = path.join(root, 'data', 'levels.js');

const checkOnly = process.argv.includes('--check');

/* 行尾一律归一成 LF 之后再算。git 在 Windows 上按 core.autocrlf 把工作区写成
   CRLF，Linux 和 CI 检出是 LF —— 同一份提交，两边的原始字节每行差一个 \r。
   指纹如果吃原始字节，就会"Windows 上绿、CI 上红"，而且两边各自看都像对的：
   本地跑 --check 一致，CI 跑同一段代码却不一致，第一反应会去怀疑缓存。
   v4.6.2 的 CI 首跑就是这么红的（srcSig 差了 8920 字节 = 引擎的行数）。 */
const html = fs.readFileSync(gamePath, 'utf8').replace(/\r\n?/g, '\n');
const { api } = loadGame(gamePath);

/* 版本号从顶栏那个 <span id="verTag"> 读——它是全项目唯一的版本标记，
   另开一个常量迟早会跟它说不到一块儿去。 */
const vm2 = /<span id="verTag">([^<]+)<\/span>/.exec(html);
const ver = vm2 ? vm2[1].trim() : '';

/* 源文件指纹：文件字节数 + 简易散列。比"生成时间"有用得多——
   时间每次跑都变，git 里永远是脏的；指纹只在真变了的时候才变。
   注意这里是归一化之后的长度，不是磁盘上的字节数：见上面那段行尾说明。 */
let hash = 0;
for (let i = 0; i < html.length; i++) hash = (hash * 31 + html.charCodeAt(i)) | 0;
const srcSig = html.length + ':' + (hash >>> 0).toString(36);

/* 版本号只有一个真源：引擎顶栏那个 #verTag。package.json 是第二条副本
   （npm 需要它，删不掉），README 标题是第三条（人看的）。
   副本越少越好，既然删不掉，至少让它们和真源对上——否则会出现
   "引擎 v4.5、package.json 4.3、README v4.2"这种三个数字互相打脸的场面。
   这条校验放在生成和 --check 都跑，因为改版本号时往往只改一处。 */
let pkgVer = '';
try {
  pkgVer = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '';
} catch (e) { pkgVer = ''; }
/* 比到 major.minor 就够了：npm 要三段（4.5.0），顶栏给人看的是两段（v4.5）。
   补丁号不进展示版本，所以 4.5.1 与 v4.5 算一致——但 4.6.0 与 v4.5 必须报错。 */
const pkgShort = pkgVer ? pkgVer.split('.').slice(0, 2).join('.') : '';
if (ver && pkgShort && ('v' + pkgShort) !== ver) {
  console.error('✗ 版本号不一致：引擎顶栏是 ' + ver + '，package.json 是 ' + pkgVer);
  console.error('  以引擎顶栏为准。改 package.json 的 version 后重跑本命令。');
  process.exit(1);
}

const levels = (api.LEVELS || []).map(lv => {
  /* 占位关没有 units（ready:false，只有元信息）。这里必须兜住——
     以前这里是 `lv.units.filter(...)`，加第一个占位关就会整条命令崩掉，
     而崩的地方在生成脚本里，看起来像"引擎坏了"。 */
  const units = lv.units || [];
  const blue = units.filter(u => u.side === 'blue');
  const red = units.filter(u => u.side === 'red');
  const sum = arr => arr.reduce((s, u) => s + u.str, 0);
  return {
    id: lv.id,
    ch: lv.ch,
    no: lv.no,
    sub: !!lv.sub,
    name: lv.name,
    type: lv.type,
    when: lv.when,
    where: lv.where,
    teaser: lv.teaser || '',
    ready: !!lv.ready,
    open: !!lv.open,
    /* 解锁前置：由引擎算好带过来，菜单页不再自己复刻一遍规则。
       之前菜单页扫"前面第一个已制作的关"，漏了"附属关不挡主线"，
       通关第 3 关之后仍把玩家锁在支线上。两份实现必然走样。 */
    prevId: api.accessPrereq(lv.id),
    /* 序号文案由引擎自己算（"序 · " / "第 3 关 · 附属 · "）。
       首页照着显示，就不会出现"第 0 关"这种只有别处才有的说法。
       brief 形式：菜单页按章分组，章名在组头上。 */
    noText: api.levelNoText(lv),
    win: lv.win && lv.win.kind ? lv.win.kind : 'score',
    /* 超额达成条件。**由引擎算**（`perfectHint`），菜单页只负责显示。
       在首页复刻一遍判定必然会漂——项目里为"两份实现"付过学费
       （`accessPrereq` 那次：菜单页自己扫"前面第一个已制作的关"，
       漏了"附属关不挡主线"，通关第 3 关之后仍把玩家锁在支线上）。 */
    perfect: api.perfectHint(lv),
    turns: lv.maxTurns,
    cols: lv.cols,
    rows: lv.rows,
    blue: { cards: blue.length, str: sum(blue) },
    red: { cards: red.length, str: sum(red) }
  };
});

/* 章节表也一起带出去。首页要按章分组渲染，章名 / 时间跨度 / 一句话主题
   都是引擎里那份的副本——手抄必然会走样，所以同样由这里生成。
   `total` 收的是**全部**关卡数（含占位），`ready` 只数做出来的：
   前者给"这一章规划了多少仗"，后者给"现在能打几关"。 */
const chapters = (api.CHAPTERS || []).map(c => {
  const mine = levels.filter(l => l.ch === c.no);
  return {
    no: c.no,
    name: c.name,
    span: c.span,
    where: c.where,
    teaser: c.teaser,
    total: mine.length,
    main: mine.filter(l => !l.sub).length,
    sub: mine.filter(l => l.sub).length,
    ready: mine.filter(l => l.ready).length
  };
});

const body = `/* 由 tools/export-levels.js 从 game/campaign.html 生成 —— 不要手改这个文件。
   改了关卡数据之后跑一次：node tools/export-levels.js
   想确认首页和引擎有没有走样：node tools/export-levels.js --check

   为什么是 .js 而不是 .json：项目要能双击直接打开，
   file:// 下 fetch 会被同源策略拦掉，<script src> 不会。 */
window.CANGYU = ${JSON.stringify({
  ver,
  srcSig,
  /* 首页要自己读存档与进度，key 与版本号也一并带出来。
     首页硬编码一份的话，SAVE_VER 一升，首页就会把每份存档都当成"版本不符"。 */
  storage: { save: api.SAVE_KEY, saveVer: api.SAVE_VER, progress: api.PROGRESS_KEY },
  chapters,
  levels
}, null, 2)};
`;

if (checkOnly) {
  let old = '';
  try { old = fs.readFileSync(outPath, 'utf8'); } catch (e) { old = ''; }
  /* 比对前同样归一化：工作区的 data/levels.js 可能是 CRLF（Windows 检出），
     而 body 永远是 LF。只差行尾就报"不一致"是最冤的一种红。 */
  if (old.replace(/\r\n?/g, '\n') !== body) {
    console.error('✗ data/levels.js 与 campaign.html 不一致——跑 node tools/export-levels.js 重新生成');
    /* 先把指纹摆出来。指纹不同而关卡全同，说明引擎动过、数据没动；
       反过来才是关卡数据本身的问题。少了这一行，只能靠重新生成 + git diff
       才看得出差在哪（v4.6.2 查 CI 就是这么查的，绕了一大圈）。 */
    const sigOf = s => { const m = /"srcSig":\s*"([^"]+)"/.exec(s || ''); return m ? m[1] : '(无)'; };
    if (sigOf(old) !== srcSig) {
      console.error('  引擎指纹：文件里 ' + sigOf(old) + '，当前 ' + srcSig);
    }
    /* 具体差在哪：逐关比 id / name / when，比"两个文件不一样"有用 */
    let prev = null;
    try { prev = require(outPath.includes(':') ? path.resolve(outPath) : outPath); } catch (e) {}
    const oldLevels = old ? (() => {
      const m = /\{[\s\S]*\}/.exec(old);
      try { return JSON.parse(m[0]).levels || []; } catch (e) { return []; }
    })() : [];
    if (oldLevels.length !== levels.length) {
      console.error('  关数：文件里 ' + oldLevels.length + '，引擎里 ' + levels.length);
    }
    for (let i = 0; i < Math.max(oldLevels.length, levels.length); i++) {
      const a = oldLevels[i] || {}, b = levels[i] || {};
      const diff = ['id', 'ch', 'no', 'name', 'when', 'where', 'ready', 'open']
        .filter(k => String(a[k]) !== String(b[k]));
      if (diff.length) {
        console.error('  ' + (b.id || a.id) + '：' + diff.map(k => k + ' ' + JSON.stringify(a[k]) + ' → ' + JSON.stringify(b[k])).join('，'));
      }
    }
    process.exit(1);
  }
  console.log('✓ data/levels.js 与引擎一致（' + levels.length + ' 关，' + ver + '）');
  process.exit(0);
}

fs.writeFileSync(outPath, body, 'utf8');
console.log('✓ 已写 data/levels.js：' + levels.length + ' 关 / ' + chapters.length + ' 章（' + ver + '）');
/* 按章打出来。8 章 60 多关一口气平铺，人是看不出结构的——
   而"哪一章还只有 2 关"恰恰是最需要一眼看见的东西。 */
let curCh = null;
for (const l of levels) {
  if (l.ch !== curCh) {
    curCh = l.ch;
    const c = chapters.find(x => x.no === l.ch);
    console.log('  ── ' + (l.ch === 0 ? '序章' : '第 ' + l.ch + ' 章 · ' + (c ? c.name : '(未登记章节)')));
    if (c) console.log('     ' + c.main + ' 主关 + ' + c.sub + ' 附属 = ' + c.total +
      '，已制作 ' + c.ready + ' 关');
  }
  console.log('   ' + (l.noText + l.name).padEnd(26, ' ') +
    (l.ready ? (l.sub ? '附属' : '可玩') : '制作中').padEnd(4, ' ') +
    ' 蓝 ' + l.blue.cards + ' 牌 ' + l.blue.str + ' / 红 ' + l.red.cards + ' 牌 ' + l.red.str +
    ' · ' + l.when);
}
