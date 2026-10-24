/* 变异自检：确认 selftest 的断言**真的会红**。
   用法：node tools/mutcheck.js [--keep]

   为什么要这东西：断言写错时最怕的不是红，是**假绿**。
   38b8b3d 给存档 XSS 加的那条断言就是这么废掉的——它检查 msg 里有没有 `<b`，
   而 msg 里从来不会有 `<b`（那是渲染端拼的），改回 innerHTML 它照样绿。
   所以真做法只有一种：把实现改回错的，看它红不红。

   这脚本干的活就是自动做这一步：对 campaign.html 做定点变异（mutant），
   每变异一次跑一遍 selftest，要求**至少一条特定的断言变红**。
   全都没红 = 那条断言是假防线，得重写。

   锚点是原文精确匹配（含缩进）。锚点找不到会直接报出来——
   这不是脚本坏了，是引擎那行代码被改过，说明 MUTANTS 表该更新了。 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'game', 'campaign.html');
const TMP = path.join(ROOT, 'game', '_mut_campaign.html');

/* [说明, 原文锚点, 替换成, 期望变红的断言名（子串匹配）]
   每条盯一个机制，别贪多：一个变异只该打中一两条，打中一片说明断言互相耦合了。 */
const MUTANTS = [
  ['空中不再恒 1 点（air 分支失效，落到地形价）',
   "  if (dm === 'air') return 1;",
   "  if (dm === 'air' && false) return 1;",
   '空中一律 1 点'],

  ['占位名额全回落成 2（空中 / 水面不再一格一支）',
   '  return s === undefined ? STACK_MAX : s;',
   '  return STACK_MAX;',
   '空中一格一支'],

  ['unitAt 不分层（敌机压要点就算占领）',
   'function unitAt(r, c) { return surfaceAt(r, c) || airAt(r, c); }',
   'function unitAt(r, c) { const a = unitsAt(r, c); return a.length ? a[a.length - 1] : null; }',
   'unitAt 优先返回地表部队'],

  ["蓝水进不了浅海（NAV.blue.cells 去掉 's'）",
   "blue:  { name: '蓝水', label: '蓝', cells: ['s', 'd'] }",
   "blue:  { name: '蓝水', label: '蓝', cells: ['d'] }",
   '蓝水能退回浅海'],

  ['空中也吃地形防御加成',
   'let d = isAir(u) ? 0 : terrainAt(u.pos[0], u.pos[1]).def;',
   'let d = terrainAt(u.pos[0], u.pos[1]).def;',
   '飞机蹲在城里也只有 0 地形加成'],

  ['谁都能打飞机（canHitAir 恒真）',
   'function canHitAir(u) { return isAA(u) || isAir(u); }',
   'function canHitAir(u) { return true; }',
   '普通地面炮兵列不出空中目标'],

  ['空中也吃 ZOC（computeReach 里去掉 air 豁免）',
   'if (air || !inEnemyZOC(nr, nc, u.side)) pool.push([nd, nr, nc]);',
   'if (!inEnemyZOC(nr, nc, u.side)) pool.push([nd, nr, nc]);',
   '空中：同起点同预算能飞到'],

  ['select 去掉 null 兜底（截图钩子取不到单位就崩）',
   '  if (!u) return;\n  FX.sfx(\'select\');',
   '  FX.sfx(\'select\');',
   'select(null) 不抛异常'],

  ['tclass 不再看 tc（潜艇按水面舰算，战列舰就能打它了）',
   '  if (t && t.tc) return t.tc;',
   '  if (t && t.tc && false) return t.tc;',
   '战列舰打不了潜艇'],

  ['canTarget 不查 atk 白名单（轰炸机能主动挑飞机）',
   '  const ac = attackClasses(att);\n  if (ac && !ac.includes(tclass(def))) return false;',
   '  const ac = attackClasses(att);\n  if (false && ac && !ac.includes(tclass(def))) return false;',
   '轰炸机不能主动挑飞机打'],

  ['aaPenalty 退回按代号硬认 aac/aab（舰载防空全失效）',
   '    if (hexDist(a.pos, defPos) <= (T.aaRange || 2)) p = Math.max(p, T.aaPen || 0.30);',
   "    if (hexDist(a.pos, defPos) <= 2 && (a.type === 'aac' || a.type === 'aab')) p = Math.max(p, 0.30);",
   '巡洋舰半径 3 内压制'],

  ['vs / vsType 没接进 previewAttack（兵种表写了也不生效）',
   '    if (TA.vs) attMod += TA.vs[tclass(def)] || 0;\n    if (TA.vsType) attMod += TA.vsType[def.type] || 0;',
   '    void TA;',
   '战斗机：打飞机明显强于打地面'],

  ['空投落不下也把载货扣掉（算错位置要赔一整趟运输）',
   "    if (!p) {\n      log('空投失败：",
   "    if (!p) {\n      u.load = null;\n      log('空投失败：",
   '投不下去就不执行'],

  /* ── 第四关引出的三条：舰队补给 / 全灭判胜 / 附属关解锁 ── */
  ['舰队不再按码头判补给（水面格永远走补给场，一律"断绝"）',
   '  if (isNaval(u)) {',
   '  if (false && isNaval(u)) {',
   '七艘全部补给充足'],

  ['敌军全灭不看波次（清掉第一波就当场通关）',
   "  return (LEVEL.waves || []).every(w => state.flags['wave' + w.wave]);",
   '  return true;',
   '波次还没入场时清完场上的敌人不算通关'],

  ['附属关挡主线解锁（删掉 sub 跳过）',
   '    if (pre.sub) continue;',
   '',
   '第四关的前置是第 3 关'],

  /* ── 爽局方向的两个机制 ──
     这两条都是"让舰队真的能打"，不是"给玩家发福利"：
     舰队每回合都开火，一旦补弹要求"本回合没开火"，实际效果就是永远补不上——
     弹打光了舰队还算在场，只是不再开枪。 */
  ['舰船补弹退回「这一回合没开火才算」（舰队每回合开火 = 永远补不上）',
   "    } else if (isNaval(u) && !u.moved && s.label === '充足') {",
   "    } else if (isNaval(u) && !u.moved && !u.fired && s.label === '充足') {",
   '舰船停泊 + 补给充足时，开过火的回合也补弹'],

  /* ── v4.6 的崩溃机制 ── */
  ['崩溃的部队照样能列攻击目标（删掉 targetsFor 里那道闸）',
   '  if (isBroken(u)) return [];',
   '  if (false) return [];',
   '崩溃的部队列不出攻击目标'],

  ['崩溃的部队绕过 doAttack 也能打出去（删掉第二道闸）',
   "  if (isBroken(att)) {\n    log(att.abbr + ' 建制崩溃，组织不起进攻。', 'sys');\n    return false;\n  }",
   '',
   '崩溃单位直接调 doAttack 也打不出去'],

  ["崩溃收拢改成'结算完再看谁还崩着'（自然恢复一回合就跨过恢复线，+10 永远发不出来）",
   '  const rallying = state.units.filter(u => u.str > 0 && isBroken(u));',
   '  const rallying = [];',
   '脱离接触 + 补给未断：崩溃部队每回合额外 +10 组织度'],

  ['防空阵地不加对空修正（删掉 aaBunkerBonus 的加成）',
   "  return (FORT.F.aaBack && FORT.F.aaBack.bonus) || 0.55;",
   '  return 0;',
   '对空中目标：站在阵地上拿到 +0.55'],

  /* ── 存档校验：这两条要证明"导入那道闸真的在用" ── */
  ['导入路径不再校验存档内容（只留 v 与 lv）',
   "    const v = validateSave(pack.save);\n    if (!v.ok) return { ok: false, msg: '存档内容有问题：' + v.msg };",
   '',
   '导入被污染的存档 → 失败并说明原因'],

  ['兵种合法性不校验（改坏的兵种能写进存档）',
   "    if (!TYPE[u.type]) return { ok: false, msg: '部队 ' + u.id + ' 的兵种「' + u.type + '」不存在。' };",
   '',
   '兵种不存在 → 拒绝'],
];

/* 锚点按 LF 写，但 campaign.html 是 CRLF（7356 行全是）。
   直接 includes 会一律找不到，所以两种换行都试一遍——否则这张表会慢慢"全部失效"，
   而失效的表现是每条都报"锚点找不到"，看起来像脚本坏了。 */
function resolve(base, anchor, neu) {
  if (base.includes(anchor)) return [anchor, neu];
  const a = anchor.replace(/\n/g, '\r\n');
  if (base.includes(a)) return [a, neu.replace(/\n/g, '\r\n')];
  return null;
}

const base = fs.readFileSync(SRC, 'utf8');
let bad = 0;
try {
  for (const [name, old, neu, expect] of MUTANTS) {
    const anchor = resolve(base, old, neu);
    if (!anchor) {
      console.log('  ? ' + name + '\n    锚点找不到，引擎这行改过了，MUTANTS 表要更新');
      bad++;
      continue;
    }
    fs.writeFileSync(TMP, base.replace(anchor[0], anchor[1]), 'utf8');
    const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'selftest.js'), TMP],
      { encoding: 'utf8', env: process.env });
    const out = (r.stdout || '').split('\n');
    const reds = out.filter(l => l.trim().startsWith('✗')).map(l => l.trim());
    const hit = reds.some(l => l.includes(expect));
    console.log((hit ? '  ✓ ' : '  ✗ ') + name + (hit ? '' : '  → 期望「' + expect + '」变红，但它没红'));
    if (!hit) {
      reds.slice(0, 4).forEach(l => console.log('      实际红：' + l));
      bad++;
    }
  }
} finally {
  /* 中途抛异常也要擦干净：这个文件躺在 game/ 里，留着会被打包、也会被 git 看见。 */
  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
}

console.log(bad ? '\n变异自检：' + bad + ' 条断言是假防线' : '\n变异自检：全部断言真会红');
process.exit(bad ? 1 : 0);
