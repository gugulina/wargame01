/* 编制表一致性审计。

   查的不是"每关能不能打"，而是**同一支部队在不同关卡里编成对不对得上**：
   第 103 步兵师在第 1 关是几个营？第 107 步兵师在第 2 关又是几个营？
   第 201 坦克旅与第 205 装甲旅都是旅，编成该不该一个样？
   独立第 1 旅在第 3 关和第 3 关附属里，营数有没有凭空多出来、兵种有没有变？

   用法：
     node tools/orgcheck.js [game/campaign.html]
     node tools/orgcheck.js [file] --md     输出 Markdown 表，可直接贴进文档
   退出码非零表示发现编成不一致。

   ── 分组为什么按 corps 而不是按名字正则 ──
   第一版是拿正则从兵牌名字里抠"第 X 步兵师"当番号，三个坑：
     ·「边防第 1 旅第 1 营」和「第 1 边防旅旅部」抠出来是两个番号
     ·「敌战斗群第 1 营」压根没有番号，整片掉进"未归并"
     ·「西部军区独立第 1 旅」前面多挂一个军区名就对不上
   引擎自己已经用 corps 把同一编制的兵牌编好组了，直接用这个分组，
   再拿该编制**指挥牌的名字**当番号——指挥牌名字天然带完整番号，
   而且每个编制必然有一张（没有的那是数据缺陷，check.js 会单独提示）。 */
const path = require('path');
const { loadGame } = require('./load');

const args = process.argv.slice(2);
const md = args.includes('--md');
const fileArg = args.find(a => !a.startsWith('-'));
const file = fileArg ? path.resolve(fileArg) : path.join(__dirname, '..', 'game', 'campaign.html');
const { api } = loadGame(file);

const ARMS = {
  hqd: '师部', hqb: '旅部', hkg: '群部', hkc: '军部', hq: '指挥部',
  inf: '步兵营', mob: '摩步营', mech: '装步营', gdn: '守备营',
  larm: '轻坦营', marm: '中坦营', harm: '重坦营',
  art: '炮兵营', hr: '重炮营', sha: '自行炮连',
  at: '反坦克连', eng: '工兵营', engc: '工兵连',
  sup: '辎重队', aab: '高炮营', aac: '防空连', fgt: '战斗机中队'
};
const armOf = u => ARMS[u.type] || u.type;

/* 把指挥牌名字洗成番号主干：
   「西部军区独立第 1 旅旅部」→「独立第1旅」
   「敌第 21 步兵师先遣支队部」→「第21步兵师先遣支队」
   「岚口机场场站司令部」→ 原样（不是战役编制，单独成组）
   顺序有讲究：先去前缀，再削后缀，最后压空格。 */
function canonName(raw) {
  let n = String(raw || '').replace(/\s+/g, '');
  n = n.replace(/^(西部军区|军区|方面军)/, '');
  n = n.replace(/^敌/, '');
  /* 后缀「师部 / 旅部 / 前进指挥所 / 残部」只是同一支部队的另一种叫法，
     不该另算一支部队——不然 C3 的「第 205 装甲旅旅部」和 C3B 的
     「第 205 装甲旅前进指挥所」会被当成两支不同的部队，永远比不出差异。 */
  n = n.replace(/(前进指挥所|指挥所|司令部|师部|旅部|群部|军部|支队部|残部)+$/, '');
  return n || raw || '（无名）';
}

const levels = (api.LEVELS || []).filter(l => l.ready);

/* orgs[side|canon] = { side, name, byLv: { lvId: { level, corps, units } } } */
const orgs = {};
for (const L of levels) {
  for (const side of ['blue', 'red']) {
    const corpsSet = [...new Set(L.units.filter(u => u.side === side).map(u => u.corps))];
    for (const corps of corpsSet) {
      const units = L.units.filter(u => u.side === side && u.corps === corps);
      const hq = units.find(u => api.isHQ(u));
      const canon = canonName(hq ? hq.name : units[0].name);
      const key = side + '|' + canon;
      if (!orgs[key]) orgs[key] = { side, name: canon, byLv: {} };
      orgs[key].byLv[L.id] = { level: L, corps, units };
    }
  }
}

/* 编成签名：按兵种统计数量。两个关卡编成一致 → 签名相同 */
const sig = units => {
  const c = {};
  for (const u of units) c[armOf(u)] = (c[armOf(u)] || 0) + 1;
  return Object.keys(c).sort().map(k => k + '×' + c[k]).join(' ');
};
const strOf = units => units.reduce((s, u) => s + u.str, 0);
const pad = (s, n) => {
  const w = [...String(s)].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};

const keys = Object.keys(orgs).sort((a, b) => {
  const [sa, na] = a.split('|'), [sb, nb] = b.split('|');
  if (sa !== sb) return sa === 'blue' ? -1 : 1;
  return na.localeCompare(nb, 'zh');
});

const problems = [];   // 硬错：同一支部队的兵种/指挥等级变了
const notes = [];      // 软提示：数量差异（可能是残部 / 加强）、同型编制规模差异
const rows = [];

for (const key of keys) {
  const o = orgs[key];
  const seen = levels.map(l => o.byLv[l.id]).filter(Boolean);
  if (!seen.length) continue;
  const cells = levels.map(l => {
    const s = o.byLv[l.id];
    return s ? sig(s.units) + '（' + strOf(s.units) + '）' : '—';
  });
  rows.push({ side: o.side, name: o.name, cells });

  if (seen.length > 1) {
    const sigs = [...new Set(seen.map(s => sig(s.units)))];
    if (sigs.length > 1) {
      notes.push('编成有差异 · ' + o.name + '（' + (o.side === 'blue' ? '我方' : '敌方') + '）：' +
                 seen.map(s => s.level.id + ' ' + sig(s.units) + '（' + strOf(s.units) + '）').join(' / '));
    }
  }
}

/* ── 硬错：同一块兵牌（按番号认）在不同关卡里兵种变了 ──
   这是玩家真能一眼看出来的那类错：同一支「第 205 装甲旅第 2 营」，
   在第 3 关是中型坦克营、在第 3 关附属里变成轻型坦克营。
   数量少几个营可以解释成"残部"，兵种变了解释不了。
   指挥牌还要比等级：旅部（hqb，光环 2 格）写成师部（hqd，光环 3 格），
   等于凭空给这支部队多一圈指挥半径。 */
const nameType = {};   // side|name → { type: [lvId], hqType: [lvId] }
for (const L of levels) {
  for (const u of L.units) {
    /* 番号归一：去掉「残部 / （轻坦）/（中坦）/ 括号注释」，只留主干 */
    const nm = String(u.name).replace(/（[^）]*）/g, '').replace(/残部$/, '').trim();
    const key = u.side + '|' + nm;
    const rec = nameType[key] = nameType[key] || { side: u.side, name: nm, arms: {}, hqs: {} };
    (rec.arms[u.type] = rec.arms[u.type] || []).push(L.id);
    if (api.isHQ(u)) (rec.hqs[u.type] = rec.hqs[u.type] || []).push(L.id);
  }
}
for (const key of Object.keys(nameType).sort()) {
  const rec = nameType[key];
  const armKeys = Object.keys(rec.arms);
  if (armKeys.length > 1) {
    problems.push({
      name: rec.name, side: rec.side,
      detail: '兵种不一致：' + armKeys.map(t => (ARMS[t] || t) + '（' + rec.arms[t].join('/') + '）').join(' vs ')
    });
  }
  const hqKeys = Object.keys(rec.hqs);
  if (hqKeys.length > 1) {
    problems.push({
      name: rec.name, side: rec.side,
      detail: '指挥等级不一致：' + hqKeys.map(t => (ARMS[t] || t) + '（' + rec.hqs[t].join('/') + '）').join(' vs ')
    });
  }
}

/* ── 师 / 军 必须有「团」这一级 ──────────────────────────────
   docs/06 定的编制是「师辖团、团辖营」，只有旅才直辖营。
   这条最容易写漏：新建一个师时顺手写「第 X 步兵师第 1 营」，
   一个师就直辖了三个营——编制表上看不出团在哪一级，跟旅的编成也分不清。
   第 103 步兵师原来就是这么写的，被问过一次才补回来。

   豁免：先遣支队 / 支队 / 群 / 预备役 / 残部 这类临时编组，
   本来就没有完整的三团建制；以及只有 HQ、没有战斗营的空壳编制。 */
const FIGHTING = ['inf', 'mob', 'mech', 'gdn', 'larm', 'marm', 'harm', 'arm'];
const EXEMPT = /(支队|先遣群|守备群|群部|预备|残部|战斗群|纵队|演习)/;
for (const key of keys) {
  const o = orgs[key];
  if (EXEMPT.test(o.name)) continue;
  for (const id of Object.keys(o.byLv)) {
    const s = o.byLv[id];
    const hq = s.units.find(u => api.isHQ(u));
    if (!hq || !['hqd', 'hkc', 'hkg'].includes(hq.type)) continue;
    const fighters = s.units.filter(u => FIGHTING.includes(u.type));
    if (!fighters.length) continue;
    /* 侦察营是师属分队，本来就不编在团里；有「团」字或名字里带侦察营的都不算漏 */
    const lost = fighters.filter(u => !/团/.test(u.name) && !/侦察营/.test(u.name));
    if (lost.length) {
      problems.push({
        name: o.name, side: o.side,
        detail: id + '：「' + hq.name + '」直辖 ' + lost.length + ' 个营，中间没有团 —— ' +
                lost.map(u => u.name).join('、')
      });
    }
  }
}

/* 同类型编制之间规模差一倍以上——不是错，但值得看一眼是不是漏写了兵牌。
   只比同一兵种大类的编制（师 vs 师、旅 vs 旅），跨类不比。 */
const typeOf = name => {
  if (/步兵师/.test(name)) return '步兵师';
  if (/装甲旅|坦克旅/.test(name)) return '装甲旅';
  if (/步兵旅|边防旅/.test(name)) return '步兵旅';
  if (/团战斗群/.test(name)) return '团战斗群';
  return null;
};
const byType = {};
for (const key of keys) {
  const o = orgs[key];
  const t = typeOf(o.name);
  if (!t) continue;
  for (const id of Object.keys(o.byLv)) {
    const s = o.byLv[id];
    (byType[o.side + '|' + t] = byType[o.side + '|' + t] || []).push(
      { lv: id, name: o.name, str: strOf(s.units) });
  }
}
for (const k in byType) {
  const list = byType[k].slice().sort((a, b) => a.str - b.str);
  if (list.length < 2) continue;
  const lo = list[0], hi = list[list.length - 1];
  if (hi.str / Math.max(1, lo.str) >= 1.6) {
    notes.push(k.split('|')[1] + '：' +
               list.map(x => x.name + '（' + x.lv + '，' + x.str + ' 战力）').join(' vs ') +
               ' —— 规模差 ' + (hi.str / lo.str).toFixed(1) + ' 倍');
  }
}

if (md) {
  console.log('| 阵营 | 部队 | ' + levels.map(l => l.id).join(' | ') + ' |');
  console.log('|---'.repeat(2 + levels.length) + '|');
  for (const r of rows) {
    console.log('| ' + (r.side === 'blue' ? '我方' : '敌方') + ' | ' + r.name + ' | ' + r.cells.join(' | ') + ' |');
  }
  if (problems.length) {
    console.log('');
    console.log('### 硬错：同一支部队的兵种 / 指挥等级变了');
    console.log('');
    for (const p of problems) {
      console.log('- **' + p.name + '**（' + (p.side === 'blue' ? '我方' : '敌方') + '）—— ' + p.detail);
    }
  }
  if (notes.length) {
    console.log('');
    console.log('### 提示：编成数量差异（残部 / 加强，属可解释范围）');
    console.log('');
    for (const n of notes) console.log('- ' + n);
  }
} else {
  const header = pad('阵营', 6) + pad('部队', 24) + levels.map(l => pad(l.id, 40)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    console.log(pad(r.side === 'blue' ? '我方' : '敌方', 6) + pad(r.name, 24) +
                r.cells.map(c => pad(c, 40)).join(''));
  }
  console.log('');
  if (problems.length) {
    console.log('✗ 硬错 ' + problems.length + ' 处（同一支部队的兵种 / 指挥等级变了）：');
    for (const p of problems) {
      console.log('   · ' + p.name + '（' + (p.side === 'blue' ? '我方' : '敌方') + '）—— ' + p.detail);
    }
  } else {
    console.log('✓ 同一支部队在各关之间兵种、指挥等级一致');
  }
  if (notes.length) {
    console.log('');
    console.log('… 编成数量差异 ' + notes.length + ' 条（残部 / 加强，属可解释范围）：');
    for (const n of notes) console.log('   · ' + n);
  }
}

process.exit(problems.length ? 1 : 0);
