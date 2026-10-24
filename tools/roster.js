const path = require('path');
const { loadGame } = require('./load');

const file = path.join(__dirname, '..', 'game', 'campaign.html');
const { api } = loadGame(file);
const L = api.LEVEL;
const T = api.TYPE;

/* ── --types：兵种总表，直接从引擎的 TYPE 表生成 ──
   为什么要这一个模式：docs/06 那张"兵种数值总表"是手抄的，抄到最后
   还留着 `arm` / `mnt` / `sig` / `hqr` 四个**引擎里定义数为 0** 的键，
   还写着"反坦克连对 arm 攻击 ×1.8"这种指向已删兵种的规则。
   手抄的表必然会脱节，只有生成才不会。
   顺带说清一件事：v4 之后"兵种"不再决定战力和机动——那是每张兵牌
   自己的 str / mov（见各关编制表）。TYPE 只管**能力**：射程、弹药、
   领域、对谁有加成、能不能占点。所以这张表里没有"战力"这一列，
   不是漏了，是它本来就不在这层。 */
const DM_LABEL = { ground: '地面', air: '空中', green: '内河', blue: '海上' };
const DM_ORDER = ['ground', 'air', 'green', 'blue'];

function typeTable() {
  const out = [];
  out.push('| 代号 | 兵种 | 职责 | 弹药 | 射程 | 机动 | 领域 | 可占点 | 对空 |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  const ids = Object.keys(T);
  const rank = id => {
    const t = T[id];
    const dm = t.dm || 'ground';
    return DM_ORDER.indexOf(dm) * 100 + (id === 'inf' ? 0 : 1);
  };
  ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const id of ids) {
    const t = T[id];
    const dm = t.dm || 'ground';
    const am = (t.am === undefined || t.am === 0) ? '—' : String(t.am);
    /* 没有 rg / mv 的不是"没填"，是走默认值（地面单位射程 1、机动按兵牌）。
       写成"默认"而不是"—"，免得读者以为这兵种不能动。 */
    const rg = t.rg === undefined ? '默认' : String(t.rg);
    const mv = t.mv === undefined ? '默认' : String(t.mv);
    const cap = api.CAPTURE_TYPES.indexOf(id) >= 0 ? '是' : '—';
    const aa = t.aa ? ('半径 ' + (t.aaRange || 2) + ' / −' + Math.round((t.aaPen || 0) * 100) + '%') : '—';
    out.push('| `' + id + '` | ' + t.name + ' | ' + (t.role || '—') + ' | ' + am +
             ' | ' + rg + ' | ' + mv + ' | ' + (DM_LABEL[dm] || dm) + ' | ' + cap + ' | ' + aa + ' |');
  }
  return out.join('\n');
}

if (process.argv.includes('--types')) {
  console.log('<!-- 本表由 node tools/roster.js --types 生成，请勿手改；改了引擎就重跑 -->');
  console.log(typeTable());
  console.log('');
  console.log('共 ' + Object.keys(T).length + ' 个兵种。' +
              '「默认」= 该兵种没有覆盖 mv/rg，走地面单位默认值（射程 1、机动按兵牌）。');
  process.exit(0);
}

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
