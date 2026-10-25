/* 语法校验 + 关卡数据合法性。
   跑法：
     node tools/check.js                     默认校验 game/campaign.html（引擎）
     node tools/check.js game/campaign.html  同上，显式指定
   加上 --level=C2 可以只看某一关的编制统计（校验永远跑全部已制作关）。

   v4.1 起校验范围从"当前 LEVEL"改成"LEVELS 里所有 ready 的关"。
   起因很具体：C1 / C2 做出来之后，check.js 只看得见 LEVEL 指向的 C3，
   两张新地图的行列数、兵牌坐标全都没人验——错到能开局崩，也查不出来。 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGame, extractScript } = require('./load');

const args = process.argv.slice(2);
const levelArg = (args.find(a => a.startsWith('--level=')) || '').split('=')[1] || '';
const fileArg = args.find(a => !a.startsWith('--'));
/* 默认指向引擎。以前默认是战术级的 game/index.html，那个页面连同它的
   两个工具（autoplay.js / export.js）已经随老原型一起删了；
   再让默认路径指向一个不存在的文件，只会让人以为"校验器坏了"。 */
const file = fileArg || path.join(__dirname, '..', 'game', 'campaign.html');
let fail = 0;

const html = fs.readFileSync(file, 'utf8');
/* 取引擎那一块（不是 <head> 里的兜底脚本），判据见 load.js 的 extractScript */
const src = extractScript(html);
if (!src) {
  console.error('未找到 <script> 块');
  process.exit(1);
}
try {
  new vm.Script(src, { filename: file });
  console.log('[1/4] 语法校验通过，' + src.split('\n').length + ' 行');
} catch (e) {
  console.error('[1/4] 语法错误：' + e.message);
  process.exit(1);
}

const { api } = loadGame(file);

/* 引擎有多关（LEVELS）；单关的老页面已经删了，但这里仍按数组取，兼容单关形态 */
const all = Array.isArray(api.LEVELS) ? api.LEVELS : [api.LEVEL];
const ready = all.filter(l => l.ready);
if (!ready.length) {
  console.error('[2/4] 没有任何 ready 的关卡');
  process.exit(1);
}

const HQ_TYPES = api.HQ_TYPES || ['hq'];
for (const L of ready) {
  const tag = L.id + ' ' + L.name;
  let bad = 0;

  if (L.map.length !== L.rows) {
    console.error('[2/4] ' + tag + '：地图行数 ' + L.map.length + ' ≠ rows ' + L.rows);
    bad++;
  }
  L.map.forEach((row, i) => {
    if (row.length !== L.cols) {
      console.error('[2/4] ' + tag + ' 第 ' + i + ' 行长度 ' + row.length + ' ≠ cols ' + L.cols + '：' + row);
      bad++;
    }
    for (const ch of row) {
      if (!api.TERRAIN[ch]) {
        console.error('[2/4] ' + tag + ' 第 ' + i + ' 行出现未定义地形字符：' + ch);
        bad++;
      }
    }
  });

  const seen = {};
  for (const u of L.units) {
    if (u.r < 0 || u.r >= L.rows || u.c < 0 || u.c >= L.cols) {
      console.error('[3/4] ' + tag + ' ' + u.id + ' 坐标越界：' + u.r + ',' + u.c);
      bad++;
      continue;
    }
    if (api.TYPE && !api.TYPE[u.type]) {
      console.error('[3/4] ' + tag + ' ' + u.id + ' 兵种代号未定义：' + u.type);
      bad++;
    }
    /* reserve = 占位兵种（航空母舰）。规则还没定的东西不许偷偷上场：
       上了场也不报错，但它的射程 0、载货 2、没有任何机制消费它——
       看起来像"这艘船坏了"，其实设计上就不该在这儿。 */
    if (api.TYPE && api.TYPE[u.type] && api.TYPE[u.type].reserve) {
      console.error('[3/4] ' + tag + ' ' + u.id + ' 用了占位兵种（' +
        api.TYPE[u.type].name + '），规则未定，不许部署');
      bad++;
    }
    const ch = L.map[u.r][u.c];
    /* 能不能站，按**领域**判：同一条河对步兵是死路，对绿水炮艇是航路。
       以前一刀切用 `cost >= 99`，加上海空军之后这条会把合法的水上部署
       全部报错——校验器帮不上忙的时候，人就只好把它关掉，那比没有还糟。 */
    const standCost = api.moveCost ? api.moveCost({ type: u.type, dm: u.dm }, ch)
                                   : (api.TERRAIN[ch] ? api.TERRAIN[ch].cost : 99);
    if (api.TERRAIN[ch] && standCost === Infinity) {
      console.error('[3/4] ' + tag + ' ' + u.id + ' 部署在它走不了的地形（' +
        api.TERRAIN[ch].name + '）：' + u.r + ',' + u.c);
      bad++;
    }
    /* 三波次共用一张图，必须全局不重叠——但只跟**同一层**的比：
       飞机停在某个营头顶是合法的编成，不是部署事故。 */
    const lay = api.layerOf ? api.layerOf({ type: u.type, dm: u.dm }) : 'surface';
    const key = u.r + ',' + u.c + ',' + lay;
    if (seen[key]) {
      console.error('[3/4] ' + tag + ' ' + u.id + ' 与 ' + seen[key] + ' 部署位置重叠：' + u.r + ',' + u.c);
      bad++;
    }
    seen[key] = u.id;
  }

  /* 指挥链：没有本部指挥牌的部队常年脱指。只提示，不算错 */
  const hqCorps = new Set(L.units.filter(u => HQ_TYPES.includes(u.type)).map(u => u.side + ':' + u.corps));
  for (const u of L.units) {
    if (HQ_TYPES.includes(u.type)) continue;
    if (!hqCorps.has(u.side + ':' + u.corps)) {
      console.log('[提示] ' + tag + ' ' + u.id + '（' + u.name + '）无本部指挥牌，常年脱指（恢复 ' +
        (u.side === 'blue' ? 7 : 12) + '/回合）');
    }
    /* 水上单位要有一片水可走。整张图找不到一格它能进的，这支部队就是活靶子：
       computeReach 永远返回空，AI 不动、玩家也点不动——而界面上看不出任何异常，
       只会觉得"这艘船坏了"。这种沉默失效必须在数据层拦下来。 */
    const dm = u.dm || (api.TYPE[u.type] && api.TYPE[u.type].dm) || 'ground';
    if ((dm === 'green' || dm === 'blue') && api.NAV && api.NAV[dm]) {
      const wet = L.map.some(row => [...row].some(ch => api.NAV[dm].cells.includes(ch)));
      if (!wet) console.log('[提示] ' + tag + ' ' + u.id + '（' + u.name + '）是' +
        api.NAV[dm].name + '单位，但本图没有它能走的水域——它一步都动不了');
    }
  }

  /* 工事坐标也要在图上，且不能压在河上（工事摆错只会静默失效，最难查） */
  for (const f of (L.forts || [])) {
    if (f.r < 0 || f.r >= L.rows || f.c < 0 || f.c >= L.cols) {
      console.error('[3/4] ' + tag + ' 工事坐标越界：' + f.kind + ' @ ' + f.r + ',' + f.c);
      bad++;
      continue;
    }
    const t = api.TERRAIN[L.map[f.r][f.c]];
    if (t && t.cost >= 99) {
      console.error('[3/4] ' + tag + ' 工事 ' + f.kind + ' 摆在不可通行地形（' + t.name + '）：' + f.r + ',' + f.c);
      bad++;
    }
  }

  /* 胜负条件：reach 必须有 zone 或 cells，survive 的 keep 必须指向真实要点 */
  const w = L.win || { kind: 'score' };
  if (w.kind === 'reach') {
    if (!Array.isArray(w.cells) && !w.zone) {
      console.error('[3/4] ' + tag + '：reach 类关卡缺少撤离区（cells 或 zone）');
      bad++;
    }
    if (!(w.count > 0)) {
      console.error('[3/4] ' + tag + '：reach 类关卡缺少 count');
      bad++;
    }
  }
  if (w.kind === 'survive') {
    for (const id of (w.keep || [])) {
      if (!L.objectives.some(o => o.id === id)) {
        console.error('[3/4] ' + tag + '：survive 的 keep 指向不存在的要点 ' + id +
          '（这会让关卡永远判负——判定时找不到要点就算没守住）');
        bad++;
      }
    }
  }
  /* 红方 AI 完全靠 LEVEL.objectives 找目标：一个都没有，全军原地不动 */
  if (!L.objectives.length) {
    console.error('[3/4] ' + tag + '：没有要点，红方 AI 会全体停滞');
    bad++;
  }
  /* 波次：LEVEL.waves 里声明的波次必须有对应兵牌，反之亦然 */
  const waveDecl = (L.waves || []).map(x => x.wave);
  const waveUnits = [...new Set(L.units.filter(u => u.wave > 1).map(u => u.wave))];
  for (const wv of waveUnits) {
    if (!waveDecl.includes(wv)) {
      console.error('[3/4] ' + tag + '：wave ' + wv + ' 有兵牌但没有在 LEVEL.waves 里声明投入时刻，永远不会到场');
      bad++;
    }
  }

  /* ── 事件触发条件校验 ──
     这一块是补血的：事件写错 id 不会报错、不会崩，只会**永远不触发**。
     "205 装甲旅伤亡过半"那条事件触发率一直是 0%，就是在这一层查不出来。
     所以每条 when 都要落到真实存在的东西上：兵牌 id、要点 id、编制代号。 */
  const KNOWN_WHEN = ['turn', 'control', 'allControl', 'corpsBelow', 'unitDead',
                      'unitActed', 'unitAt', 'unitBelow', 'sideBelow', 'firstBlood',
                      'escaped', 'unitEscaped', 'inZone', 'nearObj'];
  const unitIds = new Set(L.units.map(u => u.id));
  const objIds = new Set((L.objectives || []).map(o => o.id));
  const corpsIds = new Set(L.units.map(u => u.corps).filter(Boolean));
  const evIds = new Set();

  function checkWhen(w, evId) {
    const where = tag + ' · 事件 ' + evId;
    if (Array.isArray(w)) { for (const x of w) checkWhen(x, evId); return; }
    if (!w || !w.kind) {
      console.error('[3/4] ' + where + '：when 缺 kind');
      bad++; return;
    }
    if (!KNOWN_WHEN.includes(w.kind)) {
      console.error('[3/4] ' + where + '：未知触发类型 ' + w.kind + '（不会被引擎认，事件永远不触发）');
      bad++; return;
    }
    if (w.kind === 'control' && !objIds.has(w.obj)) {
      console.error('[3/4] ' + where + '：control 指向不存在的要点 ' + w.obj);
      bad++;
    }
    if (w.kind === 'control' && !['blue', 'red', 'contested', 'none'].includes(w.side)) {
      console.error('[3/4] ' + where + '：control 的 side 必须是 blue/red/contested/none，实为 ' + w.side);
      bad++;
    }
    if (w.kind === 'allControl') {
      for (const id of (w.objs || [])) if (!objIds.has(id)) {
        console.error('[3/4] ' + where + '：allControl 指向不存在的要点 ' + id);
        bad++;
      }
    }
    if (w.kind === 'corpsBelow' && !corpsIds.has(w.corps)) {
      console.error('[3/4] ' + where + '：corpsBelow 指向不存在的编制 ' + w.corps +
        '（初始战力取不到，事件永远不触发）');
      bad++;
    }
    for (const k of ['unitActed', 'unitAt', 'unitBelow']) {
      if (w.kind === k && !unitIds.has(w.id)) {
        console.error('[3/4] ' + where + '：' + k + ' 指向不存在的兵牌 ' + w.id);
        bad++;
      }
    }
    if (w.kind === 'unitAt' && w.obj && !objIds.has(w.obj)) {
      console.error('[3/4] ' + where + '：unitAt 指向不存在的要点 ' + w.obj);
      bad++;
    }
    if (w.kind === 'nearObj' && !objIds.has(w.obj)) {
      console.error('[3/4] ' + where + '：nearObj 指向不存在的要点 ' + w.obj);
      bad++;
    }
    if (w.kind === 'inZone') {
      if (!['blue', 'red'].includes(w.side)) {
        console.error('[3/4] ' + where + '：inZone 的 side 必须是 blue/red，实为 ' + w.side);
        bad++;
      }
      if (!(w.r1 >= w.r0 && w.c1 >= w.c0)) {
        console.error('[3/4] ' + where + '：inZone 矩形范围颠倒（r0>r1 或 c0>c1）');
        bad++;
      }
    }
    if (w.kind === 'unitDead' || w.kind === 'unitEscaped') {
      for (const id of (w.ids || [])) if (!unitIds.has(id)) {
        console.error('[3/4] ' + where + '：' + w.kind + ' 指向不存在的兵牌 ' + id);
        bad++;
      }
    }
  }

  for (const ev of (L.events || [])) {
    if (!ev.id) { console.error('[3/4] ' + tag + '：有事件没有 id'); bad++; continue; }
    if (evIds.has(ev.id)) {
      console.error('[3/4] ' + tag + '：事件 id 重复 ' + ev.id + '（后一条永远不触发）');
      bad++;
    }
    evIds.add(ev.id);
    checkWhen(ev.when, ev.id);
    /* mod 的 filter 也要能对上，否则"某编制 -4% 防御"会挂在一支不存在的部队上 */
    for (const ef of (ev.effects || [])) {
      if (ef.kind === 'mod' && ef.filter && ef.filter.corps && !corpsIds.has(ef.filter.corps)) {
        console.error('[3/4] ' + tag + ' · 事件 ' + ev.id + '：mod 的 filter.corps 不存在 ' + ef.filter.corps);
        bad++;
      }
      if (ef.kind === 'say' && !ef.text && !Array.isArray(ef.beats)) {
        console.error('[3/4] ' + tag + ' · 事件 ' + ev.id + '：say 既没有 text 也没有 beats');
        bad++;
      }
    }
  }

  if (bad === 0) console.log('[2/4] ' + tag + '：地图形状与地形字符合法（' + L.rows + '×' + L.cols + '）');
  if (bad === 0) console.log('[3/4] ' + tag + '：' + L.units.length + ' 个单位部署合法');
  fail += bad;
}

const cur = levelArg ? (api.levelById ? api.levelById(levelArg) : null) : api.LEVEL;
const L = cur || api.LEVEL;
const blue = L.units.filter(u => u.side === 'blue' && u.wave !== 0).reduce((s, u) => s + u.str, 0);
const red = L.units.filter(u => u.side === 'red' && u.wave !== 0).reduce((s, u) => s + u.str, 0);
console.log('');
console.log('关卡：' + (api.levelNoText ? api.levelNoText(L) : '') + L.name +
            ' · ' + L.maxTurns + ' 回合 · 目标 ' + (L.win || { kind: 'score' }).kind);
if (typeof api.runwayCells === 'function') {
  console.log('跑道格 ' + api.runwayCells().length + ' · 失守阈值 ' + L.runwayLossLimit + ' 格');
} else if (L.objectives) {
  const total = L.objectives.reduce((s, o) => s + o.vp, 0);
  const w = L.win || { kind: 'score' };
  if (w.kind === 'score') {
    console.log('要点 ' + L.objectives.length + ' 个 · 总分 ' + total +
                ' · 达成线 ' + L.winScore + ' · 超额线 ' + L.perfectScore);
  } else if (w.kind === 'reach') {
    console.log('要点 ' + L.objectives.length + ' 个 · 撤离区 ' +
                (w.zone ? '矩形 ' + JSON.stringify(w.zone) : (w.cells || []).length + ' 格') +
                ' · 需撤出 ' + w.count + ' 支');
  } else {
    console.log('要点 ' + L.objectives.length + ' 个 · 坚守 ' + L.maxTurns +
                ' 回合 · 必须保有 ' + ((w.keep || []).join(',') || '（无）'));
  }
}
console.log('我方战力 ' + blue + ' / 敌方战力 ' + red + '（比值 1 : ' + (red / blue).toFixed(2) + '）');
const res = L.units.filter(u => u.wave === 0);
if (res.length) {
  const rb = res.filter(u => u.side === 'blue').reduce((s, u) => s + u.str, 0);
  const rr = res.filter(u => u.side === 'red').reduce((s, u) => s + u.str, 0);
  console.log('事件预备队（不参与初始部署）：我方 ' + rb + ' / 敌方 ' + rr + ' 战力');
}

process.exit(fail ? 1 : 0);
