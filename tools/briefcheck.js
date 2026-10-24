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

const file = path.join(__dirname, '..', 'game', 'campaign.html');
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

  console.log('');
  console.log('通过 ' + pass + ' 项' + (skipped ? ' · 跳过 ' + skipped + ' 项' : '') +
              '，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(1); });
