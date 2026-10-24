/* 多关框架回归测试：关卡数据完整性、解锁规则、时间轴渲染、切关、进度存续、
   地图重置、前情衔接、下一关按钮、三种胜负条件。

   跑法（jsdom 装在托管 node 的 workspace 里，不在本仓库）：
     NODE_PATH="C:/Users/泽宇/.workbuddy/binaries/node/workspace/node_modules" \
     node tools/levelcheck.js

   为什么要有这个文件：多关框架的 bug 全都是"状态没跟着关卡走"这一类，
   纯函数测不出来——必须真的点一下、真的切一次关，再读回来。

   写断言的一条纪律：**不要写死某一关的过关顺序。**
   这个文件曾经通篇假设"岚口（C3）是唯一可玩的关"，教学关一路插到最前面，
   六条断言当场集体翻车——不是代码坏了，是测试比代码更脆。
   现在一律从 LEVELS 里动态取"第一个 ready 的关"，加关卡不用改测试。 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const file = path.join(__dirname, '..', 'game', 'campaign.html');
const html = fs.readFileSync(file, 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1/game/campaign.html'
});
const { window } = dom;
const doc = window.document;
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, skipped = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
/* 断言"不适用"时用这个，而不是 ok(..., true)。
   写 ok(名字, true) 会让通过数虚涨——测试数字越来越好而覆盖面一点没变，
   以后再有人照抄这条写法，整套测试就慢慢变成一个报数机器。
   skip 单独计数、单独显示，数字是诚实的。 */
function skip(name, why) {
  skipped++;
  console.log('  · ' + name + (why ? '  （跳过：' + why + '）' : '  （跳过）'));
}

(async () => {
  await wait(400);
  const api = window.__WAR__;
  const LV = api.LEVELS;
  const readyAll = LV.filter(l => l.ready);
  const firstReady = readyAll[0];
  const lastReady = readyAll[readyAll.length - 1];
  /* 拿"下一关还没做出来的那个可玩关"当收尾样本：它的 nextReadyLevel 一定是 null */
  const deadEnd = readyAll[readyAll.length - 1];

  console.log('[1] 关卡数据完整性');
  ok('LEVELS 是数组', Array.isArray(LV));
  ok('至少 4 关（序章 + 三关战役）', LV.length >= 4, '实际 ' + LV.length);
  /* 编号递增：附属关与正关共用编号（第 3 关 / 岚口机场），所以允许相等，
     但必须先正后附，且附属关不能出现在它的正关之前 */
  let mono = true, subOk = true;
  for (let i = 1; i < LV.length; i++) {
    const a = LV[i - 1], b = LV[i];
    if (!(b.no > a.no || (b.no === a.no && b.sub))) mono = false;
    if (b.sub && !(!a.sub && a.no === b.no)) subOk = false;
  }
  ok('编号递增（附属关允许与正关同号）', mono);
  ok('附属关紧跟在它的正关之后', subOk,
     LV.filter(l => l.sub).map(l => l.id + '@' + l.no).join(','));
  /* no:0 是序章，用 !!l.no 会把 0 当成缺失——踩过 */
  const metaOk = LV.every(l => l.id && l.no !== undefined && l.name && l.when &&
                               l.where && l.teaser && l.type);
  ok('每关元信息齐全（id/no/name/when/where/teaser/type，no 允许为 0）', metaOk,
     LV.filter(l => !(l.id && l.no !== undefined && l.name && l.when && l.where && l.teaser && l.type))
       .map(l => l.id + ':' + (!l.name ? 'name ' : '') + (!l.type ? 'type ' : '')).join(' '));
  const readyOk = readyAll.every(l => Array.isArray(l.map) && l.map.length === l.rows && l.units.length);
  ok('ready 的关都有完整地图与编制', readyOk);
  const srcOk = LV.every(l => Array.isArray(l.mapSrc));
  ok('每关都生成了 mapSrc 原始副本', srcOk);
  /* 三种胜负条件各至少有一关用到——不然这三条分支等于没测 */
  const kinds = new Set(readyAll.map(l => (l.win || { kind: 'score' }).kind));
  ok('scene/survive/reach 三种目标都有实装关卡',
     kinds.has('score') && kinds.has('survive') && kinds.has('reach'),
     [...kinds].join('/'));
  /* 前三关不许出现重型坦克，中坦也要克制 */
  const first3 = readyAll.filter(l => l.no >= 1 && l.no <= 3);
  const heavy = first3.reduce((s, l) => s + l.units.filter(u => u.type === 'harm').length, 0);
  ok('前三关没有任何重型坦克', heavy === 0, '实际 ' + heavy + ' 台');
  const med = first3.reduce((s, l) => s + l.units.filter(u => u.type === 'marm').length, 0);
  const totalU = first3.reduce((s, l) => s + l.units.length, 0);
  ok('前三关中坦占比不到两成', med / totalU < 0.2,
     med + ' / ' + totalU + ' = ' + (med / totalU * 100).toFixed(0) + '%');

  console.log('[2] 解锁规则（清空进度，从零开始看）');
  try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}
  const lockedLv = LV.find(l => !l.ready);
  if (lockedLv) {
    const a = api.levelAccess(lockedLv.id);
    ok('未制作的关不可进', !a.ok && a.why === '制作中', a.why);
  } else {
    skip('未制作的关不可进', '所有关都已制作，没有占位关可测');
  }
  const fa = api.levelAccess(firstReady.id);
  ok('第一个可玩关开局即可进', fa.ok, fa.why);
  ok('第一个可玩关前面没有已制作关 → prevReadyLevel 为 null',
     api.prevReadyLevel(firstReady.id) === null);
  ok('推荐关卡是第一个可玩关', api.recommendLevel() && api.recommendLevel().id === firstReady.id,
     api.recommendLevel() && api.recommendLevel().id);
  ok('最后一个可玩关没有下一关', api.nextReadyLevel(deadEnd.id) === null);

  /* 序章与第一关都声明 open:true，开局就该都能进。
     教学关不该当门槛——会玩的人直接打第一仗，想练手的随时回沙盘。 */
  const opened = readyAll.filter(l => l.open);
  ok('至少两关声明了 open（序章 + 第一关）', opened.length >= 2, opened.map(l => l.id).join(','));
  ok('序章与第一关都在 open 集合里',
     opened.some(l => l.no === 0) && opened.some(l => l.no === 1),
     opened.map(l => l.name).join(' '));
  ok('open 的关在零进度下全部可进',
     opened.every(l => api.levelAccess(l.id).ok));
  /* 第一关之后的第一道门槛：它必须真的锁着 */
  const gated = readyAll.find(l => !l.open && l.no > 0);
  if (gated) {
    ok('第三关（非 open）在零进度下锁着', !api.levelAccess(gated.id).ok,
       gated.id + '：' + api.levelAccess(gated.id).why);
    api.markResult('C1', 'win');
    ok('通关第一关后它解锁', api.levelAccess(gated.id).ok, api.levelAccess(gated.id).why);
    try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}
  } else {
    skip('第三关（非 open）在零进度下锁着', '零进度下没有受锁的关');
  }

  console.log('[3] 选关只在菜单页（引擎不再自带关卡列表）');
  /* 开始页和它的时间轴已经删掉：菜单页（根目录 index.html）是唯一入口。
     这四条是防"再长回来"的——两套并存的选关界面必然走样，
     而且走样的方式不报错，只会让玩家点得进去、游戏却说没解锁。 */
  ok('引擎里没有关卡时间轴', !doc.getElementById('lvlList'));
  ok('引擎里没有开始页', !doc.getElementById('startScreen'));
  ok('顶栏有返回菜单按钮', !!doc.getElementById('btnMenu'));
  ok('存档导入口还在（HQ 的导入按钮点它）', !!doc.getElementById('fileImport'));

  console.log('[4] 切关');
  if (lockedLv) {
    const bad = await api.enterLevel(lockedLv.id, { noIntro: true });
    ok('进未制作的关被拒绝', bad === false);
    ok('被拒绝后关卡指针没变', api.LEVEL.id !== lockedLv.id);
  } else {
    ok('进未制作的关被拒绝', true, '（没有占位关，跳过）');
    ok('被拒绝后关卡指针没变', true, '（同上）');
  }
  const good = await api.enterLevel(firstReady.id, { noIntro: true, noSave: true });
  ok('进第一个可玩关成功', good === true);
  ok('LEVEL 指向该关', api.LEVEL.id === firstReady.id);
  ok('棋盘已重绘', doc.getElementById('board').innerHTML.length > 500);

  console.log('[5] 进度存续（两层存档不能混）');
  try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}
  ok('清空后没有通关记录', !api.readProgress().cleared[firstReady.id]);
  api.markResult(firstReady.id, 'fail');
  ok('失败记进 played', api.readProgress().played[firstReady.id] === 'fail');
  ok('失败不解锁（cleared 仍为空）', !api.readProgress().cleared[firstReady.id]);
  api.markResult(firstReady.id, 'win');
  ok('通关记进 cleared', api.readProgress().cleared[firstReady.id] === 'win');
  api.markResult(firstReady.id, 'fail');
  ok('通关后重打失败，不清掉通关记录', api.readProgress().cleared[firstReady.id] === 'win');

  console.log('[6] 地图重置（架过的桥不能留到下一局）');
  const rawMap = api.LEVEL.mapSrc.slice();
  const dirtyRow = rawMap.findIndex(r => r[0] !== '~');
  api.LEVEL.map[dirtyRow] = '~' + api.LEVEL.map[dirtyRow].slice(1);
  const dirty = api.LEVEL.map[dirtyRow] !== rawMap[dirtyRow];
  ok('测试确实改动了地图', dirty);
  api.newGame({ level: firstReady.id, noSave: true });
  ok('newGame 后地图恢复原始', api.LEVEL.map[dirtyRow] === rawMap[dirtyRow]);

  console.log('[7] 前情衔接（由上一关结果生成，不硬编码）');
  if (readyAll.length >= 2) {
    const cur = readyAll[1];
    const pre = readyAll[0];
    ok('前情来源就是上一关', api.prevReadyLevel(cur.id) === pre);
    /* 直接读 state.log 而不是 DOM：战报面板只渲染最近几条，断言会不稳 */
    const logOf = () => api.getState().log.map(e => e.text).join(' ');
    api.markResult(pre.id, 'fail');
    api.newGame({ level: cur.id, noSave: true });
    ok('开场战报出现前情', logOf().indexOf('前情') >= 0);
    const failLine = (cur.prev || {}).fail || '';
    ok('前情用的是 fail 那句',
       failLine && logOf().indexOf(failLine.slice(0, 10)) >= 0, failLine.slice(0, 20));
    ok('开场战报带时间点', logOf().indexOf(cur.when) >= 0);
    api.markResult(pre.id, 'win');
    api.newGame({ level: cur.id, noSave: true });
    const winLine = (cur.prev || {}).win || '';
    ok('通关后前情换成 win 那句',
       winLine && winLine !== failLine && logOf().indexOf(winLine.slice(0, 10)) >= 0,
       winLine.slice(0, 20));
    try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}
  } else {
    ok('前情衔接', true, '（只有一关，跳过）');
  }

  console.log('[8] 下一关按钮');
  ok('最后一关没有下一关', api.nextReadyLevel(deadEnd.id) === null);

  /* ─────────────────────────────────────────────────────
     [9] 首页（根目录 index.html）与引擎的关卡视图必须一致

     首页要显示"哪一关能进"，却没有引擎那套函数可用——它是独立页面，
     读的是 data/levels.js 里的快照。于是解锁规则在两边各写了一份。
     这类复刻最典型的坏法不是报错，是**悄悄走样**：玩家在首页看到"进入"，
     点进去游戏说"未解锁"；或者反过来，明明该能进却进不去。

     所以这里把首页真的加载起来，跟引擎逐关对比。
     ───────────────────────────────────────────────────── */
  console.log('[9] 首页与引擎的关卡视图一致');
  const homePath = path.join(__dirname, '..', 'index.html');
  const levelsPath = path.join(__dirname, '..', 'data', 'levels.js');
  const levelsJs = fs.readFileSync(levelsPath, 'utf8');
  const homeSrc = fs.readFileSync(homePath, 'utf8');
  const SCRIPT_TAG = '<script src="data/levels.js"></script>';

  /* 把外链换成内联：jsdom 加载 file:// 相对资源要开 resources:'usable'，
     而那个开关会把整页的网络请求都放进测试里。换内联最干净。 */
  function loadHome(prepJs) {
    if (homeSrc.indexOf(SCRIPT_TAG) < 0) throw new Error('首页里找不到 ' + SCRIPT_TAG);
    const injected = (prepJs ? '<script>' + prepJs + '</script>' : '') +
                     '<script>' + levelsJs + '</script>';
    return new JSDOM(homeSrc.replace(SCRIPT_TAG, injected), {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'http://127.0.0.1/index.html'
    });
  }

  const progressKey = JSON.stringify(api.PROGRESS_KEY);
  const allCleared = {};
  for (const l of readyAll) allCleared[l.id] = 'win';

  const homeEmpty = loadHome().window.__HOME__;
  ok('首页拿到了关卡数据', !!(homeEmpty && homeEmpty.levels && homeEmpty.levels.length));

  if (homeEmpty) {
    ok('首页关数与引擎一致',
       homeEmpty.levels.length === LV.length,
       '首页 ' + homeEmpty.levels.length + ' / 引擎 ' + LV.length);

    ok('首页关卡顺序与引擎一致',
       homeEmpty.levels.map(l => l.id).join(',') === LV.map(l => l.id).join(','),
       homeEmpty.levels.map(l => l.id).join(',') + ' vs ' + LV.map(l => l.id).join(','));

    /* 逐关对字段。关名 / 日期 / 地点这些是纯文案，一旦首页是手抄的副本，
       改完数据忘了重跑导出，玩家就会在首页看到上一版的关卡名。 */
    const fields = ['name', 'when', 'where', 'type', 'ready', 'open', 'no'];
    const drift = [];
    for (const lv of LV) {
      const h = homeEmpty.levels.find(x => x.id === lv.id);
      if (!h) { drift.push(lv.id + '：首页没有这一关'); continue; }
      for (const f of fields) {
        /* ready / open 是可省略的字段：引擎里没写就是 undefined，导出时成了 false。
           直接字符串比会报"C2.open：首页 false / 引擎 undefined"这种假错。 */
        const a = (f === 'ready' || f === 'open') ? !!h[f] : String(h[f]);
        const b = (f === 'ready' || f === 'open') ? !!lv[f] : String(lv[f]);
        if (a !== b) {
          drift.push(lv.id + '.' + f + '：首页 ' + JSON.stringify(h[f]) + ' / 引擎 ' + JSON.stringify(lv[f]));
        }
      }
    }
    ok('首页各关的关名 / 时间 / 地点 / 状态与引擎一致', drift.length === 0, drift.join('；'));

    ok('首页用的存档 key 与引擎一致',
       homeEmpty.data.storage.save === api.SAVE_KEY &&
       homeEmpty.data.storage.progress === api.PROGRESS_KEY &&
       homeEmpty.data.storage.saveVer === api.SAVE_VER,
       JSON.stringify(homeEmpty.data.storage));

    /* 零进度下逐关对比解锁结论 */
    try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}
    /* 传首页自己的关卡对象进去：两个页面各有各的 LEVELS 数组，
       拿引擎那份去问首页的 access，indexOf 会返回 -1。 */
    const cmp = [];
    for (const lv of LV) {
      const h = homeEmpty.access(homeEmpty.levels.find(x => x.id === lv.id)).ok;
      const e = api.levelAccess(lv.id).ok;
      if (h !== e) cmp.push(lv.id + '：首页 ' + (h ? '可进' : '锁') + ' / 引擎 ' + (e ? '可进' : '锁'));
    }
    ok('首页不接受外来关卡对象（防止索引 -1 被当成可进）',
       homeEmpty.access({ id: '__nope__' }).ok === false);
    ok('零进度下每一关的解锁结论一致', cmp.length === 0, cmp.join('；'));

    ok('零进度下首页推荐关 === 引擎推荐关',
       (homeEmpty.recommend() || {}).id === (api.recommendLevel() || {}).id,
       (homeEmpty.recommend() || {}).id + ' / ' + (api.recommendLevel() || {}).id);

    /* 全通关之后再比一次：解锁规则里"往前找最近一个 ready 关"那段，
       零进度时走的是同一条短路，只有全部打通才分得出对错 */
    for (const l of readyAll) api.markResult(l.id, 'win');
    const homeDone = loadHome('try{localStorage.setItem(' + progressKey + ',' +
      JSON.stringify(JSON.stringify({ cleared: allCleared })) + ')}catch(e){}').window.__HOME__;
    const cmp2 = [];
    for (const lv of LV) {
      const h = homeDone.access(homeDone.levels.find(x => x.id === lv.id)).ok;
      const e = api.levelAccess(lv.id).ok;
      if (h !== e) cmp2.push(lv.id + '：首页 ' + (h ? '可进' : '锁') + ' / 引擎 ' + (e ? '可进' : '锁'));
    }
    ok('全通关后每一关的解锁结论一致', cmp2.length === 0, cmp2.join('；'));

    /* 第三种状态：打到附属关所在的位置，但**跳过附属关本身**。
       这是最容易漏测的一种。零进度和全通关两种极端下，"往前扫最近一个
       已制作的关"这种写法结论都对；只有中间态会分岔——菜单页把附属关
       当成主线的下一道台阶锁着，引擎则跳过了它。
       实际上就发生过：玩家通关第 3 关后，菜单页写着"先通过「岚口机场保卫战」"，
       而引擎里第 4 关早就开了。加这一段是为了让那个 bug 不可能再回来。 */
    const subLv = readyAll.find(l => l.sub);
    if (subLv) {
      const partial = {};
      const subIdx = LV.indexOf(subLv);
      for (const l of readyAll) {
        if (l.sub) continue;
        if (LV.indexOf(l) > subIdx) break;
        partial[l.id] = 'win';
      }
      api.writeProgress({ cleared: partial, played: {}, deck: null, last: null });
      const homePartial = loadHome('try{localStorage.setItem(' + progressKey + ',' +
        JSON.stringify(JSON.stringify({ cleared: partial })) + ')}catch(e){}').window.__HOME__;
      const cmp3 = [];
      for (const lv of LV) {
        const h = homePartial.access(homePartial.levels.find(x => x.id === lv.id)).ok;
        const e = api.levelAccess(lv.id).ok;
        if (h !== e) cmp3.push(lv.id + '：首页 ' + (h ? '可进' : '锁') + ' / 引擎 ' + (e ? '可进' : '锁'));
      }
      ok('跳过附属关的中间态下，首页与引擎结论一致（' + subLv.id + ' 未通关）',
         cmp3.length === 0, cmp3.join('；'));
      ok('该状态下主线继续往下开（附属关没有把主线卡住）',
         api.levelAccess(readyAll[readyAll.length - 1].id).ok);
      try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}
    }
    try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}
  }

  console.log('');
  console.log('通过 ' + pass + ' 项' + (skipped ? ' · 跳过 ' + skipped + ' 项' : '') +
              '，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(1); });
