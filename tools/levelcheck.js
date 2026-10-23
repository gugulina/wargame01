/* 多关框架回归测试：关卡数据完整性、解锁规则、时间轴渲染、切关、进度存续、
   地图重置、前情衔接、下一关按钮。

   跑法（jsdom 装在托管 node 的 workspace 里，不在本仓库）：
     NODE_PATH="C:/Users/泽宇/.workbuddy/binaries/node/workspace/node_modules" \
     node tools/levelcheck.js

   为什么要有这个文件：多关框架的 bug 全都是"状态没跟着关卡走"这一类，
   纯函数测不出来——必须真的点一下、真的切一次关，再读回来。 */

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
  const api = window.__WAR__;
  const LV = api.LEVELS;

  console.log('[1] 关卡数据完整性');
  ok('LEVELS 是数组', Array.isArray(LV));
  ok('至少 3 关（前两关占位 + 岚口）', LV.length >= 3, '实际 ' + LV.length);
  let mono = true;
  for (let i = 1; i < LV.length; i++) if (!(LV[i].no > LV[i - 1].no)) mono = false;
  ok('编号严格递增', mono);
  const metaOk = LV.every(l => l.id && l.no && l.name && l.when && l.where && l.teaser && l.type);
  ok('每关元信息齐全（id/no/name/when/where/teaser/type）', metaOk);
  const readyOk = LV.filter(l => l.ready).every(l => Array.isArray(l.map) && l.map.length === l.rows && l.units.length);
  ok('ready 的关都有完整地图与编制', readyOk);
  const srcOk = LV.every(l => Array.isArray(l.mapSrc));
  ok('每关都生成了 mapSrc 原始副本', srcOk);

  console.log('[2] 解锁规则');
  const c1 = api.levelAccess('C1');
  const c3 = api.levelAccess('C3');
  ok('未制作的关不可进', !c1.ok && c1.why === '制作中', c1.why);
  ok('前面没有已制作关时，岚口就是第一关', c3.ok, c3.why);
  ok('前面没有已制作关 → prevReadyLevel 为 null', api.prevReadyLevel('C3') === null);
  ok('没有下一关 → nextReadyLevel 为 null', api.nextReadyLevel('C3') === null);
  ok('推荐关卡是岚口', api.recommendLevel() && api.recommendLevel().id === 'C3');

  console.log('[3] 时间轴渲染');
  const rows = doc.querySelectorAll('#lvlList .lvl-row');
  ok('时间轴行数等于关卡数', rows.length === LV.length, '实际 ' + rows.length);
  ok('未制作关渲染成锁定行', doc.querySelector('#lvlList .lvl-row[data-lv="C1"]').classList.contains('locked'));
  ok('可玩关不是锁定行', !doc.querySelector('#lvlList .lvl-row[data-lv="C3"]').classList.contains('locked'));
  ok('时间轴显示日期', doc.getElementById('lvlList').textContent.indexOf('10 月 8 日') >= 0);

  console.log('[4] 切关');
  const bad = await api.enterLevel('C1', { noIntro: true });
  ok('进未制作的关被拒绝', bad === false);
  ok('被拒绝后关卡指针没变', api.LEVEL.id === 'C3');
  const good = await api.enterLevel('C3', { noIntro: true, noSave: true });
  ok('进岚口成功', good === true);
  ok('LEVEL 指向岚口', api.LEVEL.id === 'C3');
  ok('棋盘已重绘', doc.getElementById('board').innerHTML.length > 500);

  console.log('[5] 进度存续（两层存档不能混）');
  try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}
  ok('清空后没有通关记录', !api.readProgress().cleared.C3);
  api.markResult('C3', 'fail');
  ok('失败记进 played', api.readProgress().played.C3 === 'fail');
  ok('失败不解锁（cleared 仍为空）', !api.readProgress().cleared.C3);
  api.markResult('C3', 'win');
  ok('通关记进 cleared', api.readProgress().cleared.C3 === 'win');
  api.markResult('C3', 'fail');
  ok('通关后重打失败，不清掉通关记录', api.readProgress().cleared.C3 === 'win');

  console.log('[6] 地图重置（架过的桥不能留到下一局）');
  const rawMap = api.LEVEL.mapSrc.slice();
  api.LEVEL.map[3] = api.LEVEL.map[3].replace(/./, '=');
  const dirty = api.LEVEL.map[3] !== rawMap[3];
  ok('测试确实改动了地图', dirty);
  const { newGame } = api;
  newGame({ level: 'C3', noSave: true });
  ok('newGame 后地图恢复原始', api.LEVEL.map[3] === rawMap[3]);

  console.log('[7] 前情衔接（由上一关结果生成，不硬编码）');
  const c2 = api.levelById('C2');
  const wasReady = c2.ready;
  c2.ready = true;                       // 临时把青溪渡口当作已制作
  ok('青溪渡口变成岚口的前一关', api.prevReadyLevel('C3') === c2);
  /* 直接读 state.log 而不是 DOM：战报面板只渲染最近几条，断言会不稳 */
  const logOf = () => api.getState().log.map(e => e.text).join(' ');
  api.markResult('C2', 'fail');
  newGame({ level: 'C3', noSave: true });
  ok('开场战报出现前情', logOf().indexOf('前情') >= 0);
  ok('前情用的是 fail 那句', logOf().indexOf('提前失守') >= 0);
  ok('开场战报带时间点', logOf().indexOf('10 月 8 日') >= 0);
  api.markResult('C2', 'win');
  newGame({ level: 'C3', noSave: true });
  ok('通关后前情换成 win 那句', logOf().indexOf('撑够了六个回合') >= 0);
  c2.ready = wasReady;
  try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}

  console.log('[8] 下一关按钮');
  ok('只有一关时没有下一关', api.nextReadyLevel('C3') === null);
  ok('下一关按钮隐藏', doc.getElementById('mNext').classList.contains('hidden'));

  console.log('');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(1); });
