/* 开局流程回归测试：菜单页选关 → 战前简报三页 → 对话过场 → 进入战场。
   用 jsdom 跑真 DOM，验证的是"点下去会发生什么"，不是纯函数。

   跑法（jsdom 装在托管 node 的 workspace 里，不在本仓库）：
     NODE_PATH="C:/Users/泽宇/.workbuddy/binaries/node/workspace/node_modules" \
     node tools/briefcheck.js

   为什么单独一个文件而不是塞进 selftest.js：selftest 用 vm + stub DOM，
   碰不到 innerHTML 之外的真实行为；简报这套流程全是 DOM 交互，必须真环境。

   加载 URL 带 ?lv=T1&nointro=1：模拟"菜单页点了教学关"。
   引擎自己不再有开始页，开局必须由 URL 或测试显式指定，
   否则 boot 会走 startNew() 直接把推荐关的简报播出来，这里的第一组断言就全错位了。 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

/* jsdom 不实现 <audio> 的 load()/play()，每次预载十几条 "Not implemented"
   直接冲到 stderr，把断言输出淹掉（以前只是被 grep 滤掉所以没人在意）。
   只吞这一类，其他脚本异常照旧打出来——那是真问题。 */
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  if (!/Not implemented/.test(String(e && e.message))) {
    console.error('[jsdom] ' + String(e && (e.detail || e.message || e)));
  }
});

/* 用法：node tools/briefcheck.js [game/campaign.html]
   接一个可选文件参数是为了 mutcheck.js——DOM 那几条断言（转义、战报 textContent）
   只能在真 DOM 里验，而"验它会不会红"必须拿一份变异过的引擎去跑。 */
const file = process.argv[2] && !process.argv[2].startsWith('-')
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'game', 'campaign.html');
const html0 = fs.readFileSync(file, 'utf8');

/* 引擎的版本公告数据来自 data/notes.js（一个 <script src>）。jsdom 只解析 DOM、
   不替你去取外部脚本，所以不内联的话 window.CANGYU_NOTES 永远是 undefined，
   HQ 的公告页签会走进"读不到数据"的兜底分支——而那个分支**不报错**
   （它本来就要能处理缺文件），于是断言只会静默地变空。
   变异过的引擎如果没有这个标签，replace 就什么也不做，那时断言该红就红。 */
const NOTES_TAG = '<script src="../data/notes.js"></script>';
const html = html0.replace(NOTES_TAG,
  '<script>' + fs.readFileSync(path.join(__dirname, '..', 'data', 'notes.js'), 'utf8') + '</script>');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://127.0.0.1/game/campaign.html?lv=T1&nointro=1'
});
const { window } = dom;
const doc = window.document;
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, skipped = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
/* 见 levelcheck 里的同名说明：断言"不适用"时用 skip，别用 ok(..., true)。
   恒真的"通过"会让测试数字虚涨，而覆盖面一点没变。 */
function skip(name, why) {
  skipped++;
  console.log('  · ' + name + (why ? '  （跳过：' + why + '）' : '  （跳过）'));
}

(async () => {
  await wait(400);

  console.log('[1] 引擎不再自带开始页（选关归菜单页）');
  ok('没有开始页', !doc.getElementById('startScreen'));
  ok('没有关卡时间轴', !doc.getElementById('lvlList'));
  ok('没有「开始推演」按钮', !doc.getElementById('btnNewGame'));
  ok('顶栏有返回菜单按钮', !!doc.getElementById('btnMenu'));
  ok('存档导入口还在（HQ 要用）', !!doc.getElementById('fileImport'));
  ok('简报默认隐藏', doc.getElementById('briefScreen').classList.contains('hidden'));

  console.log('[2] 进岚口（等价菜单页点第 3 关）→ 简报第一页');
  /* 这一段测的是岚口（C3）的三页公文 + 三段对话，是全作唯一一段
     「公文三页 + 对话三段 + 电话符号位」齐全的过场，所以固定跑它。
     C3 不是 open 关，零进度下进不去——先把前面几关标成已通关，
     否则 enterLevel 会直接返回 false，整段断言全部错位。 */
  {
    const W = window.__WAR__;
    const idx = W.LEVELS.findIndex(l => l.id === 'C3');
    W.LEVELS.slice(0, idx).filter(l => l.ready).forEach(l => W.markResult(l.id, 'win'));
    ok('推荐关卡落到岚口', W.recommendLevel() && W.recommendLevel().id === 'C3',
       W.recommendLevel() && W.recommendLevel().id);
    /* 不能 await：enterLevel 要等简报翻完 + 对话走完才 resolve，
       而翻页正是本测试接下来要做的事。await 在这里会把自己锁死。 */
    W.enterLevel('C3');
  }
  await wait(60);
  const brief = doc.getElementById('briefScreen');
  /* 断言文案一律从关卡数据里取，不在测试里抄一遍——
     改剧本时测试不该跟着改，它该自己跟着变 */
  const BP = window.__WAR__.LEVEL.story.briefing;
  ok('简报出现', !brief.classList.contains('hidden'));
  ok('关卡指针已切到岚口', window.__WAR__.LEVEL.id === 'C3', window.__WAR__.LEVEL.id);
  const t1 = brief.querySelector('.brief-title').textContent;
  ok('第一页标题与数据一致', t1 === BP.pages[0].title, t1 + ' / ' + BP.pages[0].title);
  ok('含绝密标记', brief.textContent.replace(/\s/g, '').includes('绝密'));
  ok('含三项数值', brief.querySelectorAll('.brief-nums div').length === 3);
  ok('页码第一点高亮', brief.querySelectorAll('.brief-dots i.on').length === 1);
  ok('按钮文字是继续', doc.getElementById('briefNext').textContent.indexOf('继续') >= 0);

  console.log('[3] 翻到第二页');
  doc.getElementById('briefNext').click();
  await wait(60);
  const t2 = brief.querySelector('.brief-title').textContent;
  ok('第二页标题与数据一致', t2 === BP.pages[1].title, t2 + ' / ' + BP.pages[1].title);
  const hotN = BP.pages[1].nums.filter(n => n.hot).length;
  ok('第二页红字数值个数与数据一致', brief.querySelectorAll('.brief-nums b.r').length === hotN,
     brief.querySelectorAll('.brief-nums b.r').length + ' / ' + hotN);

  console.log('[4] 翻到第三页');
  doc.getElementById('briefNext').click();
  await wait(60);
  const t3 = brief.querySelector('.brief-title').textContent;
  ok('第三页标题与数据一致', t3 === BP.pages[2].title, t3 + ' / ' + BP.pages[2].title);
  ok('末页按钮改名接管指挥', doc.getElementById('briefNext').textContent.indexOf('接管指挥') >= 0);

  console.log('[5] 末页点击 → 对话过场，纸张仍在（当暗背景）');
  doc.getElementById('briefNext').click();
  await wait(120);
  const cs = doc.getElementById('cutscene');
  /* 比对文案时两边都去掉空白：打字机逐字渲染，中间会夹 span 与换行 */
  const hasTxt = (el, s) => el.textContent.replace(/\s/g, '')
    .indexOf(String(s).replace(/\s/g, '')) >= 0;
  ok('剧情卡出现', !cs.classList.contains('hidden'));
  ok('纸张未收起（防止闪地图）', !brief.classList.contains('hidden'));
  ok('第一句说话人与数据一致', hasTxt(cs, BP.beats[0].who), BP.beats[0].who);
  /* 司令部那句是「电话」，走符号位而不是"立绘位"占位字。
     这两条要成对断言：只查有没有 svg，会把"退化成占位字"也放过。 */
  const hqPort = cs.querySelector('.cs-portrait');
  ok('数据上第一句就是符号位', BP.beats[0].portrait === 'portHQ');
  ok('司令部走符号位', !!hqPort && hqPort.classList.contains('sig'));
  ok('符号位有内置电台图标', !!cs.querySelector('.cs-portrait.sig svg'));
  ok('符号位不显示占位字', cs.textContent.indexOf('立绘位') < 0);
  /* 打字机是逐字的，先点一下把整句显示完再断言文本 */
  cs.click();
  await wait(60);
  ok('第一句台词打完', hasTxt(cs, BP.beats[0].text.slice(-8)), BP.beats[0].text.slice(-8));

  console.log('[6] 第二句切到人物立绘位');
  cs.click();                       // 打完这句 → 下一句
  await wait(160);
  const cs2 = doc.getElementById('cutscene');
  ok('第二句说话人与数据一致', hasTxt(cs2, BP.beats[1].who), BP.beats[1].who);
  const p2 = cs2.querySelector('.cs-portrait');
  ok('旅长走立绘位不是符号位', !!p2 && !p2.classList.contains('sig'));
  ok('无素材时退化为占位字', cs2.textContent.indexOf('立绘位') >= 0);

  console.log('[7] 连点走完三段对话');
  for (let i = 0; i < 6; i++) {
    const el = doc.getElementById('cutscene');
    if (el && !el.classList.contains('hidden')) el.click();
    await wait(120);
  }
  await wait(200);
  ok('对话已结束', doc.getElementById('cutscene').classList.contains('hidden'));
  ok('简报已收起', brief.classList.contains('hidden'));
  ok('简报 DOM 已清空', brief.innerHTML === '');

  console.log('[8] 已进入战场');
  ok('棋盘已渲染', doc.getElementById('board').innerHTML.length > 500);
  ok('顶栏版本号存在', /v\d+\.\d+/.test(doc.getElementById('verTag').textContent));

  console.log('[9] 设置与战时手册入口');
  {
    const W = window.__WAR__;
    /* v4.18 起顶栏没有 HQ 按钮了：手册从设置 ⚙ 里的快捷按钮进。
       这里按玩家的真实路径走一遍：点设置 → 点「兵种图鉴」。 */
    doc.getElementById('btnSet').click();
    await wait(40);
    const set = doc.getElementById('setScreen');
    ok('设置面板打开', !set.classList.contains('hidden'));
    doc.querySelector('#setHqBtns button[data-hqopen="dex"]').click();
    await wait(60);
    const hq = doc.getElementById('hqScreen');
    ok('点快捷按钮打开战时手册', !hq.classList.contains('hidden'));
    ok('设置面板已收起（两层遮罩不同时叠着）', set.classList.contains('hidden'));
    ok('默认停在兵种图鉴', doc.getElementById('hqBody').textContent.indexOf('轻型坦克营') >= 0);
    ok('图鉴覆盖到重坦', doc.getElementById('hqBody').textContent.indexOf('重型坦克营') >= 0);
    /* 配牌不在手册里了（cards.html 独立页面），页签里不该再有「战术卡」 */
    ok('手册页签里没有战术卡页', !doc.querySelector('#hqTabs button[data-tab="cards"]'));

    doc.querySelector('#hqTabs button[data-tab="aide"]').click();
    await wait(50);
    const qs = doc.querySelectorAll('#hqBody .aide-q');
    ok('副官有问答条目', qs.length >= 8, qs.length + ' 条');
    qs[0].querySelector('button').click();
    await wait(30);
    ok('点条目能展开答案', qs[0].classList.contains('open'));

    doc.querySelector('#hqTabs button[data-tab="save"]').click();
    await wait(50);
    ok('存档页有两个按钮',
       doc.querySelectorAll('#hqBody [data-saveact]').length === 2);

    doc.getElementById('hqClose').click();
    await wait(40);
    ok('HQ 面板可关闭', hq.classList.contains('hidden'));
  }

  console.log('[10] 地图内作业气泡');
  {
    const W = window.__WAR__;
    const box = doc.getElementById('unitOps');
    /* 不写死兵牌编号：以前这里找的是 B2E，换一关 / 换编制就变成 undefined，
       报错信息是"cannot read properties of undefined"——查了半天才知道是测试绑了具体单位。
       现在按"谁能布雷"筛，编制怎么改都能找到。 */
    const eng = W.getState().units.find(
      u => u.side === 'blue' && W.unitOps(u).some(o => o.act === 'mine' && !o.dis));
    ok('本关有能布雷的工兵', !!eng, eng ? eng.name : '没找到');
    if (!eng) { console.log('（后面几项跳过）'); }
    else {
      W.select(eng);
      await wait(60);
      /* 选中默认是收起态：只有一个"作业 N"的小入口。
         整组按钮铺开会压住周围两三格，而那几格正是本回合能走的格——
         用户反馈的"菜单挡住可移动格子"就是它。 */
      ok('选中工兵后气泡出现', !box.classList.contains('hidden'));
      ok('选中态是收起的小入口', box.classList.contains('mini') &&
         !!box.querySelector('button[data-op="__open"]'));
      ok('收起态不铺开按钮', box.querySelectorAll('button[data-op^="fort:"]').length === 0);

      box.querySelector('button[data-op="__open"]').click();
      await wait(60);
      ok('点「作业」展开整组按钮', !box.classList.contains('mini'));
      ok('气泡列出工事选项', box.querySelectorAll('button[data-op^="fort:"]').length >= 2);
      ok('气泡有布雷与架桥',
         !!box.querySelector('button[data-op="mine"]') &&
         !!box.querySelector('button[data-op="bridge"]'));

      const fbtn = box.querySelector('button[data-op="fort:H"]');
      fbtn.click();
      await wait(40);
      ok('点工事按钮进入施工模式', W.getState().mode === 'fort');
      const n0 = W.getState().forts.length;
      W.onHexClick(eng.pos[0], eng.pos[1]);
      await wait(40);
      ok('再点格子完成施工', W.getState().forts.length === n0 + 1);

      /* 打完仗（fired）之后不该再出现行动按钮 */
      W.select(eng);
      await wait(40);
      ok('行动耗尽后气泡自动收起', box.classList.contains('hidden'));

      /* ── 取消选中的三条路 ──
         以前只有"点一块走不到的地面"这一条，用户反馈的就是这个。
         挑一个**独占格子**的单位：堆叠格上点自己是"轮换到下一支"，
         那是另一条规则，混在这里会把断言弄成"有时红有时绿"。 */
      const pool = W.getState().units.filter(x => x.side === 'blue' && !x.moved && !x.fired);
      const any = pool.find(x => pool.filter(y =>
        y.pos[0] === x.pos[0] && y.pos[1] === x.pos[1]).length === 1);
      if (any) {
        const press = k => window.dispatchEvent(new window.KeyboardEvent('keydown',
          { key: k, bubbles: true }));

        W.select(any);
        await wait(40);
        ok('取消选中前确实选着', W.getState().selected === any);
        W.onHexClick(any.pos[0], any.pos[1]);   // 点自己
        await wait(40);
        ok('点自己取消选中', W.getState().selected === null);
        ok('取消后气泡消失', box.classList.contains('hidden'));

        /* Esc：走真实键盘事件，别只测 deselect() 这个函数 */
        W.select(any);
        await wait(40);
        press('Escape');
        await wait(40);
        ok('Esc 取消选中', W.getState().selected === null);

        /* 展开气泡时按 Esc 只收气泡，不取消选中——一次清两层太狠 */
        W.select(any);
        await wait(40);
        const op = box.querySelector('button[data-op="__open"]');
        if (op) {
          op.click();
          await wait(40);
          press('Escape');
          await wait(40);
          ok('Esc 先收气泡', box.classList.contains('mini'));
          ok('收气泡时不丢选中', W.getState().selected === any);
          W.onHexClick(any.pos[0], any.pos[1]);
          await wait(40);
        }
      } else {
        ok('找得到独占格子的可动单位（用于测取消选中）', false, '全是堆叠');
      }
    }

    /* 辎重队：建补给点是气泡里的专属项 */
    const sup = W.getState().units.find(u => u.type === 'sup' && u.side === 'blue');
    if (sup) {
      W.select(sup);
      await wait(40);
      const op2 = box.querySelector('button[data-op="__open"]');
      if (op2) { op2.click(); await wait(40); }
      ok('辎重队气泡有建立补给点', !!box.querySelector('button[data-op="depot"]'));
      box.querySelector('button[data-op="depot"]').click();
      await wait(60);
      ok('点一下直接建好补给点',
         W.getState().depots.some(d => d.r === sup.pos[0] && d.c === sup.pos[1]));
    } else {
      skip('本关没有辎重队，跳过补给点气泡', '该关无辎重队');
    }
  }

  console.log('[10b] 行动菜单里的「移动」「取消」');
  /* 用户提的：菜单里要能直接点「移动」，并且要有明确的「取消」。
     这不是重构，是界面缺了入口——所以要测"点下去发生了什么"，
     光断言"按钮在不在"会漏掉点了没反应这类问题。
     顺手把「收起 ≠ 取消」也钉住：这两个键合并成一个，
     总有一种意图没出口（想瞄地图就得重选 / 想退出却退不干净）。 */
  {
    const W = window.__WAR__;
    const box = doc.getElementById('unitOps');
    /* 不按 type === 'inf' 筛：这几关的步兵叫 gdn / mech / marm，
       写死兵种键会让"找得到"变成"永远找不到"，而报错里只写着"没找到"，
       查半天不知道是没这种兵还是筛错了（第一次就踩了）。
       按语义筛更稳：菜单里只剩「移动」一项 = 一支没有工程 / 火炮能力的普通部队。 */
    const onlyMove = u => W.unitOps(u).length === 1 && W.unitOps(u)[0].act === 'move';
    const inf = W.getState().units.find(
      u => u.side === 'blue' && !u.moved && !u.fired && onlyMove(u));
    ok('找得到一支只会移动的单位', !!inf, inf ? inf.name : '没找到');
    if (inf) {
      W.select(inf);
      await wait(40);
      ok('这种单位选中也有行动入口（以前只有工兵 / 炮兵才有气泡）',
         !box.classList.contains('hidden'));

      /* 可达范围不再"选中就亮"：没点「移动」之前地图上不该出现蓝格。
         这条不只是观感——范围常亮时气泡怎么摆都在圈里，只能往远处飘（260px），
         菜单离开兵牌两个身位，玩家得靠标题认单位。
         现在"范围可见 ⟺ 移动模式"，气泡也就不用躲蓝圈了。 */
      const moveCells = () => doc.querySelectorAll('#board .hex.move').length;
      ok('未点「移动」时不点亮可达范围', moveCells() === 0, moveCells() + ' 格');

      /* 点按钮的辅助：找不到就返回 null、不抛异常。
         上一版这里是裸 .click()，一旦"进移动模式没收起菜单"这条坏了，
         下一个 __open 就成了 null，整段测试直接抛出去——后面十几条断言
         一条都不跑，报告里只剩一行 TypeError，看不出到底坏了哪些东西。 */
      const tap = async act => {
        const b = box.querySelector('button[data-op="' + act + '"]');
        if (b) { b.click(); await wait(40); }
        return b;
      };

      await tap('__open');
      const mv = box.querySelector('button[data-op="move"]');
      ok('菜单里有「移动」', !!mv);
      ok('「移动」标出剩余机动', mv && /点/.test(mv.textContent), mv && mv.textContent);

      await tap('move');
      ok('点「移动」进入移动模式', W.getState().mode === 'move');
      ok('点「移动」之后可达范围点亮', moveCells() > 0, moveCells() + ' 格');
      /* 菜单必须同时收成小胶囊：展开态高 250px，正好压在刚点亮的圈上，
         "点了移动却被自己挡住"就是这么来的。 */
      ok('进移动模式后菜单收成小入口', box.classList.contains('mini'));
      ok('小入口改口成「移动中」', /移动中/.test(box.textContent), box.textContent);

      await tap('__open');
      const mv2 = box.querySelector('button[data-op="move"]');
      ok('移动模式下按钮高亮', !!mv2 && mv2.classList.contains('on'));
      ok('移动模式给出下一步提示', /点蓝格/.test(box.textContent));

      /* Esc 是两层：先收面板，再退模式，选中始终留着。
         气泡此刻已经展开，所以要按两下——这也正是层级正确的证据。 */
      const press = () => window.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      press();
      await wait(40);
      ok('移动模式里 Esc 先收面板',
         box.classList.contains('mini') && W.getState().mode === 'move');
      press();
      await wait(40);
      ok('Esc 退出移动模式', W.getState().mode === null);
      ok('Esc 退模式时保留选中', W.getState().selected === inf);
      ok('Esc 退出后范围收回', moveCells() === 0, moveCells() + ' 格');

      /* 再点一次也能退（按钮是开关，单点误触不会卡在模式里） */
      await tap('__open');
      await tap('move');
      ok('再点一次进入移动模式', W.getState().mode === 'move');
      await tap('__open');
      await tap('move');
      ok('再点一次退出移动模式', W.getState().mode === null);

      const cb = await tap('__cancel');
      ok('菜单里有「取消」', !!cb);
      ok('「取消」清掉选中', W.getState().selected === null);
      ok('「取消」后气泡收起', box.classList.contains('hidden'));

      /* 收起 ≠ 取消 */
      W.select(inf);
      await wait(40);
      await tap('__open');
      const closeBtn = await tap('__close');
      ok('菜单里有「收起」', !!closeBtn);
      ok('「收起」保留选中', W.getState().selected === inf);
      ok('「收起」后回到小入口', box.classList.contains('mini'));

      /* 视图变换后必须重算位置：气泡是 position:fixed，棋盘是 transform 平移缩放，
         两者不会一起动。把 left 揉成一个假值再刷一次视图，看它会不会被算回来。
         少了这一步，手机上拖动地图时气泡会死钉在屏幕上，像"跑到别的格子上去了"。 */
      box.style.left = '-999px';
      W.view.applyView();
      await wait(20);
      ok('视图刷新后气泡重新定位', box.style.left !== '-999px', box.style.left);

      /* 窄屏把它钉成底部横条（inline bottom:10px），转回宽屏时必须清掉。
         不清的话 bottom 和 top 同时生效，90px 高的胶囊会被拉成一整条竖白框。 */
      box.style.bottom = '10px';
      box.style.maxWidth = '200px';
      W.view.applyView();
      await wait(20);
      ok('转回宽屏后清掉窄屏残留的 bottom / maxWidth',
         box.style.bottom === '' && box.style.maxWidth === '',
         box.style.bottom + ' / ' + box.style.maxWidth);

      W.onHexClick(inf.pos[0], inf.pos[1]);       // 收尾：清掉选中
      await wait(40);
    }
  }

  console.log('[11] 不带参数直接打开引擎（没人告诉它进哪一关）');
  /* 开始页撤掉之后，"双击 campaign.html"这条路就只剩一句话：自己挑推荐关。
     它不在任何自动化路径上（load.js 传 __FAST__，直接跳到 newGame），
     所以专门开一个干净的 jsdom 实例验一次——这里要是坏了，
     玩家双击引擎看到的就是一片空棋盘，而测试全绿。 */
  {
    const dom2 = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'http://127.0.0.1/game/campaign.html'
    });
    const d2 = dom2.window.document;
    await wait(500);
    const W2 = dom2.window.__WAR__;
    ok('引擎自己选了一关', !!W2 && !!W2.LEVEL, W2 && W2.LEVEL && W2.LEVEL.id);
    ok('选的是推荐关', W2.recommendLevel() && W2.recommendLevel().id === W2.LEVEL.id,
       W2.LEVEL.id);
    const b2 = d2.getElementById('briefScreen');
    ok('推荐关的简报已经弹出来', !b2.classList.contains('hidden'));
    const skip = d2.getElementById('briefSkip');
    ok('有跳过按钮', !!skip);
    if (skip) {
      skip.click();
      await wait(120);
      ok('跳过后简报收起', b2.classList.contains('hidden'));
    } else {
      ok('跳过后简报收起', false, '找不到跳过按钮');
    }
    await wait(120);
    ok('棋盘已渲染', d2.getElementById('board').innerHTML.length > 500);
    dom2.window.close();
  }

  console.log('[12] 菜单页的「存档管理」（?hq=1）');
  /* 开始页撤掉之后，导出 / 导入的唯一入口就是这一条。
     它必须① 真的打开 HQ ② 停在存档页 ③ 不写档（noSave），
     第三条最容易被忽略：静默开局如果顺手落了存档，
     玩家只是想导个档，回来却发现上一局进度被覆盖了。 */
  {
    const dom3 = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'http://127.0.0.1/game/campaign.html?hq=1'
    });
    const d3 = dom3.window.document;
    await wait(400);
    const W3 = dom3.window.__WAR__;
    ok('HQ 直接打开', !d3.getElementById('hqScreen').classList.contains('hidden'));
    ok('停在存档页', !!d3.querySelector('#hqTabs button[data-tab="save"].on'));
    ok('存档页有导出 / 导入两个按钮',
       d3.querySelectorAll('#hqBody [data-saveact]').length === 2);
    ok('没有写档', !W3.readSave());

    /* XSS 的真正防线在这里，不在 selftest 里那条。
       selftest 断言的是 applySaveFile 返回的 msg 不含 <b>——但 msg 里从来
       不会有 <b>，那个标签是渲染端拼的。也就是说：哪天有人把 hqSaveNote
       改回 innerHTML，selftest 那条依然全绿，漏洞照样复活。
       所以这里必须真调一次渲染函数，看 DOM 里到底有没有长出标签。
       注意 textContent 赋值后 innerHTML 会把 < 转成 &lt;，
       所以"不含 <img"这个断言在正确实现下通过、在 innerHTML 实现下失败。 */
    const noteEl = d3.getElementById('hqSaveNote');
    if (noteEl && typeof W3.hqSaveNote === 'function') {
      W3.hqSaveNote('<img src=x onerror=alert(1)>', false);
      const raw = noteEl.innerHTML;
      ok('渲染端不产生 HTML 标签（textContent 而非 innerHTML）',
         raw.indexOf('<img') < 0 && raw.indexOf('&lt;img') >= 0, raw.slice(0, 60));
      ok('恶意文本仍被完整回显（靠转义而不是靠删掉）',
         noteEl.textContent.indexOf('onerror') >= 0);
    } else {
      ok('渲染端不产生 HTML 标签（textContent 而非 innerHTML）', false,
         '拿不到 hqSaveNote / #hqSaveNote，防线无法验证');
    }
    dom3.window.close();
  }

  console.log('[13] 恶意文本打不进 DOM（走真实渲染路径，不是读提示文案）');
  /* 这一节和 selftest [31] 是两道不同的锁，不能互相顶替：
     [31] 验的是**入口**把坏档挡在门外；这里验的是**出口**——
     坏字符串从别的地方进来（老版本存的档、将来新加的字符串源）时，
     渲染层会不会把它当代码执行。v4.6 体检时在真浏览器里实测过：
     不加 esc 的版本 pwn1=1，脚本真的跑了。

     做法是**绕过 validateSave**，直接往内存里的 state 塞 payload，
     再走 render() 这条真路径。走导入接口的话入口那道锁会先把档拒掉，
     这条断言就永远绿——绿得毫无意义，正是 docs/10 记的那个坑。

     jsdom 不加载外部资源，<img onerror> 不会真的触发，
     所以这里断言的是 **DOM 结构**（有没有长出 img / onerror 属性），
     不是"脚本有没有跑"。结构对了，真浏览器里也就跑不了。 */
  {
    const W = window.__WAR__;
    const payload = '"><img src=x onerror="window.__pwn=1">';
    W.newGame({ noSave: true });
    const st = W.getState();
    ok('前提：新开一局有部队', !!(st && Array.isArray(st.units) && st.units.length));
    const u = st.units.find(x => x.side === 'blue');
    ok('前提：找得到我方部队', !!u, '蓝方一个单位都没有');

    if (u) {
      const oldName = u.name, oldAbbr = u.abbr;
      u.name = payload;
      u.abbr = payload;
      W.render();

      const board = doc.getElementById('board');
      ok('棋盘里没有长出 <img>', board.querySelectorAll('img').length === 0,
         '多了 ' + board.querySelectorAll('img').length + ' 个 img');
      ok('棋盘里没有 onerror 属性（引号没截断属性）',
         board.querySelectorAll('[onerror]').length === 0);
      /* **不要用 innerHTML.indexOf('<img') 判这件事。** 属性值里的 `<`
         按 HTML 规范本来就不用转义，jsdom / Chrome 都会把它原样吐出来：
         title 里那段 `&quot;><img ...` 是**文本**，不是元素。
         上一版就是这么写的，结果正确实现被判成失败（踩过一次，记在这里）。
         真正能判的是结构：有没有 IMG 元素、有没有 onerror 属性、span 里的
         textContent 是不是整串 payload。 */
      /* 按 title 精确定位那张兵牌。直接 querySelector('.unit .n') 取的是
         棋盘上第一支部队（可能是敌方的"3炮"），测的根本不是被改过的那张。 */
      const card = Array.from(board.querySelectorAll('.unit'))
        .find(e => e.getAttribute('title') === payload);
      const nSpan = card && card.querySelector('.n');
      ok('兵牌简称以纯文本显示（转义而不是删掉）',
         !!nSpan && nSpan.textContent === payload,
         nSpan ? JSON.stringify(nSpan.textContent.slice(0, 40)) : '没找到被改过的那张兵牌');
      /* 整串 payload 原样落在 title 里，说明 `"` 被转成了 &quot;；
         没转的话这里会变成 "（引号提前收尾）。 */
      ok('兵牌 title 完整保留 payload（走的是转义，不是截断）', !!card);

      /* 单位面板：ub-name 也是拼进 innerHTML 的 */
      W.select(u);
      const ub = doc.getElementById('unitBox');
      ok('单位面板里没有长出 <img>', ub.querySelectorAll('img').length === 0);
      const nm = ub.querySelector('.ub-name');
      ok('单位面板把兵牌名当文本显示', !!nm && nm.textContent === payload,
         nm ? nm.textContent.slice(0, 40) : '没找到 .ub-name');

      /* 战报：renderLog 先 esc 再 bold，cls 走白名单 */
      st.log.push({ t: 'x', cls: 'b" onload="window.__pwn2=1', text: payload });
      W.render();
      const logEl = doc.getElementById('log');
      ok('战报里没有长出 <img>', logEl.querySelectorAll('img').length === 0);
      ok('战报恶意文本仍完整回显', logEl.textContent.indexOf('onerror') >= 0);
      const lastRow = logEl.lastElementChild;
      ok('战报的 cls 走白名单（不认识的一律当普通行）',
         !!lastRow && lastRow.className === '', lastRow ? lastRow.className : '没有战报行');

      /* 战报唯一的文案通道是 bold()，而且它和 esc 在同一条路径上。
         两条断言必须一起有：只验第 1 条（星号变 <b>）的话，
         把 esc 删掉照样绿——那正好是 XSS 的形状；只验第 2 条（保存原样），
         把 bold 删掉也照样绿。分开验，两个都少不得。 */
      st.log.push({ text: '前 **重点** 后', cls: 'sys' });
      st.log.push({ text: '<b>不该加粗</b>', cls: 'sys' });
      W.render();
      const rows2 = doc.getElementById('log').children;
      const rowB = rows2[rows2.length - 2], rowT = rows2[rows2.length - 1];
      ok('战报里的 **重点** 渲染成 <b>（不是星号）',
         !!rowB && !!rowB.querySelector('b') && rowB.querySelector('b').textContent === '重点',
         rowB ? JSON.stringify(rowB.innerHTML.slice(0, 60)) : '没有这一行');
      ok('战报里的 <b> 字面量仍是文本（先 esc 再 bold，顺序不能反）',
         !!rowT && rowT.querySelectorAll('b').length === 0 && rowT.textContent === '<b>不该加粗</b>',
         rowT ? JSON.stringify(rowT.textContent) : '没有这一行');
      st.log.pop(); st.log.pop();

      /* 收拾干净：后面的收尾检查还要用这局 state */
      st.log.pop();
      u.name = oldName;
      u.abbr = oldAbbr;
      W.render();
    }
    ok('干净数据下棋盘仍能正常渲染', doc.querySelectorAll('#board .hex, #board [class]').length > 0);
  }

  console.log('[14] 存档写失败时玩家能看见（顶栏胶囊 + 点进去是导出页）');
  /* selftest [32] 测的是 state.saveBroken 这个**标记**，测不到玩家眼睛能看到什么。
     这里走真 DOM：把 localStorage 掐掉 → 存档失败 → 顶栏胶囊必须从 none 变成可见，
     而且点它要真的跳到 HQ 的存档页（导出是唯一出路：写不进去的时候读也是空的，
     做一个"重试保存"按钮只会让玩家连点十次都是失败）。

     jsdom 的 localStorage 是 Window 原型上的 getter，`delete` 不掉，
     要在 window 上盖一个自己的属性把它遮住。测完必须还原——
     后面别的脚本还要用，而且掩盖着的话会让人以为"存档功能坏了"。 */
  {
    const W = window.__WAR__;
    const el = doc.getElementById('saveWarn');
    ok('前提：正常情况下顶栏没有存档异常胶囊',
       !!el && el.style.display === 'none', el ? el.style.display : '没有 #saveWarn');

    if (el) {
      const realLS = window.localStorage;
      Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true, writable: true });
      let wrote;
      try { wrote = W.saveGame(); } finally {
        Object.defineProperty(window, 'localStorage', { value: realLS, configurable: true, writable: true });
      }
      ok('写不进去时 saveGame 返回 false', wrote === false, String(wrote));
      ok('顶栏胶囊亮起来', el.style.display !== 'none', JSON.stringify(el.style.display));
      ok('胶囊文案说清了是什么事', /存档/.test(el.textContent), el.textContent);

      /* 点之前先把 hqTab 挪开。hqTab 是模块级变量，前面几节切过档，
         直接点的话"存档页那个 .on"可能是上一节留下的——
         HQ 压根没打开它也是绿的，那这条断言就没有意义了。
         变异自检抓到过这一幕：删掉 openHQ('save') 之后它照样绿。 */
      W.openHQ('dex');
      W.closeHQ();
      el.click();
      ok('点胶囊打开 HQ', !doc.getElementById('hqScreen').classList.contains('hidden'));
      ok('点胶囊落在存档页（导出是唯一出路）',
         !!doc.querySelector('#hqTabs button[data-tab="save"].on') &&
         !doc.querySelector('#hqTabs button[data-tab="dex"].on'));
      W.closeHQ();

      /* 存储恢复后胶囊要自己消失。清不掉的后果是"一次抖动永久报警"，
         玩家学会无视它，真出问题那天也看不见。 */
      ok('存储恢复后重新存档成功', W.saveGame() === true);
      ok('重新存成功后胶囊自己收起', el.style.display === 'none', JSON.stringify(el.style.display));
    }
  }

  console.log('[15] 可访问性：页面允许浏览器缩放');
  /* WCAG 1.4.4 要求内容在 200% 缩放下可用，`maximum-scale=1` / `user-scalable=no`
     是明确违规的写法。棋盘自己需要手势，但那是 #boardView { touch-action:none }
     的事，不该拿整页缩放去换。
     这条是**回归护栏**：这行 meta 很容易在"修手机手势"的时候被顺手加回去，
     而它的代价（低视力用户无法放大）在开发机上一点都看不出来。 */
  {
    const mv = doc.querySelector('meta[name="viewport"]');
    ok('前提：找得到 viewport', !!mv);
    if (mv) {
      const c = mv.getAttribute('content') || '';
      ok('viewport 没有禁掉用户缩放', !/user-scalable\s*=\s*no/i.test(c), c);
      ok('viewport 没有锁死最大缩放倍数', !/maximum-scale/i.test(c), c);
      ok('viewport 仍然适配刘海屏', /viewport-fit\s*=\s*cover/i.test(c), c);
    }
    /* 棋盘的手势限制要落在棋盘自己身上，不是整页。
       jsdom 的 getComputedStyle 不认识 touch-action（会返回 undefined），
       所以这条退一步查样式表原文——弱一点，但至少不是"元素存在就算过"。
       v4.8 把样式拆到 game/campaign.css 之后，这里必须跟着改成读文件：
       jsdom 不开 resources:'usable' 就不加载外部样式表，`<style>` 已经一个都没有，
       继续读 DOM 只会拿到空串，让这条断言永远红（或者更糟：被改成恒真）。
       读文件反而比读 DOM 多验一层——CSS 文件丢了、路径写错了，这里也会红。 */
    const cssPath = require('path').join(__dirname, '..', 'game', 'campaign.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    ok('棋盘元素单独关掉浏览器手势（#boardView 上写了 touch-action:none）',
       /#boardView\s*\{[^}]*touch-action\s*:\s*none/.test(css));
    /* 样式表真的被引进来。少了这一条，href 写错（或者拆文件时漏了 <link>）
       会让页面变成一坨没有样式的裸文本，而所有断言照样绿——因为断言读的是磁盘。 */
    const link = doc.querySelector('link[rel="stylesheet"][href*="campaign.css"]');
    ok('页面引了 campaign.css（不是靠 <style> 内联）', !!link,
       link ? link.getAttribute('href') : '没有 <link rel="stylesheet">');
  }

  console.log('[16] HQ 四页签真 UI 覆盖（这一块在四个脚本里一个都没跑到）');
  /* renderHQ() 是**唯一的存档出入口**（导出 / 导入都在存档页），
     但在这一节之前，没有任何脚本跑过它的 DOM：briefcheck [12] 直接调
     hqSaveNote()，把整块 HQ 跳过去了。用 V8 覆盖度量出来是 0 次执行。
     所以这里把四个页签逐个点开，验"内容真的换掉了"和"每条规则都在界面上成立"。 */
  {
    const W = window.__WAR__;
    const hq = doc.getElementById('hqScreen');
    const body = doc.getElementById('hqBody');
    const tab = t => doc.querySelector('#hqTabs button[data-tab="' + t + '"]');

    W.openHQ('dex');
    ok('HQ 打开', !hq.classList.contains('hidden'));
    ok('兵种图鉴有分组', body.querySelectorAll('.hq-group').length >= 3,
       body.querySelectorAll('.hq-group').length + ' 组');
    ok('兵种图鉴列出了兵种卡', body.querySelectorAll('.dex').length >= 10,
       body.querySelectorAll('.dex').length + ' 张');
    ok('图鉴用的是当前关卡（不是写死某一关）',
       body.textContent.indexOf(W.LEVEL.name) >= 0, W.LEVEL.name);
    /* 加粗必须在**渲染结果**上验，不能只验数据：这些 **重点** 原本是原样
       拼进 DOM 的，玩家在手机上看兵种说明时满屏星号。数据侧一个字没改，
       改的是渲染口——所以断言的落点也必须是渲染口。
       反向验证：把 bold() 改成恒等函数，这两条一起红。 */
    ok('图鉴里的加粗真的渲染成 <b>（不是露星号）',
       body.querySelectorAll('.dex li b').length > 0,
       body.querySelectorAll('.dex li b').length + ' 处');
    ok('图鉴文本里不留 ** 标记', body.textContent.indexOf('**') < 0);

    tab('save').click();
    ok('切页签后旧内容被换掉（不是叠在一起）', body.querySelectorAll('.dex').length === 0);
    ok('存档页有两个动作按钮（导出 / 导入）',
       body.querySelectorAll('[data-saveact]').length === 2);
    ok('存档页写清了"导入会覆盖本机存档"', /覆盖/.test(body.textContent));

    const aideN = (W.AIDE || []).length;
    tab('aide').click();
    ok('副官页渲染出全部问答', body.querySelectorAll('.aide-q').length === aideN,
       body.querySelectorAll('.aide-q').length + ' / ' + aideN);
    ok('每条问答都有正文',
       Array.from(body.querySelectorAll('.aide-a')).every(e => e.textContent.trim().length > 0));

    /* 页签同屏只能有一个选中态。两个都带 .on 的话玩家分不清自己在哪一页 */
    ok('同时只有一个页签是选中态',
       doc.querySelectorAll('#hqTabs button.on').length === 1,
       doc.querySelectorAll('#hqTabs button.on').length + ' 个');

    /* HQ_TABS 是菜单页跳页签（?hq=dex）的白名单，必须和 DOM 里的按钮一一对应。
       少一个 id，菜单页的「战时手册」就会被当成非法值、静默落回存档页——
       玩家点了"手册"却看见存档页，不会报错，只会觉得点错了。 */
    const domTabs = Array.from(doc.querySelectorAll('#hqTabs button'))
      .map(b => b.getAttribute('data-tab'));
    ok('HQ_TABS 与页签按钮一一对应',
       W.HQ_TABS.length === domTabs.length &&
       domTabs.every(t => W.HQ_TABS.indexOf(t) >= 0),
       W.HQ_TABS.join(',') + ' / ' + domTabs.join(','));

    W.closeHQ();
    ok('关掉 HQ 后遮罩收起', hq.classList.contains('hidden'));
    ok('关掉 HQ 后内容被清掉（不留在 DOM 里）', body.innerHTML === '');
  }

  console.log('');
  console.log('[17] 存档导入：每条失败分支都要在写档之前拦住');
  {
    const W = window.__WAR__;
    /* 为什么连 localStorage 一起看：只断言返回值不够。
       真正会毁档的是"先写了一部分、后一半才发现不对"——返回值照样 ok:false，
       本机存档却已经被污染了，玩家只会觉得"我导了个坏文件，怎么原来的档也没了"。 */
    const good = W.saveSnapshot();
    const pack = { app: W.SAVE_FILE_APP, kind: 'save', v: W.SAVE_VER, save: good };
    const r0 = W.importSaveText(JSON.stringify(pack));
    ok('好档能导入', r0.ok, r0.msg);
    const base = window.localStorage.getItem(W.SAVE_KEY);
    ok('导入成功后本机存档里真的有内容', !!base);

    const r1 = W.importSaveText('{ 这不是 JSON');
    ok('坏 JSON：拒绝并说明是 JSON 的问题', !r1.ok && /JSON/.test(r1.msg), r1.msg);
    ok('坏 JSON：本机存档原封不动', window.localStorage.getItem(W.SAVE_KEY) === base);

    const r2 = W.applySaveFile({ app: '别的东西', kind: 'save', v: W.SAVE_VER });
    ok('不是本作的存档：拒绝', !r2.ok && /苍屿战役/.test(r2.msg), r2.msg);

    const r3 = W.applySaveFile({ app: W.SAVE_FILE_APP, kind: 'save', v: 999 });
    ok('版本不符：拒绝，且提示里能看见两个版本号',
       !r3.ok && /999/.test(r3.msg) && r3.msg.indexOf(String(W.SAVE_VER)) >= 0, r3.msg);

    /* 入口那道内容校验：名字里带尖括号的档必须挡在门外（渲染端另有一道，见 [13]） */
    const bad = JSON.parse(JSON.stringify(pack));
    if (bad.save && bad.save.units && bad.save.units.length) {
      bad.save.units[0].name = '<img src=x onerror=alert(1)>';
      const r4 = W.applySaveFile(bad);
      ok('内容非法（名字带标签）：拒绝', !r4.ok, r4.msg);
      ok('内容非法：本机存档没被替换', window.localStorage.getItem(W.SAVE_KEY) === base);
    } else {
      ok('内容非法（名字带标签）：拒绝', false, 'saveSnapshot() 里没有 units，造不出坏档');
    }

    /* 没有 save 字段是合法形态：只导进度（"重置到某一关"就是靠这个） */
    const r5 = W.applySaveFile({ app: W.SAVE_FILE_APP, kind: 'save', v: W.SAVE_VER, progress: {} });
    ok('没有战斗存档的文件也能导入（只导进度）', r5.ok, r5.msg);
  }

  console.log('');
  console.log('[18] 棋盘键盘化：方向键 / 回车 / 焦点归属');
  {
    const W = window.__WAR__;
    W.newGame({ noSave: true });
    const board = doc.getElementById('board');
    ok('棋盘可聚焦（tabindex=0）', board.getAttribute('tabindex') === '0');
    ok('棋盘声明了 role 与用途说明',
       board.getAttribute('role') === 'application' &&
       /方向键/.test(board.getAttribute('aria-label') || ''));

    W.setKbCur(null);
    doc.getElementById('btnTips').focus();   // 先离开棋盘，确保下面 focus 真的触发事件
    board.focus();
    ok('Tab 进棋盘时自动落到一格（不是一片空白）', Array.isArray(W.getKbCur()),
       String(W.getKbCur()));
    ok('光标格画出来了（.kbcur 只有一个）',
       board.querySelectorAll('.hex.kbcur').length === 1);
    ok('aria-activedescendant 指向那一格',
       board.getAttribute('aria-activedescendant') ===
         'h' + W.getKbCur()[0] + '-' + W.getKbCur()[1]);
    ok('读屏播报写进了 aria-live 区域',
       (doc.getElementById('kbSay') || {}).textContent.length > 4);

    W.setKbCur([5, 5]);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    ok('方向上 = 行 -1、列不动', W.getKbCur()[0] === 4 && W.getKbCur()[1] === 5,
       String(W.getKbCur()));
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    ok('方向右 = 列 +1', W.getKbCur()[0] === 4 && W.getKbCur()[1] === 6, String(W.getKbCur()));
    /* 只数"有没有 .kbcur"不够：render 没跑的话旧格还留着，数量照样是 1。
       必须核到坐标，否则这条在"光标根本没重画"时也是绿的。 */
    const kc = board.querySelector('.hex.kbcur');
    ok('移动后高亮落在新格上（旧格没留着）',
       board.querySelectorAll('.hex.kbcur').length === 1 && !!kc &&
       kc.dataset.r === String(W.getKbCur()[0]) && kc.dataset.c === String(W.getKbCur()[1]),
       kc ? kc.dataset.r + ',' + kc.dataset.c : '没有 .kbcur');

    /* 贴边不许绕到对面一行——那样玩家会以为地图是环形的 */
    W.setKbCur([0, 0]);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    ok('顶到边界就停住，不绕到对面', W.getKbCur()[0] === 0 && W.getKbCur()[1] === 0,
       String(W.getKbCur()));

    /* 回车 = 点这一格：走的是同一个 onHexClick，不是另写一套 */
    const mine = W.getState().units.filter(u => u.side === 'blue')[0];
    W.setKbCur(mine.pos.slice());
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok('回车选中了光标格的部队', W.getState().selected === mine,
       W.getState().selected ? W.getState().selected.name : 'null');

    /* 焦点不在棋盘上时，方向键必须不管地图——否则 Tab 到顶栏后按方向键，
       会莫名其妙地发现地图上有个光标在动 */
    W.setKbCur([5, 5]);
    doc.getElementById('btnTips').focus();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    ok('焦点在顶栏按钮时方向键不动棋盘', W.getKbCur()[0] === 5 && W.getKbCur()[1] === 5,
       String(W.getKbCur()));

    /* 对话框的基本礼貌：焦点从哪来回哪去 */
    board.focus();
    W.openHQ('dex');
    ok('打开 HQ 后焦点进了面板',
       doc.getElementById('hqScreen').contains(doc.activeElement));
    W.closeHQ();
    ok('关掉 HQ 后焦点回到棋盘', doc.activeElement === board,
       doc.activeElement.id || doc.activeElement.tagName);
  }

  console.log('[19] 防空压制要在单位面板里说得清');
  {
    /* 规则做对了、面板不说，玩家只会看到组织度每回合莫名其妙往下掉。
       这一节专门验**渲染结果**：面板里有没有那句话、数字对不对、有没有解法。 */
    const W = window.__WAR__;
    W.newGame({ level: 'C3', noSave: true });
    const S = W.getState();
    const bunker = (S.forts || []).find(f => f.kind === 'F' && f.side === 'blue');
    const fg = W.alive('red').find(u => W.isAir(u));
    ok('前提：第 3 关有阵地与敌机', !!bunker && !!fg);

    fg.pos = [bunker.r, bunker.c];
    S.selected = fg;
    W.render();
    const box = doc.getElementById('unitBox');
    ok('面板点名「被防空压制」', /被防空压制/.test(box.textContent));
    ok('面板写清了每回合掉多少（数字取自数据）',
       box.textContent.indexOf('−' + W.FORT.F.suppress.org + '%') >= 0,
       box.textContent.replace(/\s+/g, ' ').slice(0, 90));
    ok('面板给了应对（飞出去才缓得回来）', /飞出去/.test(box.textContent));

    fg.pos = [bunker.r - 5, bunker.c];      // 飞出伞下（往上，别撞地图边界）
    W.render();
    ok('飞出半径之后不再显示压制',
       !/被防空压制/.test(doc.getElementById('unitBox').textContent));
    S.selected = null;
    W.render();
  }

  console.log('[20] 顶栏副标题：章 · 关 · 类型');
  {
    const W = window.__WAR__;
    /* 进附属关要它的正关先通关。这里直接写进度而不是真打十二个回合：
       这一段验的是顶栏那一行字，跟"怎么拿到进度"无关。 */
    try {
      window.localStorage.setItem(W.PROGRESS_KEY, JSON.stringify({ cleared: { C3: 'win' } }));
    } catch (e) {}
    /* **不 await**：noIntro 之下 enterLevel 全程同步跑完（中途没有 await 点），
       await 只会把断言推到下一个宏任务，读起来更难追。 */
    W.enterLevel('C3B', { noIntro: true, noSave: true });
    ok('副标题断言的前提：进的是附属关', W.LEVEL.id === 'C3B', W.LEVEL.id);

    const sub = doc.getElementById('lvSub').textContent;
    ok('副标题先报章号', /^第 1 章 · /.test(sub), sub);
    /* 附属关的 type 本身就是「附属 · 防御」，关号文案里也有一段「附属 · 」。
       两段直接拼起来会说两遍——从 v4.7 起顶栏一直是「第 3 关 · 附属 · 附属 · 防御」，
       一直没有断言盯着它，所以一直没人发现。 */
    ok('「附属」只说一次', (sub.match(/附属/g) || []).length === 1, sub);
    ok('副标题保留了类型与日期', /防御/.test(sub) && /新历/.test(sub), sub);
  }

  console.log('[21] 结算面板报本章进度（chapterStat 的唯一调用点）');
  {
    const W = window.__WAR__;
    /* chapterStat 在 v4.8 体检里被标成死代码：它在 __WAR__ 里导出了、
       注释写着"菜单页据此决定要不要自动展开"，但**引擎里一处都没调**——
       菜单页是独立页面、读的是 data/levels.js 快照，根本用不上引擎函数。
       512 字节、0 次执行，这正是"看起来有人管，其实没人验"的形状。
       现在它唯一的位置是结算页。断言打在渲染结果（#mStats 的文本）上，
       不直接调 chapterStat——否则把 showOverlay 里那一行删掉，测试照样绿。

       这一段同时守住一个顺序陷阱：chapterStat 读进度，必须排在
       markResult 之后。排在前面就少算当前这一关（显示 0 / 5，实际 1 / 5），
       差一不报错、不崩，只有对着两个界面比才看得出来。 */
    W.writeProgress({ cleared: {}, played: {}, deck: null, last: null });
    W.enterLevel('C3B', { noIntro: true, noSave: true });
    /* 把回合推到最后一回合，让 judgeFinal 走 survive 的达成分支。
       真打十个回合只为看一行字，代价和收益不成比例。 */
    W.getState().turn = W.LEVEL.maxTurns;
    W.judgeFinal();

    const p = W.readProgress();
    ok('前提：判定把这一关写进了进度', !!p.cleared[W.LEVEL.id], JSON.stringify(p.cleared));

    const statsEl = doc.getElementById('mStats');
    const chLv = W.LEVELS.filter(l => l.ch === W.LEVEL.ch && l.ready);
    const exp = chLv.filter(l => p.cleared[l.id]).length;
    const want = exp + ' / ' + chLv.length + ' 关';
    ok('结算面板出现', !doc.getElementById('overlay').classList.contains('hidden'));
    ok('结算面板报本章进度', statsEl.textContent.indexOf('本章已达成') >= 0,
       statsEl.textContent);
    /* 分子必须**包含刚打完的这一关**：这正是 chapterStat 排在 markResult
       之前会漏掉的那一关。期望值从 readProgress() 现算，不写死数字——
       第 1 章实装关数还会变（还要补 C2B/C4B/C5/C6）。 */
    ok('本章进度的分子含刚打完的这一关',
       statsEl.textContent.indexOf(want) >= 0,
       statsEl.textContent.indexOf(want) >= 0 ? '' : '期望「' + want + '」，实为：' +
         Array.from(statsEl.querySelectorAll('.stat')).map(d => d.textContent).join(' | '));
  }

  console.log('[22] 背景音乐：指挥部换 menu 曲，关掉要接回原来那一曲');
  {
    const W = window.__WAR__;
    const FX = W.FX;
    /* 这里看的是 FX._bgmName 而不是听声音——jsdom 放不出音频。
       选它是因为它是"引擎认为现在该播哪一曲"的唯一真相：
       bgm() 同名不重播也靠它，写错了这一处，后面全都不响还不报错。 */
    const before = FX._bgmName;
    ok('前提：判定后停在结算曲', before === 'win' || before === 'lose', String(before));

    /* 底噪的三条也放这里：指挥部与战场是同一对进出点，分两段写会重复建局。
       先手动点起来模拟"仗打到一半翻档案柜"——不点的话 _ambWant 本来就是
       false，下面"进指挥部把炮声停了"是空转（写这条时第一版就是这么假绿的）。 */
    FX.amb(true);
    W.openHQ('dex');
    ok('进指挥部切到 menu 曲', FX._bgmName === 'menu', String(FX._bgmName));
    ok('进指挥部把炮声停了（menu 曲上没有垫层）', FX._ambWant === false && !!FX._ambEl,
       'want=' + FX._ambWant + ' el=' + !!FX._ambEl);

    W.closeHQ();
    /* 不能写死 'battle'：打完一关再翻一次存档页，回去该是结算曲。
       写死的话庆功曲会被无名地掐掉，换成平稳的小军鼓。 */
    ok('关掉指挥部接回结算曲（不是战斗曲）', FX._bgmName === before, String(FX._bgmName));
    /* 已分胜负就不接回炮声：结算页上说"战斗结束"、耳朵里还在轰，自相矛盾 */
    ok('已分胜负时出指挥部不接回炮声', FX._ambWant === false, 'want=' + FX._ambWant);

    /* 反过来那一半也得守：把守卫写成永不接回，上面那条照样绿。
       临时把 result 抹掉，模拟"打到一半进指挥部又出来"。 */
    const st = W.getState();
    const keepResult = st.result;
    st.result = null;
    W.openHQ('dex');
    W.closeHQ();
    st.result = keepResult;
    ok('仗没打完时出指挥部要接回炮声', FX._ambWant === true, 'want=' + FX._ambWant);
  }

  console.log('[23] 战场底噪：不能跟首屏走，打完要停');
  {
    const W = window.__WAR__;
    const FX = W.FX;
    const baseDir = path.join(path.dirname(file), W.ASSETS.base || 'assets/');

    /* 前提先立住：槽位不存在或文件缺了，下面几条会"因为没东西可测"而假绿 */
    const ambRel = (W.ASSETS.sfx || {}).amb;
    const ambFile = ambRel ? path.join(baseDir, ambRel) : '';
    ok('前提：amb 槽指向的文件存在', !!ambRel && fs.existsSync(ambFile), String(ambRel));

    /* 打完要停：**必须自己把底噪点起来再走一遍结算**，不能借前面那局的现成状态。
       第一版就是直接读 _ambWant，而 [22] 的 openHQ 也调过 amb(false)——
       删掉 showOverlay 里那一行，断言照样绿（实测过）。这正是"测不该发生的
       事，却让它被另一个原因挡住"的典型形状。 */
    /* 先手动关一次：不清场的话"进关后底噪起来了"可能只是 [22] 留下的，
       enterLevel 到底有没有真的开新局，那条断言分不出来。 */
    FX.amb(false);
    /* 附属关要正关先通关（同 [20]）。写成空进度时 enterLevel 会静默返回 false，
       而 LEVEL 还停在上一次的 C3B 上，看上去一切正常——这个坑 [21] 已经踩过一回。 */
    try {
      window.localStorage.setItem(W.PROGRESS_KEY, JSON.stringify({ cleared: { C3: 'win' } }));
    } catch (e) {}
    W.writeProgress({ cleared: { C3: 'win' }, played: {}, deck: null, last: null });
    W.enterLevel('C3B', { noIntro: true, noSave: true });
    ok('前提：进关后底噪起来了',
       W.LEVEL.id === 'C3B' && FX._ambWant === true && !!FX._ambEl,
       'lv=' + W.LEVEL.id + ' want=' + FX._ambWant + ' el=' + !!FX._ambEl);

    W.getState().turn = W.LEVEL.maxTurns;
    W.judgeFinal();
    ok('结算后底噪已停', FX._ambWant === false, 'want=' + FX._ambWant);

    /* ── 首屏预算：从"一刀切"改成"按关" ──
       以前是无条件把 ASSETS.sfx 全部键拉一遍。真正会犯的错不是"忘了关 amb"，
       而是"顺手把一条新音效加进 ASSETS 就跟着首屏走了"——那一步不报错，
       只是手机进关白等。

       现在 preload 收 scope（sfxForLevel），所以断言也得分两半：
       ① 与关卡无关的坏法（amb、死槽混进来）照旧守；
       ② 与关卡有关的坏法（第 1 关跟着下海空四槽）走真实进关路径验。
       注意**不能手搓 FX.preload(scope) 来测**：那样测的是参数，
       而接线（newGame / startResume 到底传没传）永远测不到。 */
    FX._pool = {};
    FX.preload();
    const pooled = Object.keys(FX._pool);
    ok('preload 没把 amb 拉进首屏', pooled.includes('amb') === false, pooled.join(','));
    /* 死槽：机动改走 step/engine/track 之后 move / hit 没有代码引用了，
       只剩试听页当对照组。它们留在 ASSETS 里是对的（试听页要按需加载），
       但不能跟着进关传输——8.5 KB 白占。 */
    ok('preload 没把死槽 move / hit 拉进来',
       !pooled.includes('move') && !pooled.includes('hit'),
       'move=' + pooled.includes('move') + ' hit=' + pooled.includes('hit'));

    const poolBytes = (list) => {
      let b = 0;
      for (const k of list) {
        try { b += fs.statSync(path.join(baseDir, W.ASSETS.sfx[k])).size; } catch (e) {}
      }
      return b;
    };

    /* 全量口径（不传 scope）留一个上限，防止有人新加槽时忘了考虑体积。
       这个数只用来兜"加槽加疯了"，不代表任何一关的真实首屏。 */
    ok('全量预载（无 scope）仍 ≤ 300 KB', poolBytes(pooled) <= 300 * 1024,
       Math.round(poolBytes(pooled) / 1024) + ' KB');

    /* ── 按关预载：走真实路径 ──
       C1 是纯步兵加拖炮和一辆坦克：没有航空、没有舰船。
       以前它跟着下 prop / ship / airgun / bomb 四槽（约 78 KB）。 */
    FX._pool = {};
    W.writeProgress({ cleared: { C1: 'win', C2: 'win', C3: 'win' }, played: {}, deck: null, last: null });
    W.enterLevel('C1', { noIntro: true, noSave: true });
    const c1 = Object.keys(FX._pool);
    ok('前提：真的进了 C1', W.LEVEL.id === 'C1', W.LEVEL.id);
    ok('C1 不预载海空四槽（prop / ship / airgun / bomb）',
       !['prop', 'ship', 'airgun', 'bomb'].some(k => c1.includes(k)), c1.join(','));
    /* 反向那一半：别把 scope 收得太死，连本关真会用到的也省掉。
       C1 有牵引炮（engine）、坦克（track）、步兵（step），三条都得在。 */
    ok('C1 预载了本关要用的机动声（step / engine / track）',
       ['step', 'engine', 'track'].every(k => c1.includes(k)), c1.join(','));
    ok('C1 进关传输 ≤ 200 KB', poolBytes(c1) <= 200 * 1024,
       Math.round(poolBytes(c1) / 1024) + ' KB');

    /* C4 是港口战，有驱逐舰 / 巡洋舰 / 战列舰和三型飞机。
       如果 scope 写死成"永远最小集"，这一条会红——两个方向都要有人守。 */
    FX._pool = {};
    W.writeProgress({ cleared: { C1: 'win', C2: 'win', C3: 'win', C4: 'win' }, played: {}, deck: null, last: null });
    W.enterLevel('C4', { noIntro: true, noSave: true });
    const c4 = Object.keys(FX._pool);
    ok('前提：真的进了 C4', W.LEVEL.id === 'C4', W.LEVEL.id);
    ok('C4（港口战）预载了海空槽（ship / prop / airgun / bomb）',
       ['ship', 'prop', 'airgun', 'bomb'].every(k => c4.includes(k)), c4.join(','));
    /* C4 有 24 种兵种，几乎用满全量集——它就是最重的一关（264 KB）。
       所以这里的上限按全量算，它不是"给 C4 留余地"，而是守"别为了
       按关预载把 C4 该有的砍掉"：砍了体积会降，但上面那条会先红。 */
    ok('C4 进关传输 ≤ 300 KB', poolBytes(c4) <= 300 * 1024,
       Math.round(poolBytes(c4) / 1024) + ' KB');

    /* 起播：底噪必须是循环轨。少了 loop，60 秒后战场就安静了，
       而且不会有任何报错——玩家只会觉得"后面怎么没声了"。 */
    FX.amb(true);
    ok('amb 起来后是循环轨', !!(FX._ambEl && FX._ambEl.loop === true && FX._ambWant === true),
       FX._ambEl ? 'loop=' + FX._ambEl.loop : '没建元素');
  }

  console.log('[24] 素材来源：CC-BY 的署名要出现在玩家点得到的地方');
  {
    const W = window.__WAR__;
    const doc = window.document;
    const tabs = Array.from(doc.querySelectorAll('#hqTabs button[data-tab]'))
      .map(b => b.dataset.tab);
    ok('指挥部有「素材来源」页签', tabs.includes('credits'), tabs.join(','));
    ok('页签白名单收 credits', (W.HQ_TABS || []).includes('credits'), (W.HQ_TABS || []).join(','));

    W.openHQ('credits');
    const body = doc.getElementById('hqBody');
    const txt = body.textContent || '';
    ok('素材来源页真的渲染出内容', txt.length > 200, txt.length + ' 字');
    /* 页签没接进 renderHQ 的话会落到兜底页（副官），而副官也有几百字，
       只看长度会假绿——所以要认一句这一页特有的话。 */
    ok('渲染的是素材来源页，不是兜底页', txt.indexOf('这套声音从哪来') >= 0,
       txt.replace(/\s+/g, ' ').slice(0, 30));

    /* 断言的源头是 CREDITS.md，不是引擎里那张表——否则"两边一起漏"
       永远发现不了。改素材的人只会更新 CREDITS，那一栏才是底账。
       取法：表格行里含 CC-BY 的那一格，它左边一格就是作者。 */
    const baseDir2 = path.join(path.dirname(file), W.ASSETS.base || 'assets/');
    const md = fs.readFileSync(path.join(baseDir2, 'sfx', 'CREDITS.md'), 'utf8');
    const ccby = [];
    for (const line of md.split('\n')) {
      if (line.charAt(0) !== '|' || !/CC-BY/.test(line)) continue;
      const cells = line.split('|').map(s => s.trim());
      const fileM = cells[1] && cells[1].match(/`([^`]+)`/);
      if (!fileM) continue;
      const lic = cells.findIndex(c => /^\*{0,2}CC-BY/.test(c));
      if (lic < 2) continue;
      ccby.push({ file: fileM[1], by: cells[lic - 1] });
    }
    ok('前提：从 CREDITS 读到了 CC-BY 条目', ccby.length >= 4, ccby.length + ' 条');

    /* 只核对仍在役的文件。素材撤掉之后 CREDITS 会留着历史记录，
       那种情况下不该逼着页面上继续挂着一个人的名字。 */
    const inUse = new Set(Object.keys(W.ASSETS.sfx || {})
      .map(k => path.basename(W.ASSETS.sfx[k])));
    const missing = [];
    for (const c of ccby) {
      if (!inUse.has(c.file)) continue;
      if (txt.indexOf(c.file) < 0) missing.push(c.file + ' 没写文件名');
      else if (txt.indexOf(c.by) < 0) missing.push(c.file + ' 漏了作者 ' + c.by);
    }
    ok('在役的 CC-BY 素材逐一署名（文件 + 作者）', missing.length === 0, missing.join(' / '));

    ok('署名带得回源头（freesound 链接 ≥ 4 条）',
       body.querySelectorAll('a[href*="freesound.org"]').length >= 4,
       body.querySelectorAll('a[href*="freesound.org"]').length + ' 条');
  }

  console.log('[25] 敌情检视与堆叠目标选择（真 DOM）');
  {
    /* 两条玩家反馈的界面上半段：
       "看不到敌人具体信息" → 点敌格之后 #unitBox 得真的换成敌军编制；
       "堆叠格想打指定那支" → 多目标时 #pickBox 得弹出来、点第二支要打第二支。
       状态层的断言在 selftest [38]，这里守的是"渲染端有没有接上"——
       少了这一层，引擎里全绿而玩家屏幕上什么都没变。 */
    const W = window.__WAR__;
    const doc = window.document;
    /* 上一节 [24] 打开过指挥部（?hq=credits）就没关，而 Esc 的第一层是
       "关 HQ"。不清场的话这里按 Esc 只会关掉那个面板，选择器一动不动——
       看起来像"Esc 不生效"，实际是被上层顶替。 */
    W.closeHQ();
    W.writeProgress({ cleared: { C1: 'win', C2: 'win' }, played: {}, deck: null, last: null });
    W.enterLevel('C3', { noIntro: true, noSave: true });
    ok('前提：真的进了岚口', W.LEVEL.id === 'C3', W.LEVEL.id);

    const setup = () => {
      W.newGame({ level: 'C3', noSave: true });
      const st = W.getState();
      const me = W.uid('B1A');
      const foes = st.units.filter(u => u.side === 'red' && W.domainOf(u) === 'ground');
      const hex = W.neighbors(me.pos[0], me.pos[1])
        .filter(p => W.unitsAt(p[0], p[1]).length === 0)[0];
      foes[0].pos = hex.slice();
      foes[1].pos = hex.slice();
      let far = null, bd = -1;
      for (let r = 0; r < W.LEVEL.rows; r++) {
        for (let c = 0; c < W.LEVEL.cols; c++) {
          const d = W.hexDist(me.pos, [r, c]);
          if (d > bd && W.unitsAt(r, c).length === 0) { bd = d; far = [r, c]; }
        }
      }
      return { st, me, hex, far, f0: foes[0], f1: foes[1] };
    };

    const box = doc.getElementById('unitBox');
    const opsBox = doc.getElementById('unitOps');
    const pickBox = doc.getElementById('pickBox');

    /* ── 一、点敌军 = 检视 ── */
    let s = setup();
    s.f0.pos = s.far.slice();
    W.select(s.me);
    W.onHexClick(s.far[0], s.far[1]);
    const boxTxt = box.textContent || '';
    ok('点射程外的敌军，右侧面板换成那支敌军', boxTxt.indexOf(s.f0.name) >= 0,
       boxTxt.replace(/\s+/g, ' ').slice(0, 40));
    ok('面板写明「检视中（只读）」', boxTxt.indexOf('检视中') >= 0,
       boxTxt.replace(/\s+/g, ' ').slice(0, 40));
    /* 只验名字会假绿：以前这里显示的是地形名，恰好也可能撞字。
       编制三项是"敌军详情"这件事本身，缺一项这功能就等于没做。 */
    ok('敌方编制信息真的渲染出来了（战力 / 组织度 / 射程）',
       boxTxt.indexOf('战力') >= 0 && boxTxt.indexOf('组织度') >= 0 && boxTxt.indexOf('射程') >= 0);
    ok('检视期间我方单位的行动入口还在（选中没被抢走）',
       !opsBox.classList.contains('hidden'));

    /* ── 二、多目标：先选后打 ── */
    s = setup();
    W.select(s.me);
    W.onHexClick(s.hex[0], s.hex[1]);
    ok('多目标时选择器出现', !pickBox.classList.contains('hidden'));
    const btns = pickBox.querySelectorAll('button[data-t]');
    ok('选择器列出两支目标 + 一个取消', btns.length === 3, btns.length + ' 个按钮');
    ok('选择器里写的是兵牌简称（玩家认字的那一行）',
       (pickBox.textContent || '').indexOf(s.f0.abbr) >= 0,
       (pickBox.textContent || '').replace(/\s+/g, ' ').slice(0, 40));
    ok('行动气泡让位，不跟选择器叠在一起', opsBox.classList.contains('hidden'));

    const str0 = s.f0.str, str1 = s.f1.str;
    btns[1].click();
    ok('点第二支：打的是它，第一支原样',
       s.f0.str === str0 && (!W.getState().units.includes(s.f1) || s.f1.str < str1),
       s.f0.id + ' ' + str0 + '→' + s.f0.str + '，' + s.f1.id + ' ' + str1 + '→' + s.f1.str);
    ok('打完选择器自己收起', pickBox.classList.contains('hidden'));

    /* ── 三、Esc 收起选择器，选中保留 ── */
    s = setup();
    W.select(s.me);
    W.onHexClick(s.hex[0], s.hex[1]);
    ok('前提：选择器又打开了', !pickBox.classList.contains('hidden'));
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    ok('Esc 只收选择器，不连带取消选中',
       pickBox.classList.contains('hidden') && W.getState().selected === s.me,
       'pick=' + (W.getState().pick ? '有' : '无') +
       ' selected=' + (W.getState().selected ? W.getState().selected.id : '空'));
  }

  {
    /* 特殊单位面板：levelcheck [11c] 验的是 isBroken / terrainDefFor / traitSum
       这些函数，验不到"玩家点开兵牌能不能看见"。特性表写错了、面板拼错的键名
       漏到屏幕上、或者整块根本没接上，540 项照样全绿。
       选 C6 而不是 C5：军校生旅是 wave:1，开局就在地图上；
       C5 的伞兵是 wave:0，要推到第 3 回合才落场，测一条渲染断言不值当。 */
    const W = window.__WAR__;
    const doc = window.document;
    W.closeHQ();
    W.writeProgress({
      cleared: { C1: 'win', C2: 'win', C2B: 'win', C3: 'win', C3B: 'win', C4: 'win', C4B: 'win', C5: 'win' },
      played: {}, deck: null, last: null
    });
    W.enterLevel('C6', { noIntro: true, noSave: true });
    ok('前提：真的进了岚京外围', W.LEVEL.id === 'C6', W.LEVEL.id);
    W.newGame({ level: 'C6', noSave: true });
    const st = W.getState();
    const cadet = st.units.find(u => u.id === 'E4A');
    ok('前提：军校生旅开局就在场上（wave:1）', !!cadet);
    if (cadet) {
      W.select(cadet);
      const txt = doc.getElementById('unitBox').textContent || '';
      const flat = txt.replace(/\s+/g, ' ');
      ok('兵牌面板出现「特殊单位」一组', flat.indexOf('特殊单位') >= 0, flat.slice(0, 60));
      /* 判文案而不是判数组：面板上出现 `cadet` / `orgTick` 这类字段名，
         等于把代码层表述露给玩家（文案规矩见 docs/13）。 */
      ok('写的是「学员主官」而不是特性键名',
         flat.indexOf('学员主官') >= 0 && flat.indexOf('cadet') < 0 && flat.indexOf('orgTick') < 0,
         flat.slice(0, 80));
      ok('面板写明它每回合恢复多少组织度', /组织度 \+6/.test(flat), flat.slice(0, 80));
      /* 两条都要判：只写 `indexOf(A) < indexOf(B)` 时，A 根本不存在会返回 −1，
         −1 小于任何下标 → 断言在"整块没渲染"的情况下照样绿。 */
      ok('特殊单位排在「兵牌能力」之上（身份在兵种说明之前）',
         flat.indexOf('特殊单位') >= 0 && flat.indexOf('兵牌能力') >= 0 &&
         flat.indexOf('特殊单位') < flat.indexOf('兵牌能力'));

      /* 反方向：没有特性的兵牌不能顶着一个空标题——空标题比不加还糟，
         玩家会以为"这支部队本来该有特性，没显示出来"。 */
      const plain = st.units.find(u => u.side === 'blue' && u !== cadet && !W.traitList(u).length);
      ok('前提：找得到一支没有特性的我方兵牌', !!plain, plain ? plain.id : '无');
      if (plain) {
        W.select(plain);
        const t2 = (doc.getElementById('unitBox').textContent || '').replace(/\s+/g, ' ');
        ok('没有特性的兵牌不出「特殊单位」空标题', t2.indexOf('特殊单位') < 0, plain.id);
      }
    }
  }

  {
    /* 手册三页（特殊机制 / 版本公告 / 图鉴的类别与介绍）＋ 菜单页公告面板。
       结构断言在 selftest [39]（能直接读数据），这里只守"渲染出来长什么样"：
       标题、顺序、文案里有没有把字段名漏给玩家。
       为什么非要在真 DOM 里做：selftest 用的是 stub DOM，
       innerHTML 写进去读不回来——那几条断言全绿而屏幕上什么都没有，是常态。 */
    const W = window.__WAR__;
    const doc = window.document;
    W.closeHQ();
    const body = doc.getElementById('hqBody');
    /* 用点页签而不是直接 openHQ：加一页要同时改三处（白名单、HTML 的按钮、
       renderHQ 的分支），直接调 openHQ 只验证了第三处。
       这里点的是玩家真的会点的那个按钮。 */
    W.openHQ('dex');
    const tabOf = t => doc.querySelector('#hqTabs button[data-tab="' + t + '"]');
    ok('页签栏里有「特殊机制」与「版本公告」两个按钮',
       !!tabOf('mech') && !!tabOf('notes'));
    tabOf('mech').click();
    ok('点「特殊机制」真的切过去了（白名单也放行了）',
       tabOf('mech').classList.contains('on') && !tabOf('dex').classList.contains('on'));
    const mechs = body.querySelectorAll('.mech');
    const mechTotal = (W.MECH || []).reduce((s, g) => s + g.items.length, 0);
    ok('特殊机制页渲染出全部条目', mechs.length === mechTotal,
       mechs.length + ' / ' + mechTotal);
    ok('每条机制都有三个小标题（什么时候触发 / 触发之后 / 怎么用）',
       mechs.length > 0 && Array.from(mechs).every(el => el.querySelectorAll('.mech-b').length === 3));
    const mechTxt = (body.textContent || '').replace(/\s+/g, ' ');
    ok('机制页把三段的名字写出来了（不是三个空格子）',
       mechTxt.indexOf('什么时候触发') >= 0 && mechTxt.indexOf('触发之后') >= 0 &&
       mechTxt.indexOf('怎么用') >= 0);
    /* 文案口径：字段名不能漏到玩家面前。这几个是最容易手滑写进去的
       （`dm`/`atk`/`rng` 在引擎注释里到处都是，复制一段注释过来就中招）。 */
    const badTerms = ['atk', 'dm:', 'rng', 'orgTick', '未实现', '未登场', '`'];
    const foundBad = badTerms.filter(t => mechTxt.indexOf(t) >= 0);
    ok('机制页文案里没有代码层表述', foundBad.length === 0, '命中：' + foundBad.join(' / '));

    W.openHQ('dex');
    const dexCards = body.querySelectorAll('.dex');
    const cats = body.querySelectorAll('.dex .dex-cat');
    ok('图鉴每张卡片都带类别徽章', dexCards.length > 0 && cats.length === dexCards.length,
       cats.length + ' / ' + dexCards.length);
    const intros = body.querySelectorAll('.dex .dex-intro');
    ok('图鉴每张卡片都有兵种介绍', intros.length === dexCards.length,
       intros.length + ' / ' + dexCards.length);
    /* 类别是"辨识类型"的落点，写错了等于没做：抽查三个最容易被弄混的——
       步兵营归步兵、中坦营归装甲、摩步营归机械化。 */
    const catOf = name => {
      const card = Array.from(dexCards).find(c => {
        const b = c.querySelector('.dex-h b');
        return b && b.textContent.trim() === name;
      });
      return card ? card.querySelector('.dex-cat').textContent.trim() : '(缺卡)';
    };
    ok('步兵营归在「步兵单位」', catOf('步兵营') === '步兵单位', catOf('步兵营'));
    ok('中型坦克营归在「装甲单位」', catOf('中型坦克营') === '装甲单位', catOf('中型坦克营'));
    ok('摩步营归在「机械化单位」', catOf('摩步营') === '机械化单位', catOf('摩步营'));
    const dexTxt = (body.textContent || '').replace(/\s+/g, ' ');
    const dexBad = badTerms.filter(t => dexTxt.indexOf(t) >= 0);
    ok('图鉴文案里没有代码层表述', dexBad.length === 0, '命中：' + dexBad.join(' / '));

    tabOf('notes').click();
    ok('点「版本公告」也真的切过去了',
       tabOf('notes').classList.contains('on'));
    const notes = body.querySelectorAll('.note');
    const notesData = (window.CANGYU_NOTES && window.CANGYU_NOTES.notes) || [];
    ok('版本公告页渲染出全部条目', notes.length === notesData.length,
       notes.length + ' / ' + notesData.length);
    const firstVer = body.querySelector('.note .note-h b');
    ok('公告第一条就是当前版本',
       !!firstVer && !!firstVer.textContent.trim() &&
       firstVer.textContent.trim().replace(/^v/, '') ===
         (doc.getElementById('verTag').textContent || '').replace(/^v/, ''),
       (firstVer && firstVer.textContent.trim()) + ' / ' + doc.getElementById('verTag').textContent);
    ok('每条公告都有条目列表（不是只剩一个标题）',
       notes.length > 0 && Array.from(notes).every(el => el.querySelectorAll('li').length > 0));
    W.closeHQ();
  }

  {
    console.log('[26] 设置面板 / 结算返回首页 / 关键要点标注（v4.17）');
    const W = window.__WAR__;
    /* 这三条都是"玩家点得到才算数"的东西，selftest 的 stub DOM 里
       getElementById 每次返回新的空对象，innerHTML 写进去读不回来，
       在那里测等于什么都没测。所以放在这一层。 */

    /* ── 音量设置 ── */
    const setBtn = doc.getElementById('btnSet');
    const setPanel = doc.getElementById('setScreen');
    ok('顶栏有设置入口', !!setBtn);
    ok('设置面板默认是关着的', !!setPanel && setPanel.classList.contains('hidden'));
    if (setBtn && setPanel) {
      setBtn.click();
      ok('点设置之后面板打开', !setPanel.classList.contains('hidden'));
      const ids = ['volBgm', 'volSfx', 'volAmb'];
      const ranges = ids.map(id => doc.getElementById(id));
      ok('音乐 / 音效 / 战场底噪三条都在，而且都是滑杆',
         ranges.every(el => el && el.type === 'range'),
         ranges.map(el => el && el.type).join(','));
      ok('三条互不相同（不是同一个元素挂了三个名字）',
         new Set(ranges.filter(Boolean)).size === 3);
      ok('每条都有百分数读数',
         ids.every(id => doc.getElementById(id + 'V') &&
                         /%$/.test(doc.getElementById(id + 'V').textContent)));

      /* 静音必须是"三条拉到 0"，而不是另立一个 mute 标记——
         否则静音状态下拖一条滑杆，声音会从 0 直接跳到 65%。 */
      doc.getElementById('volMute').click();
      const muted = ids.map(id => Number(doc.getElementById(id).value));
      ok('「全部静音」把三条都拉到 0', muted.every(v => v === 0), muted.join('/'));
      let stored = {};
      try { stored = JSON.parse(window.localStorage.getItem('wargame.vol') || '{}'); } catch (e) {}
      ok('静音写进了本机设置（下一局沿用）',
         stored.bgm === 0 && stored.sfx === 0 && stored.amb === 0, JSON.stringify(stored));

      doc.getElementById('volReset').click();
      const back = ids.map(id => Number(doc.getElementById(id).value));
      ok('「恢复默认」回到 35 / 65 / 60', back.join('/') === '35/65/60', back.join('/'));
      doc.getElementById('setClose').click();
      ok('点「知道了」关掉面板', setPanel.classList.contains('hidden'));

      /* Esc 层：设置面板必须能被 Esc 关掉，而且**只关它这一层**。
         它插在"战时手册 > 设置 > 说明 > 目标选择器 > 作业气泡 > 模式"之间；
         漏了这一层，玩家打开设置按 Esc 会一路穿透，把选中的兵牌也一起清掉。 */
      setBtn.click();
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      ok('Esc 关掉设置面板（不会穿透到下一层）', setPanel.classList.contains('hidden'));
    }

    /* ── 结算页返回首页 ── */
    const home = doc.getElementById('mHome');
    ok('结算面板有「返回首页」', !!home && /返回首页/.test(home.textContent || ''),
       home ? home.textContent : '无');
    const ov = doc.getElementById('overlay') || doc.getElementById('mOverlay');
    ok('它确实在结算面板里（不是漂在别处）', !!ov && !!ov.contains(home));

    /* ── 关键要点标注：描边 + 分段标签 ── */
    W.newGame({ level: 'C3', noSave: true });
    const cores = doc.querySelectorAll('#board .ocore');
    ok('C3 的核心要点格上有金色描边', cores.length > 0, cores.length + ' 格');
    const coreLabel = doc.querySelector('#board .oLabel.core');
    ok('核心要点的标签带 ★（颜色靠不住，文字要能认）',
       !!coreLabel && /★/.test(coreLabel.textContent || ''),
       coreLabel ? coreLabel.textContent : '无');

    /* 第 6 关「北郊防线」是两段高地，要出两个标签。
       以前只有一个，落在两段中间的空地上——玩家反馈的第一条就是它。 */
    W.newGame({ level: 'C6', noSave: true });
    const labels = Array.from(doc.querySelectorAll('#board .oLabel'));
    const lineLabels = labels.filter(el => (el.textContent || '').indexOf('北郊防线') >= 0);
    ok('C6 北郊防线分成两段各标一处', lineLabels.length === 2,
       lineLabels.length + ' 个标签');
    const box = el => {
      const m = /left:\s*([\d.]+)px;\s*top:\s*([\d.]+)px/.exec(el.getAttribute('style') || '');
      return m ? [Number(m[1]), Number(m[2])] : null;
    };
    if (lineLabels.length === 2) {
      const b0 = box(lineLabels[0]), b1 = box(lineLabels[1]);
      ok('两个标签不重叠（分段真的分了，不是叠在一起）',
         !!b0 && !!b1 && Math.abs(b0[0] - b1[0]) > 40,
         b0 && b1 ? Math.abs(b0[0] - b1[0]) + 'px' : '读不到坐标');
    }
    const keepTxt = labels.map(el => el.textContent || '').join(' | ');
    ok('必守要点在文字上写明（不只是换个颜色）',
       keepTxt.indexOf('必守') >= 0, keepTxt.slice(0, 60));
  }

  {
    /* 菜单页的「版本公告」面板。index.html 从来没有被测过——它是玩家的入口，
       却一直是"打开看一眼"的验证方式。这里用第二个 jsdom 实例真跑一遍。
       两个 <script src> 在 jsdom 里不会自动加载（它不发 http 请求），
       所以先把它们替换成内联脚本再构造 DOM：测的是那个渲染 IIFE，
       不是浏览器怎么取文件——后者由 build-www 的引用清单负责。 */
    const { JSDOM: JSDOM2 } = require('jsdom');
    const rootDir = path.join(__dirname, '..');
    const rd = f => fs.readFileSync(path.join(rootDir, f), 'utf8');
    let idxHtml = rd('index.html');
    const inline = (tag, file) => {
      idxHtml = idxHtml.replace(tag, '<script>' + rd(file) + '</script>');
    };
    inline('<script src="data/levels.js"></script>', 'data/levels.js');
    inline('<script src="data/notes.js"></script>', 'data/notes.js');

    const d2 = new JSDOM2(idxHtml, {
      runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      url: 'http://127.0.0.1/index.html'
    });
    await wait(300);
    const doc2 = d2.window.document;
    const cards = doc2.querySelectorAll('#notes .n-card');
    ok('菜单页渲染出版本公告面板', cards.length > 0, cards.length + ' 张卡');
    ok('首页只放最近两版（全量在游戏里）', cards.length === 2, cards.length + ' 张');
    if (cards.length) {
      const n0 = cards[0];
      ok('首页公告卡片有版本号 / 日期 / 条目',
         !!n0.querySelector('.n-ver') && !!n0.querySelector('.n-date') &&
         n0.querySelectorAll('li').length > 0,
         n0.querySelector('.n-ver').textContent);
      ok('首页公告与游戏内读的是同一份数据（首条版本一致）',
         n0.querySelector('.n-ver').textContent.trim() ===
           ((d2.window.CANGYU_NOTES.notes[0].ver) || ''),
         n0.querySelector('.n-ver').textContent + ' / ' + d2.window.CANGYU_NOTES.notes[0].ver);
    }
    const moreLink = doc2.querySelector('#notes .n-more a');
    ok('首页有「看全部」的入口，且指向 HQ 的公告页签',
       !!moreLink && /hq=notes/.test(moreLink.getAttribute('href') || ''),
       moreLink ? moreLink.getAttribute('href') : '无');
    /* 加公告面板不能把关卡列表挤掉：面板是先渲染的，后续代码一报错就只剩公告。 */
    ok('加了公告面板之后关卡列表照常渲染',
       (doc2.getElementById('levels').textContent || '').indexOf('北岭要塞') >= 0,
       (doc2.getElementById('levels').textContent || '').replace(/\s+/g, ' ').slice(0, 40));
  }

  {
    /* 战术卡配牌页（cards.html，v4.18 从手册里拆出来的独立页面）。
       同菜单页的做法：两个 <script src> 换成内联再跑渲染 IIFE。
       它写的是战役进度里的 deck 字段——写入格式必须和引擎 readDeck 的
       约定一致（数组、过滤无效 id、上限 3），否则配好的牌进局会被丢掉。 */
    const { JSDOM: JSDOM3 } = require('jsdom');
    const rootDir = path.join(__dirname, '..');
    const rd = f => fs.readFileSync(path.join(rootDir, f), 'utf8');
    let cHtml = rd('cards.html');
    cHtml = cHtml.replace('<script src="data/levels.js"></script>',
                          '<script>' + rd('data/levels.js') + '</script>');
    cHtml = cHtml.replace('<script src="data/cards.js"></script>',
                          '<script>' + rd('data/cards.js') + '</script>');
    const d3 = new JSDOM3(cHtml, {
      runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      url: 'http://127.0.0.1/cards.html'
    });
    await wait(200);
    const doc3 = d3.window.document;
    const CW = d3.window.WARGAME_CARDS || {};
    ok('配牌页拿到了引擎导出的卡数据', (CW.cards || []).length >= 6,
       (CW.cards || []).length + ' 张');
    const onBtns = () => Array.from(doc3.querySelectorAll('#list .tcard.on button'));
    ok('配牌页渲染出全部战术卡',
       doc3.querySelectorAll('#list .tcard').length === CW.cards.length);
    ok('从没配过时默认带上三张', onBtns().length === (CW.defaultDeck || []).length,
       onBtns().length + ' 张');
    ok('携带计数与选中数一致',
       doc3.getElementById('bar').textContent.indexOf(
         onBtns().length + ' / ' + CW.max) >= 0);

    /* 卸一张 → 计数与选中数一起走 */
    const dropId = onBtns()[0].dataset.card;
    onBtns()[0].click();
    await wait(50);
    ok('卸下后计数更新', onBtns().length === 2 &&
       doc3.getElementById('bar').textContent.indexOf('2 / ' + CW.max) >= 0);
    const p = JSON.parse(d3.window.localStorage.getItem(d3.window.CANGYU.storage.progress));
    ok('写入的是引擎的进度 key 里的 deck 字段',
       Array.isArray(p.deck) && p.deck.length === 2 && p.deck.indexOf(dropId) < 0,
       JSON.stringify(p.deck));
    /* 再带回来 → 回到三张。点的是「携带」按钮（不在 .on 里的那张） */
    doc3.querySelector('#list .tcard:not(.on) button[data-card="' + dropId + '"]').click();
    await wait(50);
    ok('再点一次能带回来', onBtns().length === 3);
  }

  console.log('[27] 炮兵点堆叠格直接开火（v4.19 热补丁）');
  /* 炮兵打的是格子：面覆盖本来就把同格所有敌方地面单位一起算，
     再弹一次"打哪一支"既多余又容易点歪。直射单位仍然要问——
     它们打的是具体那支，替玩家决定就是抢了他的选择权。
     这条只能在这里测：断的是**点击之后 DOM 有没有弹选择器**，selftest 的
     stub DOM 连 pickBox 都不存在，判"没弹"会永远绿。 */
  {
    const domA = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vc,
      url: 'http://127.0.0.1/game/campaign.html?lv=C1&nointro=1'
    });
    const WA = domA.window.__WAR__;
    const dA = domA.window.document;
    await wait(200);
    const SA = WA.getState();
    const arty = SA.units.find(u => u.abbr === '103炮');
    const infB = SA.units.find(u => u.abbr === '103-1');
    ok('前提：C1 有炮兵与步兵', !!arty && !!infB,
       (arty && arty.abbr) + ' / ' + (infB && infB.abbr));

    const passable = (r, c) => WA.inBounds(r, c) && WA.TERRAIN[WA.LEVEL.map[r][c]].cost < 99;
    const freeCell = (from, d) => {
      for (let r = 0; r < WA.LEVEL.rows; r++) {
        for (let c = 0; c < WA.LEVEL.cols; c++) {
          if (!passable(r, c)) continue;
          if (WA.layerUnitsAt(r, c, 'surface').length) continue;
          if (WA.hexDist([r, c], from) !== d) continue;
          return [r, c];
        }
      }
      return null;
    };
    const putFoe = (cell, id) => {
      const u = WA.makeUnit({ id, side: 'red', type: 'inf', abbr: id, name: '测试敌军',
        r: cell[0], c: cell[1], corps: 'T', str: 9, mov: 6, rng: 1 }, false);
      SA.units.push(u);
      return u;
    };

    /* ── 一、炮兵点堆叠格：直接开火，不弹选择器 ── */
    const spot = freeCell(arty.pos, 3);
    ok('找到 3 格外的空格摆堆叠守军', !!spot, JSON.stringify(spot));
    if (spot) {
      const f1 = putFoe(spot, 'TA1');
      const f2 = putFoe(spot, 'TA2');
      WA.select(arty);
      ok('前提：这一格有两支可打目标', WA.targetsAt(spot[0], spot[1]).length === 2,
         String(WA.targetsAt(spot[0], spot[1]).length));
      const boxA = dA.getElementById('pickBox');
      WA.onHexClick(spot[0], spot[1]);
      await wait(60);
      ok('炮兵点下去直接开火（敌方格两支都掉战力）',
         f1.str < 9 && f2.str < 9, 'str ' + f1.str + ' / ' + f2.str);
      ok('炮兵没有弹出目标选择器',
         !SA.pick && boxA.classList.contains('hidden'),
         'pick=' + JSON.stringify(SA.pick));
      /* 收尾：把炮兵的状态复原，留着同一台 dom 给下面用 */
      SA.units = SA.units.filter(u => u !== f1 && u !== f2);
      arty.fired = false; arty.moved = false;
      WA.select(arty);
    }

    /* ── 二、反向对照：直射单位（步兵）点堆叠格仍然弹选择器 ── */
    const nearBlue = freeCell(infB.pos, 1);
    ok('找到步兵旁边的空格', !!nearBlue, JSON.stringify(nearBlue));
    if (nearBlue) {
      const g1 = putFoe(nearBlue, 'TB1');
      const g2 = putFoe(nearBlue, 'TB2');
      WA.select(infB);
      const n = WA.targetsAt(nearBlue[0], nearBlue[1]).length;
      ok('前提：步兵这一格也有两支可打目标', n === 2, String(n));
      WA.onHexClick(nearBlue[0], nearBlue[1]);
      await wait(60);
      const boxB = dA.getElementById('pickBox');
      ok('步兵点堆叠格弹出选择器（打谁由玩家定）',
         !!SA.pick && !boxB.classList.contains('hidden'),
         'pick=' + JSON.stringify(SA.pick));
      ok('选择器里两个目标加取消共三个按钮',
         boxB.querySelectorAll('button[data-t]').length === 3,
         String(boxB.querySelectorAll('button[data-t]').length));
      ok('选择器弹出时敌人还没掉血', g1.str === 9 && g2.str === 9,
         g1.str + ' / ' + g2.str);
    }
    /* ── 桌面端缩放：transform 必须真写进 DOM ──
       jsdom 不带 matchMedia，isNarrow() 返回 false，这一块天然就是"宽屏"分支。
       旧实现在 applyView 里对宽屏直接 `transform = ''`，于是玩家按放大键，
       vK 变了、屏幕上却一动不动。所以这里断的是 DOM 上的 transform，
       而不是模块变量——变量改了不等于画面改了，selftest 只能验到前者。 */
    const vw = WA.view;
    const bV = dA.getElementById('boardView');
    ok('前提：这一支走的是桌面分支（jsdom 没有 matchMedia）', vw.isNarrow() === false);
    vw.fitView(false);
    ok('桌面 fitView 后棋盘上写了 transform', /scale\(/.test(bV.style.transform || ''),
       bV.style.transform);
    vw.zoomBy(1.4);
    ok('桌面放大后 vK 变大', vw.k > 1 + 1e-9, 'k=' + vw.k);
    const kDom = parseFloat((String(bV.style.transform).match(/scale\(([\d.]+)/) || [])[1]);
    ok('桌面放大后 DOM 里的倍数跟着变',
       Math.abs(kDom - vw.k) < 0.01, 'dom=' + kDom + ' k=' + vw.k);
    vw.fitView(false);
    ok('桌面点「适应屏幕」能把倍数收回适应值',
       Math.abs(vw.k - vw.fitK) < 1e-9, 'k=' + vw.k + ' fit=' + vw.fitK);

    /* 滚轮与拖动：桌面端真正顺手的两种操作，按钮只是兜底。
       只断"按钮能改 vK"是不够的——玩家根本不会去点那四个小按钮。 */
    const wrapEl = dA.getElementById('boardWrap');
    const kBefore = vw.k;
    wrapEl.dispatchEvent(new domA.window.WheelEvent('wheel', {
      deltaY: -120, clientX: 100, clientY: 100, bubbles: true, cancelable: true
    }));
    ok('桌面滚轮向上滚能放大', vw.k > kBefore + 1e-9, kBefore + ' → ' + vw.k);
    /* 拖动只断"进了平移态"：jsdom 没有布局，clientWidth 是 0，
       位移量会被 clampView 夹回去，断坐标变化会是一条永远绿或永远红的假线。 */
    wrapEl.dispatchEvent(new domA.window.MouseEvent('mousedown', {
      button: 0, clientX: 300, clientY: 300, bubbles: true
    }));
    domA.window.dispatchEvent(new domA.window.MouseEvent('mousemove', {
      clientX: 360, clientY: 340, bubbles: true
    }));
    ok('桌面左键拖动进入平移态', wrapEl.classList.contains('grabbing'));
    domA.window.dispatchEvent(new domA.window.MouseEvent('mouseup', { bubbles: true }));
    ok('松开鼠标后退出平移态', !wrapEl.classList.contains('grabbing'));

    /* 桌面上要真有按钮可点：.zctrl 的基础态以前是 display:none，
       只有窄屏媒体查询才打开，桌面玩家连手柄都看不见。 */
    const cssV = fs.readFileSync(require('path').join(__dirname, '..', 'game', 'campaign.css'), 'utf8');
    ok('缩放按钮在桌面端也显示（.zctrl 基础态 display:grid）',
       /\.zctrl\s*\{[^}]*display\s*:\s*grid/.test(cssV));
    ok('地图容器在桌面端交给 JS 平移（#boardWrap 基础态 overflow:hidden）',
       /#boardWrap\s*\{[^}]*overflow\s*:\s*hidden/.test(cssV));

    domA.window.close();
  }

  console.log('');
  console.log('通过 ' + pass + ' 项' + (skipped ? ' · 跳过 ' + skipped + ' 项' : '') +
              '，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(1); });
