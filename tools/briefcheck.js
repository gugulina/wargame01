/* 开局流程回归测试：开始页 → 战前简报三页 → 对话过场 → 进入战场。
   用 jsdom 跑真 DOM，验证的是"点下去会发生什么"，不是纯函数。

   跑法（jsdom 装在托管 node 的 workspace 里，不在本仓库）：
     NODE_PATH="C:/Users/泽宇/.workbuddy/binaries/node/workspace/node_modules" \
     node tools/briefcheck.js

   为什么单独一个文件而不是塞进 selftest.js：selftest 用 vm + stub DOM，
   碰不到 innerHTML 之外的真实行为；简报这套流程全是 DOM 交互，必须真环境。 */

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

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

(async () => {
  await wait(400);

  console.log('[1] 开始页');
  ok('开始页默认可见', !doc.getElementById('startScreen').classList.contains('hidden'));
  ok('简报默认隐藏', doc.getElementById('briefScreen').classList.contains('hidden'));

  console.log('[2] 点「开始新的战役」→ 第一页');
  doc.getElementById('btnNewGame').click();
  await wait(60);
  const brief = doc.getElementById('briefScreen');
  ok('简报出现', !brief.classList.contains('hidden'));
  ok('开始页已收起', doc.getElementById('startScreen').classList.contains('hidden'));
  const t1 = brief.querySelector('.brief-title').textContent;
  ok('第一页标题正确', t1 === '主力走了，你们留下', t1);
  ok('含绝密标记', brief.textContent.replace(/\s/g, '').includes('绝密'));
  ok('含三项数值', brief.querySelectorAll('.brief-nums div').length === 3);
  ok('页码第一点高亮', brief.querySelectorAll('.brief-dots i.on').length === 1);
  ok('按钮文字是继续', doc.getElementById('briefNext').textContent.indexOf('继续') >= 0);

  console.log('[3] 翻到第二页');
  doc.getElementById('briefNext').click();
  await wait(60);
  const t2 = brief.querySelector('.brief-title').textContent;
  ok('第二页标题正确', t2 === '敌人也在抢时间', t2);
  ok('第二页有红字数值', brief.querySelectorAll('.brief-nums b.r').length === 2);

  console.log('[4] 翻到第三页');
  doc.getElementById('briefNext').click();
  await wait(60);
  const t3 = brief.querySelector('.brief-title').textContent;
  ok('第三页标题正确', t3 === '守住十二个回合', t3);
  ok('末页按钮改名接管指挥', doc.getElementById('briefNext').textContent.indexOf('接管指挥') >= 0);

  console.log('[5] 末页点击 → 对话过场，纸张仍在（当暗背景）');
  doc.getElementById('briefNext').click();
  await wait(120);
  const cs = doc.getElementById('cutscene');
  ok('剧情卡出现', !cs.classList.contains('hidden'));
  ok('纸张未收起（防止闪地图）', !brief.classList.contains('hidden'));
  ok('第一句是方面军司令部', cs.textContent.indexOf('方面军司令部') >= 0);
  /* 司令部那句是「电话」，走符号位而不是"立绘位"占位字。
     这两条要成对断言：只查有没有 svg，会把"退化成占位字"也放过。 */
  const hqPort = cs.querySelector('.cs-portrait');
  ok('司令部走符号位', !!hqPort && hqPort.classList.contains('sig'));
  ok('符号位有内置电台图标', !!cs.querySelector('.cs-portrait.sig svg'));
  ok('符号位不显示占位字', cs.textContent.indexOf('立绘位') < 0);
  /* 打字机是逐字的，先点一下把整句显示完再断言文本 */
  cs.click();
  await wait(60);
  ok('台词含守到天亮', cs.textContent.indexOf('守到天亮') >= 0);

  console.log('[6] 第二句切到人物立绘位');
  cs.click();                       // 打完这句 → 下一句
  await wait(160);
  const cs2 = doc.getElementById('cutscene');
  ok('第二句是旅长', cs2.textContent.indexOf('旅长') >= 0);
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
    const eng = W.getState().units.find(u => u.id === 'B2E');
    W.select(eng);
    await wait(60);
    ok('选中工兵后气泡出现', !box.classList.contains('hidden'));
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

    /* 打完仗（fired）之后不该再出现作业按钮 */
    W.select(eng);
    await wait(40);
    ok('行动耗尽后气泡自动收起', box.classList.contains('hidden'));

    /* 辎重队：建补给点是气泡里的专属项 */
    const sup = W.getState().units.find(u => u.type === 'sup' && u.side === 'blue');
    if (sup) {
      W.select(sup);
      await wait(40);
      ok('辎重队气泡有建立补给点', !!box.querySelector('button[data-op="depot"]'));
      box.querySelector('button[data-op="depot"]').click();
      await wait(60);
      ok('点一下直接建好补给点',
         W.getState().depots.some(d => d.r === sup.pos[0] && d.c === sup.pos[1]));
    } else {
      ok('本关没有辎重队，跳过补给点气泡', true);
    }
  }

  console.log('');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(1); });
