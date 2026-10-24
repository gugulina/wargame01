const path = require('path');
const { loadGame } = require('./load');

const file = path.join(__dirname, '..', 'game', 'campaign.html');
const { api } = loadGame(file);
const L = api.LEVEL;
const T = api.TYPE;

const ARMS = {
  hq: '旅部', inf: '步兵营', arm: '坦克营', art: '野战炮兵营',
  hr: '重型炮兵营', spa: '自行火炮营', eng: '工兵营', sup: '辎重营',
  rec: '侦察连', aa: '防空连', fgt: '战斗机中队'
};

function table(units) {
  const out = [];
  out.push('| 兵牌 | 番号 | 兵种 | 战力 | 机动 | 射程 | 弹药 | 初始位置 |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const u of units) {
    const r = u.rng === 0 ? '—'
      : (['art','hr','spa'].includes(u.type) ? `2–${u.rng}` : String(u.rng));
    const ammo = { art: 8, hr: 5, spa: 6 }[u.type] || '—';
    out.push(`| ${u.abbr} | ${u.name} | ${ARMS[u.type]} | ${u.str} | ${u.mov} | ${r} | ${ammo} | ${String.fromCharCode(65 + u.c)}${u.r + 1} |`);
  }
  return out.join('\n');
}

function group(side) {
  const us = L.units.filter(u => u.side === side);
  const corps = [...new Set(us.map(u => u.corps))];
  const parts = [];
  for (const c of corps) {
    const list = us.filter(u => u.corps === c);
    const label = c === 'S' ? (side === 'blue' ? '师直属' : '师直属')
      : `第 ${c} 旅`;
    parts.push(`### ${side === 'blue' ? '蓝方' : '红方'} · ${label}\n\n${table(list)}`);
  }
  return parts.join('\n\n');
}

console.log('# 编制总表\n');
console.log(group('blue'));
console.log('');
console.log(group('red'));
console.log('');
const b = L.units.filter(u => u.side === 'blue').reduce((s, u) => s + u.str, 0);
const r = L.units.filter(u => u.side === 'red').reduce((s, u) => s + u.str, 0);
console.log(`\n蓝方总战力 ${b} · 红方总战力 ${r} · 比值 1 : ${(r / b).toFixed(2)}`);
