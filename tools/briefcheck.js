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
const { JSDOM } = require('jsdom');

/* 用法：node tools/briefcheck.js [game/campaign.html]
   接一个可选文件参数是为了 mutcheck.js——DOM 那几条断言（转义、战报 textContent）
   只能在真 DOM 里验，而"验它会不会红"必须拿一份变异过的引擎去跑。 */
const file = process.argv[2] && !process.argv[2].startsWith('-')
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'game', 'campaign.html');
const html = fs.readFileSync(file, 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
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

  console.log('[9] HQ 面板');
  {
    const W = window.__WAR__;
    doc.getElementById('btnHQ').click();
    await wait(60);
    const hq = doc.getElementById('hqScreen');
    ok('HQ 面板打开', !hq.classList.contains('hidden'));
    ok('默认停在兵种图鉴', doc.getElementById('hqBody').textContent.indexOf('轻型坦克营') >= 0);
    ok('图鉴覆盖到重坦', doc.getElementById('hqBody').textContent.indexOf('重型坦克营') >= 0);

    doc.querySelector('#hqTabs button[data-tab="cards"]').click();
    await wait(50);
    ok('战术卡页有六张卡', doc.querySelectorAll('#hqBody .tcard').length >= 6);
    ok('战术卡页显示携带上限', doc.getElementById('hqBody').textContent.indexOf('/ 3') >= 0);

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

    tab('cards').click();
    ok('切到战术卡页签', tab('cards').classList.contains('on'));
    ok('卡页显示携带数量', /携带/.test(body.querySelector('.card-bar').textContent));
    ok('切页签后旧内容被换掉（不是叠在一起）', body.querySelectorAll('.dex').length === 0);
    /* v4.6 的规则：局内只读。以前这里挂着「立即使用」，
       点它 → HQ 自动关掉 → 回地图点目标，是全项目最绕的一条路。 */
    ok('局内不能在这里换牌 / 用牌（没有「立即使用」）',
       body.textContent.indexOf('立即使用') < 0);

    tab('save').click();
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

  console.log('');
  console.log('通过 ' + pass + ' 项' + (skipped ? ' · 跳过 ' + skipped + ' 项' : '') +
              '，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(1); });
