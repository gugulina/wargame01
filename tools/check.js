const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGame } = require('./load');

const file = process.argv[2] || path.join(__dirname, '..', 'game', 'index.html');
let fail = 0;

const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 <script> 块');
  process.exit(1);
}
try {
  new vm.Script(m[1], { filename: file });
  console.log('[1/3] 语法校验通过，' + m[1].split('\n').length + ' 行');
} catch (e) {
  console.error('[1/3] 语法错误：' + e.message);
  process.exit(1);
}

const { api } = loadGame(file);
const L = api.LEVEL;

if (L.map.length !== L.rows) {
  console.error('[2/3] 地图行数 ' + L.map.length + ' ≠ rows ' + L.rows);
  fail++;
}
L.map.forEach((row, i) => {
  if (row.length !== L.cols) {
    console.error('[2/3] 第 ' + i + ' 行长度 ' + row.length + ' ≠ cols ' + L.cols + '：' + row);
    fail++;
  }
  for (const ch of row) {
    if (!api.TERRAIN[ch]) {
      console.error('[2/3] 第 ' + i + ' 行出现未定义地形字符：' + ch);
      fail++;
    }
  }
});
if (fail === 0) console.log('[2/3] 地图形状与地形字符合法（' + L.rows + '×' + L.cols + '）');

const seen = {};
for (const u of L.units) {
  if (u.r < 0 || u.r >= L.rows || u.c < 0 || u.c >= L.cols) {
    console.error('[3/3] ' + u.id + ' 坐标越界：' + u.r + ',' + u.c);
    fail++;
    continue;
  }
  if (api.TYPE && !api.TYPE[u.type]) {
    console.error('[3/3] ' + u.id + ' 兵种代号未定义：' + u.type);
    fail++;
  }
  const ch = L.map[u.r][u.c];
  if (api.TERRAIN[ch].cost >= 99) {
    console.error('[3/3] ' + u.id + ' 部署在不可通行地形（' + api.TERRAIN[ch].name + '）：' + u.r + ',' + u.c);
    fail++;
  }
  /* 三波次共用一张图，必须全局不重叠 */
  const key = u.r + ',' + u.c;
  if (seen[key]) {
    console.error('[3/3] ' + u.id + ' 与 ' + seen[key] + ' 部署位置重叠：' + u.r + ',' + u.c);
    fail++;
  }
  seen[key] = u.id;
}

/* 指挥部与下属的 corps 对应 */
const HQ_TYPES = api.HQ_TYPES || ['hq'];
const hqCorps = new Set(L.units.filter(u => HQ_TYPES.includes(u.type)).map(u => u.side + ':' + u.corps));
for (const u of L.units) {
  if (HQ_TYPES.includes(u.type)) continue;
  if (!hqCorps.has(u.side + ':' + u.corps)) {
    console.log('[提示] ' + u.id + '（' + u.name + '）无本部指挥牌，常年脱指（恢复 ' +
      (u.side === 'blue' ? 7 : 12) + '/回合）');
  }
}

if (fail === 0) console.log('[3/3] ' + L.units.length + ' 个单位部署合法');

const blue = L.units.filter(u => u.side === 'blue' && u.wave !== 0).reduce((s, u) => s + u.str, 0);
const red = L.units.filter(u => u.side === 'red' && u.wave !== 0).reduce((s, u) => s + u.str, 0);
console.log('');
console.log('关卡：' + L.name + ' · ' + L.maxTurns + ' 回合');
if (typeof api.runwayCells === 'function') {
  console.log('跑道格 ' + api.runwayCells().length + ' · 失守阈值 ' + L.runwayLossLimit + ' 格');
} else if (L.objectives) {
  const total = L.objectives.reduce((s, o) => s + o.vp, 0);
  console.log('要点 ' + L.objectives.length + ' 个 · 总分 ' + total +
              ' · 达成线 ' + L.winScore + ' · 超额线 ' + L.perfectScore);
}
console.log('我方战力 ' + blue + ' / 敌方战力 ' + red + '（比值 1 : ' + (red / blue).toFixed(2) + '）');
const res = L.units.filter(u => u.wave === 0);
if (res.length) {
  const rb = res.filter(u => u.side === 'blue').reduce((s, u) => s + u.str, 0);
  const rr = res.filter(u => u.side === 'red').reduce((s, u) => s + u.str, 0);
  console.log('事件预备队（不参与初始部署）：我方 ' + rb + ' / 敌方 ' + rr + ' 战力');
}

process.exit(fail ? 1 : 0);
