/* 变异自检：确认 selftest 的断言**真的会红**。
   用法：node tools/mutcheck.js [--keep] [--grep=关键字]

   --grep 只跑名字里含关键字的几条。全量现在 72 条、其中 27 条要起 jsdom，
   跑一遍三分多钟；调某一条断言时没必要等全部。

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

/* [说明, 原文锚点, 替换成, 期望变红的断言名（子串匹配）, 跑哪个脚本]
   每条盯一个机制，别贪多：一个变异只该打中一两条，打中一片说明断言互相耦合了。

   第 5 项省略时跑 selftest；写 'brief' 表示跑 briefcheck（jsdom）。
   **漏写第 5 项不会报错，只会静默地跑 selftest**——如果那条断言其实在 briefcheck 里，
   表现就是"期望变红但它没红"，看起来像断言是假防线，其实是脚本跑错了。
   加条目时先想清楚这条断言在哪个文件里。
   DOM 那一类防线（esc 转义、战报走 textContent）在 vm 沙箱里根本没有 DOM，
   只能在 briefcheck 里验——而"验它会不会红"同样得跑一遍变异，
   否则 v4.6 体检里那条假防线（检查 msg 里有没有 `<b`）的事会重演。 */
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
   "    if (s.label !== '充足') return { ok: false, label: '不补', why: '不在码头补给圈' };",
   "    if (s.label !== '充足' || u.fired) return { ok: false, label: '不补', why: '不在码头补给圈' };",
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

  /* ── v4.6 体检补的存档防线 ── */
  ['存档写失败不再报警（退回"只 return false"的老样子）',
   '  if (state && !state.saveBroken) {',
   '  if (false) {',
   '写失败后 state.saveBroken 被置位'],

  ['兵牌名 / 简写不校验字符（假的 "<img onerror>" 名字能进内存）',
   "    if (saveStrBad(u.name, 64)) return { ok: false, msg: '部队 ' + u.id + ' 的名称里有不允许的字符。' };",
   '',
   '兵牌名里带标签 → 拒绝'],

  ['地图只验行数不验地形字符（一行引号能撕开棋盘 HTML）',
   "      if (!TERRAIN[ch]) return { ok: false, msg: '存档地图第 ' + (r + 1) + ' 行有未知地形「' + ch + '」。' };",
   '',
   '地图里出现未知地形字符 → 拒绝'],

  ['战报条数不限（一份档能塞十万条把渲染拖死）',
   "    if (s.log.length > 200) return { ok: false, msg: '存档的战报条数异常（' + s.log.length + ' 条）。' };",
   '',
   '战报条数异常 → 拒绝'],

  ['修正说明不校验字符（mods.label 直接拼进 HUD）',
   "    if (m.label !== undefined && (typeof m.label !== 'string' || m.label.length > 80 ||\n          SAVE_STR_BAD.test(m.label))) {",
   '    if (false) {',
   '修正说明里带标签 → 拒绝'],

  /* ── DOM 出口：这两条只能在 jsdom 里验，所以第 5 项写 'brief' ── */
  ['兵牌 / 面板不再转义（esc 失效，出口重新开门）',
   "  .replace(/</g, '&lt;')",
   '',
   '棋盘里没有长出 <img>',
   'brief'],

  /* 原来的「战报退回拼 innerHTML」已经由下面两条取代：renderLog 从
     `textContent = text` 改成了 `innerHTML = bold(esc(text))`，
     旧锚点 `d.textContent = String(l.text);` 在引擎里不存在了。
     留着只会报"锚点找不到"——这类失效锚点比没断言更坏，
     它会让整张表看起来还在守，实际那条早已空转。 */

  ['存档异常胶囊永不亮（写失败又变回静默）',
   "  el.style.display = bad ? '' : 'none';",
   "  el.style.display = 'none';",
   '顶栏胶囊亮起来',
   'brief'],

  ['胶囊点了没反应（玩家知道坏了却没有出路）',
   "document.getElementById('saveWarn').addEventListener('click', () => {\n" +
   "  FX.sfx('uiClick');\n  openHQ('save');\n});",
   "document.getElementById('saveWarn').addEventListener('click', () => {\n" +
   "  FX.sfx('uiClick');\n});",
   '点胶囊落在存档页（导出是唯一出路）',
   'brief'],

  ['viewport 重新钉死缩放（WCAG 1.4.4 违规，开发机上看不出来）',
   'content="width=device-width, initial-scale=1, viewport-fit=cover"',
   'content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"',
   'viewport 没有禁掉用户缩放',
   'brief'],

  /* ── 键盘光标（P2-2）：这一组全是"界面上的手感"，最容易写出一条
     只验了类名、不验坐标的假绿。所以断言一律核到 dataset。 ── */
  ['键盘光标不夹边界（顶到边上会绕到对面一行）',
   "  const r = Math.max(0, Math.min(LEVEL.rows - 1, kbCur[0] + dr));\n" +
   "  const c = Math.max(0, Math.min(LEVEL.cols - 1, kbCur[1] + dc));",
   "  const r = (kbCur[0] + dr + LEVEL.rows) % LEVEL.rows;\n" +
   "  const c = (kbCur[1] + dc + LEVEL.cols) % LEVEL.cols;",
   '顶到边界就停住，不绕到对面',
   'brief'],

  ['键盘光标不画出来（选了但屏幕上没标记）',
   "      if (kbCur && kbCur[0] === r && kbCur[1] === c) cls += ' kbcur';",
   "      if (false) cls += ' kbcur';",
   '光标格画出来了',
   'brief'],

  ['光标移动后不重画（高亮停在旧格）',
   "  kbCur = [r, c];\n  kbAnnounce();\n  render();\n  kbScrollIntoView();",
   "  kbCur = [r, c];\n  kbAnnounce();\n  kbScrollIntoView();",
   '移动后高亮落在新格上',
   'brief'],

  ['aria-activedescendant 不设（读屏不知道光标在哪一格）',
   "  if (kbCur && state) b.setAttribute('aria-activedescendant', 'h' + kbCur[0] + '-' + kbCur[1]);",
   "  if (false) b.setAttribute('aria-activedescendant', 'h' + kbCur[0] + '-' + kbCur[1]);",
   'aria-activedescendant 指向那一格',
   'brief'],

  ['回车不再等于"点这一格"（键盘用户选完什么都做不了）',
   'function kbEnter() {\n  if (!state || state.result) return false;',
   'function kbEnter() {\n  if (true) return false;',
   '回车选中了光标格的部队',
   'brief'],

  ['方向键不判焦点（Tab 到顶栏后按方向键，地图上的光标会乱走）',
   "  if (boardEl && document.activeElement === boardEl) {",
   "  if (boardEl) {",
   '焦点在顶栏按钮时方向键不动棋盘',
   'brief'],

  ['关掉 HQ 不还焦点（键盘用户被丢回 body，下一次 Tab 从页首数起）',
   '    if (back && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } }',
   '    if (false && back) { }',
   '关掉 HQ 后焦点回到棋盘',
   'brief'],

  /* ── 防空同格反击 / 空袭 HQ 的目标指示 ──
     这两条都是玩家实测报上来的：一个"高炮在敌机贴脸时不还手"，
     一个"敌机隔着战场点掉指挥部"。断言必须盯住行为，不是盯住注释。 */
  ['近界对空也生效（玩家报的 bug 原样退回：敌机压头顶，高炮不还手）',
   '  if (!isAir(att) && hexDist(att.pos, def.pos) < minRange(def)) return false;',
   '  if (hexDist(att.pos, def.pos) < minRange(def)) return false;',
   '同格空袭时防空连能反击'],

  ['空袭 HQ 不再需要目标指示（敌机又能隔空点名指挥部）',
   '  if (isAir(att) && isHQ(def) && !hqAirSpotOk(att.side, def.pos)) return false;',
   '  if (false) return false;',
   '没有任何指示者时，飞机打不了 HQ'],

  ['飞机也算"看见"（自己给自己指示，等于没有这条规则）',
   '    if (isAir(u)) return false;                       // 飞机不能当自己的指示者',
   '    if (false) return false;',
   '飞机贴着 HQ 也不算"看见"'],

  ['所有兵种都按侦察半径算（普通营也能在 2 格外指示 HQ）',
   "    return hexDist(u.pos, pos) <= (u.type === 'rec' ? 2 : 1);",
   '    return hexDist(u.pos, pos) <= 2;',
   '普通地面部队在 2 格外不能指示'],

  ['HQ 的空袭掩体修正没进 attMod（一次空袭就能抹掉一个师部）',
   '  if (isHQ(def) && isAir(att)) attMod -= 0.20;',
   '',
   '空袭 HQ 的攻击方多 -0.20'],
  /* 手册文案那一类：断言打在渲染口 / 数据侧，所以变异也要分两边打。 */
  ['加粗标记不再转换（兵种说明满天星号）',
   "    .replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<b>$1</b>');",
   "    .replace(/\\*\\*([^*\\n]+)\\*\\*/g, '$1');",
   '加粗真的渲染成 <b>', 'brief'],

  ['HQ 页签清单少了 dex（菜单页的「战时手册」静默落到存档页）',
   "const HQ_TABS = ['dex', 'mech', 'aide', 'notes', 'save', 'credits'];",
   "const HQ_TABS = ['mech', 'aide', 'notes', 'save', 'credits'];",
   'HQ_TABS 与页签按钮一一对应', 'brief'],

  ['文案里塞回超出二战水平的装备（战斗机挂空空导弹）',
   "'对空 +0.60：它是唯一能主动猎杀敌方飞机的兵种，制空权靠它抢'",
   "'对空 +0.60：开着加力追上去，挂空空导弹见谁打谁'",
   '文案里没有超出二战水平的装备'],

  /* 防空压制（驱散）：三条都是少写一句守卫就会静默失效的地方。 */
  ['压制不再封住原地休整（飞机蹲在伞下照样回血）',
   '!aaSuppressed(u) && !u.moved && !u.fired',
   '!u.moved && !u.fired',
   '伞下静止一回合：不升反降'],

  ['压制只认阵地耐久、不认格子里有没有敌军',
   "    if (f.kind !== 'F' || f.side === u.side) continue;\n    if (!fortWorking(f)) continue;\n    if (hexDist([f.r, f.c], u.pos) <= rng) return f;",
   "    if (f.kind !== 'F' || f.side === u.side) continue;\n    if (!fortAlive(f)) continue;\n    if (hexDist([f.r, f.c], u.pos) <= rng) return f;",
   '阵地被敌军踩住时不再压制天空'],

  ['压制误伤地面单位（去掉 isAir 判定）',
   'if (!u || !u.pos || !isAir(u)) return null;',
   'if (!u || !u.pos) return null;',
   '地面单位站在伞下不会被'],

  ['压制的下限失效（一路把飞机压到崩溃）',
   'if (u.org <= floor) continue;',
   'if (false) continue;',
   '已经低于下限的不再被往下推'],

  ['航空兵又被按回地面补给场（敌境一律断绝）',
   "  if (isAir(u)) return { label: '紧张', mod: SUPPLY_MOD['紧张'], dist: 0 };",
   "  if (false) return { label: '紧张', mod: SUPPLY_MOD['紧张'], dist: 0 };",
   '飞机在敌境也不判'],

  ['压制半径与命中修正不同步（改 3 只改一处）',
   "const rng = typeof sp.rng === 'number' ? sp.rng : 2;",
   'const rng = 3;',
   '半径外：两边同时不成立'],

  ['单位面板不再提示"被防空压制"（玩家只看到组织度莫名在掉）',
   '  const aaSup = aaSuppressed(u);\n  if (aaSup) {',
   '  const aaSup = aaSuppressed(u);\n  if (false) {',
   '面板点名「被防空压制」', 'brief'],

  /* 附属关顶栏把「附属」说两遍。这条盯的是"类型字段与关号文案各自都说了一遍是支线"，
     退回旧写法（noText + LEVEL.type）就该有一条断言变红——否则这个重复会再次
     无声地长回来：它不报错、不影响判定，只是读起来别扭。 */
  ['顶栏又把「附属」说两遍（类型字段不剥前缀）',
   "  if (s) s.textContent = levelNoText(LEVEL, true) + levelTypeText(LEVEL) + ' · ' + LEVEL.when;",
   "  if (s) s.textContent = levelNoText(LEVEL, true) + LEVEL.type + ' · ' + LEVEL.when;",
   '「附属」只说一次', 'brief'],

  /* chapterStat 在 v4.8 是死代码（512 字节、0 次执行），接进结算页之后
     必须有断言盯着它。删掉那一行渲染，玩家只会看到少了一行统计——
     不报错、不崩，正是"死代码又长回来"的形状。 */
  ['结算面板不再报本章进度（chapterStat 又变回死代码）',
   '  if (cs && cs.total > 0) {',
   '  if (false && cs.total > 0) {',
   '结算面板报本章进度', 'brief'],

  /* 战报两条通道：bold（作者的 `**重点**` 能加粗）与 esc（存档里的标签只能是文本）。
     两条断言必须各配一条变异——只变异其中一条，另一条永远是"没被证明过的绿"。 */
  ['战报退回纯文本（作者的 **重点** 又变成星号）',
   '    d.innerHTML = bold(esc(String(l.text)));',
   '    d.textContent = String(l.text);',
   '**重点** 渲染成 <b>', 'brief'],

  ['战报不做转义（存档里的 <b> 变成真标签）',
   '    d.innerHTML = bold(esc(String(l.text)));',
   '    d.innerHTML = String(l.text);',
   '字面量仍是文本', 'brief'],

  /* 点击路由：一格两层时该打谁。三条分别对应"开火优先""只打真能打的""卡也认层"。 */
  ['点格子又退回"先判是不是我方单位"（防空炮打不了同格敌机）',
   '      if (tHere.length === 1) { doAttack(state.selected, tHere[0]); return; }',
   '      if (false) { doAttack(state.selected, tHere[0]); return; }',
   '点这一格 = 开火'],

  /* 守卫必须一起改。只把 filter 换成"按阵营挑"，留着
     `if (!state.targets.length) return []` 的话，够不着的部队根本走不到
     这行，变异报"没红"——那是变异假，不是断言假。 */
  ['一格两层时不看能不能打，格里有敌人就开火',
   'function targetsAt(r, c) {\n  if (!state.selected || !state.targets.length) return [];\n  return unitsAt(r, c).filter(x => state.targets.includes(x));',
   'function targetsAt(r, c) {\n  if (!state.selected) return [];\n  return unitsAt(r, c).filter(x => x.side !== state.selected.side);',
   '不会瞎开火'],

  ['战术卡又只认 unitAt 算出来的那一支（指向敌方的卡落不到同格飞机上）',
   '      const pick = unitsAt(r, c).find(x => cardFitsUnit(card, x));',
   '      const pick = cardFitsUnit(card, u) ? u : null;',
   '指向敌方的战术卡落在空中那一支上'],

  /* ── 素材来源页（CC-BY 的署名义务）──
     这一页不是装饰：四个 CC-BY 音效随页面公开分发，名字写不上就是违约。
     两条变异分别盯"名字有没有出现在页面上"和"这一页到底渲染没渲染"——
     后者是容易假绿的地方：页签没接进 renderHQ 会落到副官兜底，
     而副官也有几百字，只查长度查不出来。 */
  ['素材来源页漏掉作者名（CC-BY 的署名只剩文件名）',
   "by: 'Walking.With.Microphones', lic: 'CC BY 4.0',",
   "by: '佚名', lic: 'CC BY 4.0',",
   '在役的 CC-BY 素材逐一署名', 'brief'],

  ['renderHQ 漏掉 credits 分支（页签点开是副官）',
   "  else if (hqTab === 'credits') { box.innerHTML = hqCredits(); }\n",
   '',
   '渲染的是素材来源页', 'brief'],

  /* ── 按关预载 ──
     两个方向各一条：退回全量（陆战白下海空 78 KB）、或把 scope 收死
     （港口战少了舰体与投弹）。只守一个方向的断言，另一半会悄悄坏掉。 */
  ['预载退回全量（第 1 关又跟着下海空四槽）',
   '  FX.clear();\n  FX.preload(sfxForLevel(LEVEL));',
   '  FX.clear();\n  FX.preload();',
   'C1 不预载海空四槽', 'brief'],

  ['按关预载不看编制（scope 写死成固定集）',
   '  const keep = new Set(SFX_ALWAYS);\n  for (const u of (lv && lv.units) || []) {',
   '  const keep = new Set(SFX_ALWAYS);\n  for (const u of []) {',
   'C4（港口战）预载了海空槽', 'brief'],

  /* ── 敌情检视 / 堆叠目标挑选 ──
     两条玩家反馈的防线。第一条最容易假绿：把 filter 换成 find，
     单目标用例全都照常通过（那些用例本来就只有一个目标），
     只有"同格两支"的那条会塌——所以它必须存在。 */
  ['targetsAt 退回只挑一支（堆叠格只能打栈顶）',
   '  return unitsAt(r, c).filter(x => state.targets.includes(x));',
   '  const one = unitsAt(r, c).find(x => state.targets.includes(x));\n  return one ? [one] : [];',
   'targetsAt 返回全部两支'],

  ['点敌军退回翻地形（看不到敌方编制）',
   '    inspectUnit(u);\n    return;',
   '    selectTerrain(r, c);\n    return;',
   '点射程外的敌军 = 检视它'],

  ['切换自己部队时不清检视（面板还挂着上一个敌人）',
   '  state.inspect = null;\n  state.pick = null;\n  state.mode = null;',
   '  state.pick = null;\n  state.mode = null;',
   '切换到自己另一支部队时退出检视'],

  ['检视顺手把选中也清了（看一眼敌人就丢了操作对象）',
   '  state.inspect = u;\n  state.terrainSel = null;',
   '  state.inspect = u;\n  state.selected = null;\n  state.terrainSel = null;',
   '检视不会把当前选中清掉'],

  /* ── 手册三页（v4.15）──
     这几条的共同点：坏了不影响任何一局战斗，玩家只是"手册上少一段"，
     没有任何异常会提醒你。所以只能靠变异把它们钉住。 */
  ['renderHQ 漏接「特殊机制」分支（页签能点，内容永远是空的）',
   "  else if (hqTab === 'mech') { box.innerHTML = hqMech(); }\n",
   '',
   '特殊机制页渲染出全部条目', 'brief'],

  ['图鉴不渲染兵种介绍（数据还在，屏幕上看不到）',
   "      if (info.intro) h += '<p class=\"dex-intro\">' + bold(info.intro) + '</p>';\n",
   '',
   '图鉴每张卡片都有兵种介绍', 'brief'],

  ['步兵营的类别写成装甲（辨识类型就废了）',
   "  inf: { cat: '步兵单位',",
   "  inf: { cat: '装甲单位',",
   '步兵营归在「步兵单位」', 'brief'],

  ['图鉴漏写一个兵种的介绍（新兵种忘了登记）',
   "  rec: { cat: '侦察单位',",
   "  recX: { cat: '侦察单位',",
   '每个兵种都有图鉴介绍'],

  ['机制条目丢了「怎么用」那一段（变成说明书）',
   "           '<div class=\"mech-b mech-tip\"><span class=\"mech-t\">怎么用</span><p>' + bold(m.tip) + '</p></div>' +\n",
   '',
   '每条机制都有三个小标题', 'brief'],

  /* ── 装甲的两条动词（v4.16）──
     这两条的效果是"少掉 6 点组织度"和"往前挪一格"，都不弹窗、不报错。
     漏接的话只会表现为"这版跟上一版手感一样"，没人会当 bug 报上来。
     所以五个守卫逐个变异：地形、工事、兵种、攻方类型、缺口占位。 */
  ['履带压制算出来了却没用上（函数对、结算不扣）',
   '  def.org = Math.max(0, def.org - pressOrg);',
   '  def.org = Math.max(0, def.org);',
   '端到端：这一炮的目标组织度'],

  ['压制不看地形（城里林地照样压）',
   "  if (!TRACK_PRESS_TERRAIN.includes(terrainAt(def.pos[0], def.pos[1]).cls)) return 0;",
   '  if (false) return 0;',
   '目标躲进城里'],

  ['压制不看工事（蹲在堑壕里的人照样被压）',
   '  if (fortSelf(def)) return 0;',
   '  if (false) return 0;',
   '步兵蹲在自家堑壕里'],

  ['压制不看兵种（坦克打坦克也压组织度）',
   '  if (!FOOT_TYPES.includes(def.type)) return 0;',
   '  if (false) return 0;',
   '中坦打中坦'],

  ['压制不看攻方（反坦克连也能压步兵）',
   '  if (!isArmor(att) || !def || !att.pos || !def.pos) return 0;',
   '  if (!def || !att.pos || !def.pos) return 0;',
   '反坦克连打步兵'],

  ['突破跟进不判缺口占位（和退走的友军叠在一格）',
   '          layerUnitsAt(gap[0], gap[1], \'surface\').length === 0) {',
   '          true) {',
   '同格还有友军时缺口没空出来'],

  ['突破跟进整段不执行（击退又退回"推走就完事"）',
   '        att.pos = gap;',
   '        att.pos = att.pos;',
   '攻方顺着缺口推进到目标原来的格子'],

  ['跟进不收组织度代价（白得一次推进）',
   '        att.org = Math.max(0, att.org - BREAK_PUSH_ORG);',
   '        att.org = att.org;',
   '跟进要付 3 点组织度'],

  ['退路堵死时不再扣组织度（堵死了反而什么都没发生）',
   '      def.org = Math.max(0, def.org - PUSH_BLOCK_ORG);',
   '      def.org = def.org;',
   '退路堵死时改扣 8 点组织度'],

  /* ── v4.17 补丁（docs/20 §三 §五 §六 §八）── */

  ['超距闸门失效（列表外 14 格也能开火）',
   '    if (d < minRange(att) || d > attackRange(att)) return false;',
   '    if (false) return false;',
   '超距 doAttack 被拒'],

  ['canFire 闸门失效（空弹与未展开照常开火）',
   '  if (!canFire(att)) return false;',
   '  if (false) return false;',
   '空弹的炮在 doAttack 也被拒'],

  ['无效接触兜底闸失效（ratio 0.01 照样结算）',
   '  if (pv.ratio < INVALID_RATIO && pv.counter && !objectivePush(att, def, opts, pv) &&\n      !huntContact(att, def, opts)) return false;',
   '  if (false) return false;',
   '无效接触在 doAttack 也被拒'],

  ['无效接触不再从目标列表剔除（面板与 AI 又看得见了）',
   '    return !invalidContact(u, t, fields, pv) || objectivePush(u, t, opts, pv) ||\n           huntContact(u, t, opts);',
   '    return true;',
   '无效接触不进目标列表'],

  /* v4.18 热修：闸门只看比值、不看有没有反击 →
     间瞄炮兵对着整编营一个目标都列不出来（玩家报的"炮兵射程坏了"）。 */
  ['无效接触闸忽略"打不着我"（炮兵又列不出目标）',
   '  return pv.ratio < INVALID_RATIO && pv.counter;',
   '  return pv.ratio < INVALID_RATIO;',
   '无反击的低比值炮击不算'],

  ['工事分槽退回 def 大小判据（F 又被堑壕锁死）',
   '    return FORT_SLOT[k] !== FORT_SLOT[cur.kind] || FORT[k].def > cur.def + 1e-9;',
   '    return FORT[k].def > cur.def + 1e-9;',
   '防空阵地能立在最常见的堑壕格上'],

  ['攻击乘数夹紧移除（修正池叠穿 ±1 就翻负）',
   '  const attMul = Math.max(0.15, Math.min(2.0, 1 + attMod));',
   '  const attMul = 1 + attMod;',
   '攻击乘数封顶 2.0'],

  ['防御叠放夹紧移除（1.63 起步没有上限）',
   '  return Math.max(0, Math.min(1.6, d));',
   '  return d;',
   '防御叠放触顶后被夹紧'],

  ['炮兵减半失效（碉堡照单全收）',
   '  if (isArty(u)) d *= 0.5;',
   '  if (false) d *= 0.5;',
   '炮兵的被动防御收益整体减半'],

  /* ── v4.18 ── */
  ['炮兵分摊退回单体（堆叠格每支各吃全额）',
   '  const shares = splash ? splashSplit(defLoss, victims) : [defLoss];',
   '  const shares = splash ? victims.map(() => defLoss) : [defLoss];',
   '不等战力堆叠：战力 4 的那支最多吃 2 点'],

  /* 按比例 → 平均分：两支 2 / 6 挨 4 点，平均分是 2 / 2，比例分才是 1 / 3 */
  ['分摊退回按支平均（战力 2 的那支被整支抹掉）',
   '  const w = victims.map(v => Math.max(0, v.str || 0));',
   '  const w = victims.map(() => 1);',
   '伤害 4、战力 2 / 6 → 1 / 3'],

  /* 只取下整、不补余数：4 点分给 3 / 7 会变成 1 + 2 = 3，少打 1 点 */
  ['最大余数不补（合计比炮弹少）',
   '  for (let k = 0; k < rest; k++) out[order[k].i] += 1;',
   '  /* 不补余数 */;',
   '伤害 4、战力 3 / 7 → 1 / 3'],

  /* 2 点保底失效：削到 2 点还按比例分，就会出现"一支吃 1、另一支毫发无伤" */
  ['2 点保底失效（削到 1 点时有人毫发无伤）',
   '  if (total <= 2) return victims.map(() => 1);',
   '  if (false) return victims.map(() => 1);',
   '削到 1 点：两支各吃 1'],

  /* 保底对单支也生效：2 点给 1 支变成 1，凭空少 1 点 */
  ['单支也吃 2 点保底（伤害凭空少一半）',
   '  if (n === 1) return [total];',
   '  if (n === 1 && total > 2) return [total];',
   '单支不吃保底：2 点全给'],

  ['FLANK_PENALTY 失效（多面进攻白打）',
   'const FLANK_PENALTY = 0.30;',
   'const FLANK_PENALTY = 0;',
   '多面进攻削防御：defSum 严格变小'],

  ['指挥部防炮移除（炮击指挥旗不受罚）',
   '  if (isHQ(def) && (isArty(att) || isNaval(att))) attMod -= 0.30;',
   '  if (false) attMod -= 0.30;',
   '炮击指挥部：attMod 比炮击普通部队低 0.30'],

  /* 教学关封顶在 judgeFinal 里是两道互为冗余的闸（分支条件 !isTutorial
     和事后的 perfect→win 回退），单改一处观察不到——锚点必须一次拿掉两道。 */
  ['教学关超额封顶移除（教学关又能刷 perfect）',
   "    if (sc >= LEVEL.perfectScore && !isTutorial(LEVEL)) state.result = 'perfect';\n" +
   "    else if (sc >= LEVEL.winScore) state.result = 'win';\n" +
   "    else state.result = 'fail';\n" +
   "    /* 教学关不留超额：引导关的目标就是让所有人能过，再挂一个更高的线\n" +
   "       只会把新手往\"追求完美\"的方向拽（v4.18 反馈第 6 条）。 */\n" +
   "    if (state.result === 'perfect' && isTutorial(LEVEL)) state.result = 'win';",
   "    if (sc >= LEVEL.perfectScore) state.result = 'perfect';\n" +
   "    else if (sc >= LEVEL.winScore) state.result = 'win';\n" +
   "    else state.result = 'fail';",
   '教学关：分数越过超额线也只判 win'],

  ['survive 超额判据退回"一个不损"（v4.18 已放宽到七成）',
   '        aliveNow >= Math.ceil(initN * 0.7)) {',
   '        aliveNow >= initN) {',
   '坚守关：损一支仍在七成线上，judgeFinal 判 perfect'],

  /* ── v4.19 热补丁（三条都是"看起来在、其实没生效"的典型）── */

  /* 炮兵点堆叠格直接开火：这条只能靠 briefcheck 断（DOM 里有没有弹选择器）。
     变异退回"一律弹选择器"，断言必须红。 */
  ['炮兵打堆叠格又弹选择器（热补丁回退）',
   '      if (state.selected && isArty(state.selected)) { doAttack(state.selected, splashTarget(rTgts)); return; }',
   '      if (false) { doAttack(state.selected, splashTarget(rTgts)); return; }',
   '炮兵没有弹出目标选择器', 'brief'],

  /* 撤销返还战术卡，分两条守：
     ① 快照记成空对象 → 撤销会把"先前用掉的卡"也一起退回来（能刷卡）；
     ② 恢复那一步被删 → 卡退不回手牌（卡没了、效果也没了）。
     两条必须分别红一条断言：只写"撤销后卡回到手牌"这一个断言的话，
     ① 号变异下它照样绿（最后一张卡确实回来了），这就是一条假防线。 */
  ['撤销栈把 cardUsed 记成空对象（撤销能把卡刷回来）',
   '    cardUsed: { ...(state.cardUsed || {}) },',
   '    cardUsed: {},',
   '撤销不返还先前用掉的卡'],

  ['doUndo 不恢复 cardUsed（卡用掉就再也回不来）',
   '  state.cardUsed = s.cardUsed ? { ...s.cardUsed } : state.cardUsed;',
   '  /* 变异：不恢复已用卡 */;',
   '撤销返还这一步用掉的卡'],

  /* 关卡类别 → 脾气：查表这一步被短路，三种脾气退化成一种 */
  ['AI 类别查表被短路（全部退回夺取型）',
   "  return AI_STYLE_BY_TYPE[t] || 'seize';",
   "  return 'seize';",
   '突围关 → 进攻型'],

  /* 防守型的开火门槛退回夺取型的 0.85：低进攻欲望这条规则等于没写 */
  ['防守型开火门槛退回夺取型（低进攻欲望失效）',
   '    fireOther: 1.05, fireArty: 0.75,',
   '    fireOther: 0.85, fireArty: 0.55,',
   '防守型：直射 1.05 / 火炮 0.75'],

  /* 桌面端缩放：退回"清空 transform"的老写法。
     这一条只有在 briefcheck 里能抓——selftest 的 stub DOM 读不到 style。 */
  ['桌面 applyView 又清空 transform（放大键按了没反应）',
   "  boardView.style.transform =\n    'translate(' + vX.toFixed(2) + 'px,' + vY.toFixed(2) + 'px) scale(' + vK.toFixed(4) + ')';",
   "  boardView.style.transform = '';",
   '桌面 fitView 后棋盘上写了 transform', 'brief'],

  /* 滚轮这条：next 恒等于 vK，滚一圈什么都不发生 */
  ['滚轮缩放失效（next 恒等于当前倍数）',
   '  const next = Math.min(vMax, Math.max(vFit, vK * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));',
   '  const next = vK;',
   '桌面滚轮向上滚能放大', 'brief'],

  /* 适应倍数又封顶 1 倍：小棋盘在宽屏上缩成中间一小块，两边空一片 */
  ['桌面适应倍数又封顶 1 倍（小棋盘缩在中间）',
   '  vFit = Math.max(0.12, Math.min(2, kw, kh));',
   '  vFit = Math.max(0.12, Math.min(1, kw, kh));',
   '桌面小棋盘会放大铺满容器', 'brief'],

  /* 拖曳炮收着炮也能反击：把 canCounter 里那条闸删掉。
     期望断言挑"战报写明无法反击"——它不依赖骰子。
     用"攻方零损失"会假绿：counter 为真时 row[0] 也可能是 0（压倒档），
     攻方照样不掉血，看着像"没还手"。 */
  ['行军状态的拖曳炮仍能反击（收着炮还还手）',
   '  if (isTowed(def) && def.packed) return false;',
   '  /* 变异：展开状态闸被移除 */',
   '战报写明「对方无法反击」'],

  /* 简报正文退回"只转义不渲染"：** 会原样印在纸上，玩家看到星号。
     注意"不残留 <b> 标签"那条不会红（星号不是标签），
     所以必须挑"渲染成加粗"这条来验。 */
  ['简报正文只转义不渲染（把 ** 原样印出来）',
   "'>' + bold(esc(p.t)) + '</p>').join('');",
   "'>' + esc(p.t) + '</p>').join('');",
   '简报正文的重点标记渲染成加粗', 'brief'],

  /* ── v4.20 第 1 批：目标价值 / 零风险火力 / 集火预支 / 崩溃收拢 ── */

  /* 零风险放行被删：炮兵又会对"打不还手"的目标挑比值，
     玩家看到的就是残部在射程里晃、敌人不补刀。 */
  ['零风险火力被移除（打不还手也要挑比值）',
   '  if (pv && pv.counter === false) return 0;',
   '  if (false) return 0;',
   '零风险：对方不能反击时门槛归零'],

  /* 价值折扣只算分、不进门槛：排序与开火又分家，好目标照样被门槛拦下 */
  ['目标价值只进排序不进门槛（看到好目标也不打）',
   '  g -= targetValue(def, pv).discount;',
   '  /* 变异：价值折扣被移除 */',
   '进攻型：同样吃价值折扣'],

  /* 折扣恒为 0：targetValue 的分数还在，门槛这一侧整条规则失效 */
  ['targetValue 折扣恒为 0（价值判断只影响排序）',
   '  return { score, discount: Math.min(0.15, discount) };',
   '  return { score, discount: 0 };',
   'targetValue：敌方要点守军'],

  /* 要点加分被短路：优先级退回"谁比值高打谁"，守要点变成一句空话 */
  ['targetValue 不再给要点守军加分（要点优先级失效）',
   '  if (onEnemyObjective(t)) { score += 0.6; discount += 0.15; }',
   '  if (false) { score += 0.6; discount += 0.15; }',
   'targetValue：敌方要点守军'],

  /* 集火折扣被删：第二支接不上时仍然按高门槛挑，协同火力等于没写 */
  ['集火预支被移除（第二支能接上也不放松门槛）',
   '  if (massed && !st.defensive && !pv.flanked) g -= 0.15;',
   '  /* 变异：集火折扣被移除 */',
   '集火：夺取型门槛再放松'],

  /* 集火把"已开火"也算进来：每一炮都指望下一炮，门槛永久偏低 */
  ['集火把已开火的友军也算第二支（门槛永久偏低）',
   '    if (a === u || isBroken(a) || a.fired) return false;',
   '    if (a === u || isBroken(a)) return false;',
   '集火：已经开过火的不算第二支'],

  /* 崩了的友军不能开火，不能拿来当"有人接"的理由 */
  ['集火把崩溃友军也算第二支（根本开不了火）',
   '    if (a === u || isBroken(a) || a.fired) return false;',
   '    if (a === u || a.fired) return false;',
   '集火：崩了的友军接不上'],

  /* 射程闸被删：隔着半个地图的友军也算"能接上" */
  ['集火不判射程（够不着也算有人接）',
   '    return d >= minRange(a) && d <= attackRange(a);',
   '    return true;',
   '集火：够不着的友军不算第二支'],

  /* 已脱离接触还硬要挪：崩溃部队每回合白丢阵地，却不会恢复得更快 */
  ['崩溃部队脱离接触后仍强行挪窝（白丢阵地）',
   '  if (disengaged(u)) return false;',
   '  /* 变异：脱离接触仍要挪 */',
   '已经脱离接触的崩溃部队就地收拢'],

  /* 非关键要点也当"最后防线"：崩溃守军钉死在边角，不再收拢 */
  ['非关键要点也被当成"最后防线"（崩溃守军不撤）',
   '    const vital = o.core || (LEVEL.win && LEVEL.win.keep && LEVEL.win.keep.includes(o.id));',
   '    const vital = true;',
   'aiBrokenHoldObjective：非关键要点上的崩溃守军照样撤'],

  /* 后撤评分方向写反：崩溃部队反而往敌人怀里钻 */
  ['后撤评分方向写反（往敌人怀里钻）',
   '  let s = Math.min(mind, 6) * 10;',
   '  let s = Math.min(mind, 6) * -10;',
   'aiRetreatScore：离敌越远分越高'],

  /* 要点格缓存不随换关重置：下一关的染色/悬停名沿用上一关的要点表 */
  ['要点格缓存不随换关重置（下一关沿用上一关的要点）',
   '  _objAt = null;\n  state = {',
   '  state = {',
   '换关后新关的要点格查得到'],

  /* ── v4.20 第 2 批：攻坚令 / 破口 / 防守型预备队 ──
     这一批全是"AI 少做一件事"的形状：不开火、不补缺口、守着坑乱挪。
     没有断言的话，表现只是"这版看起来又变呆了"，不会有任何异常。 */

  /* 列表层把攻坚令丢掉：夺取型的 all-in 门槛还在，但目标进不了列表 */
  ['攻坚令进不了目标列表（夺回要点变成一句空话）',
   '    return !invalidContact(u, t, fields, pv) || objectivePush(u, t, opts, pv) ||\n           huntContact(u, t, opts);',
   '    return !invalidContact(u, t, fields, pv);',
   '攻坚令生效时目标进列表'],

  /* 结算层把攻坚令丢掉：列表放行了，doAttack 的兜底闸照样拒 */
  ['攻坚令不进 doAttack（列表放行、结算仍拒）',
   '  if (pv.ratio < INVALID_RATIO && pv.counter && !objectivePush(att, def, opts, pv) &&\n      !huntContact(att, def, opts)) return false;',
   '  if (pv.ratio < INVALID_RATIO && pv.counter) return false;',
   'doAttack 带攻坚令才真的打进去'],

  /* 开口不看调用方：玩家面板与另外两种脾气也一起放行 */
  ['攻坚令不看调用方（谁都拿到这个口子）',
   '  if (!(opts && opts.pushObjective && att && def)) return false;',
   '  if (!(att && def)) return false;',
   '没有攻坚令时目标仍被无效接触闸挡住'],

  /* 开口不看兵种：炮兵/舰炮也能对着要点硬啃 */
  ['攻坚令不判能不能占领（炮兵也去啃要点）',
   '  if (!canCapture(att) || !onEnemyObjective(def)) return false;',
   '  if (!onEnemyObjective(def)) return false;',
   '攻坚令只开给能占领的部队'],

  /* 开口不看要点归属：野地里的低比值目标也放行 */
  ['攻坚令不认要点归属（野地目标也放行）',
   '  if (!canCapture(att) || !onEnemyObjective(def)) return false;',
   '  if (!canCapture(att)) return false;',
   '攻坚令只认敌方/争夺中的要点'],

  /* 底价失效：1 点战力也往 12 点守军上撞 */
  ['攻坚底价失效（比值再低也放行）',
   '  return r >= PUSH_RATIO;',
   '  return true;',
   '比值低于底价 0.20 不放行'],

  /* 三种脾气共用一个 opts：进攻型/防守型也带攻坚令，火力被撒到低比值目标上 */
  ['aiTargetOpts 不分脾气（三种脾气都带攻坚令）',
   '  return st && st.allInOnObjective ? { pushObjective: true } : undefined;',
   '  return { pushObjective: true };',
   '夺取型自动带攻坚令，另外两种不带'],

  /* runAI 没把 opts 传下去：目标列表与结算都回到原样，C1 又不开火 */
  ['runAI 不把攻坚令传进开火流程',
   '  const pushOpts = aiTargetOpts(style, hunt);',
   '  const pushOpts = undefined;',
   '端到端：夺取型 runAI 把攻坚令带进开火流程'],

  /* targetsFor 带了 opts、doAttack 没带：列表看得见，结算仍拒 */
  ['开火时只传列表不传结算（看得见打不出去）',
   '          doAttack(u, best, pushOpts);',
   '          doAttack(u, best);',
   '端到端：夺取型 runAI 把攻坚令带进开火流程'],

  /* aiStuck 永远判"卡住"：任何一枪都能按清路价打，破口变成无条件折扣 */
  ['aiStuck 永远判卡住（破口变成无条件折扣）',
   '    if (hexDist(p, goal) < d0) return false;',
   '    if (false) return false;',
   '能绕过去时不再触发破口'],

  /* 破口不查卡住：能绕过去也按清路价硬撞 */
  ['破口不查"卡住了没有"（绕得过去也按清路价打）',
   '  if (!goal || !aiStuck(u, goal)) return null;',
   '  if (!goal) return null;',
   '能绕过去时不再触发破口'],

  /* 破口价不封顶：0.55 的原门槛还在，等于白改 */
  ['破口价不封顶（清路那一枪仍按 0.55 挑）',
   '  if (breakthrough && st.breakGate) g = Math.min(g, st.breakGate);',
   '  /* 变异：破口价不封顶 */',
   '破口价把门槛压到 0.40'],

  /* 破口不排除炮兵：炮支援火力被拉去贴脸清路 */
  ['破口不排除炮兵 / 飞机',
   '  if (!u || isArty(u) || isAir(u)) return null;',
   '  if (!u) return null;',
   '夺取型 / 炮兵不参与破口'],

  /* 破口不排除夺取型：夺取型的 targetValue 已经够凶，再叠一层清路价 */
  ['破口不排除夺取型（两层进攻规则叠在一起）',
   '  if (!st || !st.breakthrough || st.defensive) return null;',
   '  if (!st) return null;',
   '夺取型 / 炮兵不参与破口'],

  /* 防守型不走 aiHoldGoal：守军又回到"全体被吸到最近要点"的老样子 */
  ['防守型不委托 aiHoldGoal（守军全体挪向最近要点）',
   '  if (st === AI_STYLES.hold) return aiHoldGoal(u);',
   '  if (false) return aiHoldGoal(u);',
   'aiGoalFor 的防守型分支就是 aiHoldGoal'],

  /* 占格就算守军：预备队永远不补缺口 */
  ['站要点上不算守军（预备队被叫去换防）',
   '    o.cells.some(c => c[0] === u.pos[0] && c[1] === u.pos[1]))) return true;',
   '    o.cells.some(c => c[0] === u.pos[0] && c[1] === u.pos[1]))) return false;',
   '站在要点上的部队：算守军，不换防'],

  /* 工事不算家：挖好的坑没人守，全体预备队化 */
  ['工事里不算守军（堑壕里的部队被拽出来）',
   '  return !!(f && fortWorking(f));',
   '  return false;',
   '站在己方仍在工作的工事里：算守军，原地不动'],

  /* 守军判定不看能不能占领：炮兵占着格也算"有人守" */
  ['炮兵占格也算守军（预备队不来补缺口）',
   '  return alive(side).some(u => canCapture(u) &&',
   '  return alive(side).some(u =>',
   '炮兵占格不算守（占不了点）'],

  /* 威胁不看崩溃：已经崩溃的敌军被当成下一波进攻 */
  ['崩溃的敌军也算威胁（预备队被崩了的残部牵着走）',
   '  return alive(foe).some(f => canCapture(f) && !isBroken(f) &&',
   '  return alive(foe).some(f => canCapture(f) &&',
   '崩溃的敌军组织不起进攻'],

  /* 威胁半径 2 → 3：预备队提前一回合被拉走，别的缺口更空 */
  ['威胁半径扩到 3 格（预备队被远处的敌人牵着走）',
   '    o.cells.some(c => hexDist(f.pos, c) <= 2));',
   '    o.cells.some(c => hexDist(f.pos, c) <= 3));',
   '敌军退到 3 格外'],

  /* 争夺判定用 objectiveControl：它把 contested 折成 null，这一条永远不成立 */
  ['争夺中了还要看 objectiveControl（永远判不出来）',
   '  if (ctrlState(o) === \'contested\') return true;',
   '  if (objectiveControl(o) === \'contested\') return true;',
   '争夺中的要点算受威胁'],

  /* 预备队不看要点有没有守军：永远挤最近的那个，别的点空着 */
  ['预备队不看要点有没有守军（永远去最近的点）',
   '    const held = aiObjectiveHeld(o, u.side);',
   '    const held = false;',
   '最近的要点已经有守军 → 预备队转去没人守的村子'],

  /* 威胁优先级失效：受威胁的缺口和没人守的点同分，只比距离 */
  ['受威胁的空缺口不再优先（只比距离）',
   '    if (threat && !held) s = 3;',
   '    if (false) s = 3;',
   '受威胁的空渡口优先于没人守的村子（哪怕更远）'],

  /* 加分公式恒 0：防守型与夺取型的排序彻底一样 */
  ['威胁加分恒 0（守方的排序退回夺取型）',
   '  return Math.max(0, 4 - nearestObjectiveDist(t.pos)) * 0.12;',
   '  return 0;',
   '威胁加分看目标离要点多远：要点上 0.48'],

  /* ── v4.21 追击：兵力 2 倍 + 士气闸 + 高价值目标 ──
     这一批的形状是"少判一件事"：少算一波援军、少看一眼士气、少追一个人。
     外面看起来都只是"这版 AI 又变温了"，不会有任何异常。 */

  /* 2 倍窗口写死成 3 倍：追击永远不触发 */
  ['HUNT_RATIO 改成 3（2 倍窗口推迟）',
   'const HUNT_RATIO = 2;',
   'const HUNT_RATIO = 3;',
   'HUNT_RATIO = 2'],

  /* 判据放宽到"等于也追"：正好 2 倍时本该收着打 */
  ['2 倍判据从严格大于改成大于等于',
   "  if (!(aiSidePoints('red') > HUNT_RATIO * sideFieldPoints('blue'))) return false;",
   "  if (!(aiSidePoints('red') >= HUNT_RATIO * sideFieldPoints('blue'))) return false;",
   '恰好 2 倍（80 vs 40）不追击'],

  /* 波次标记不看：援军已经到场，编制账还按"在路上的"算 */
  ['已登场波次仍计入未登场点数（全关卡点数虚高）',
   "    if (w > 1 && !(state.flags && state.flags['wave' + w])) s += defStr(def);",
   '    if (w > 1) s += defStr(def);',
   '波次入场后不再重复计入'],

  /* 绿方接口闭死：实装友军那天 AI 会当没看见 */
  ['友军接口闭死（绿方点数不上账）',
   '  const list = (state && Array.isArray(state.allies)) ? state.allies : [];',
   '  const list = [];',
   '绿方友军计入蓝方场上点数'],

  /* 友军不分阵营：红方也吃到绿方点数 */
  ['友军不看阵营（红方也吃到绿方点数）',
   "  if (side !== 'blue') return [];",
   '',
   'alliedUnits 只认蓝方一侧的友军'],

  /* 士气 60 整不追：边界从 >= 变 > */
  ['士气闸改成严格大于（60 整不追）',
   "  return aiAvgOrg('red') >= HUNT_MIN_ORG;",
   "  return aiAvgOrg('red') > HUNT_MIN_ORG;",
   '士气刚好 60 仍追击'],

  /* 士气闸失效：打散了还追 */
  ['士气闸失效（打散了还追）',
   "  return aiAvgOrg('red') >= HUNT_MIN_ORG;",
   '  return true;',
   '士气跌破 HUNT_MIN_ORG 收兵'],

  /* 夺取型配置回退：整批机制永远进不了门 */
  ['夺取型不再开启追击（配置回退）',
   '    hunt: true\n  }\n};',
   '    hunt: false\n  }\n};',
   '夺取型 / 进攻型开启追击'],

  /* 状态不落账：每回合重复播报，且 runAI 读到旧状态 */
  ['追击状态不落账（每回合重复播报）',
   '  state.huntOn = on;',
   '  /* 变异：状态不落账 */',
   'aiHuntTick 进入追击并记录状态'],

  /* 接敌闸的两条：一条测"没接敌也播"，一条测"接敌了也不播"。
     只写一条的话，把整个播报删掉也能过其中一条。 */
  ['追击播报不等接敌（开局就喊敌军追击）',
   '    if (!state.huntSaid && huntContacted()) {',
   '    if (!state.huntSaid) {',
   '未接敌时只记账不播报'],
  ['接敌判定永远不成立（接敌后也不补播）',
   '    if (hexDist(b.pos, r.pos) <= 1) return true;',
   '    if (hexDist(b.pos, r.pos) <= 0) return true;',
   '推到相邻一格后补播追击战报'],

  /* 状态变化不判：同一句话每回合刷一遍。
     锚点跟着实现走——早退改成 huntSaid 记账 + changed 之后，
     原来的 `if (!!state.huntOn === on) return on;` 已经不存在了，
     改成去掉 huntSaid 这道记账闸。 */
  ['同一状态也播报（战报刷屏）',
   '    if (!state.huntSaid && huntContacted()) {',
   '    if (huntContacted()) {',
   '同一状态不重复播报'],

  /* 指挥部不值钱：围歼时先去咬步兵 */
  ['指挥部不再加权（高价值目标退化成看吨位）',
   '  if (isHQ(t)) v += 1.0;',
   '',
   '指挥部的价值高于同点数步兵'],

  /* 炮兵不值钱：绕两格摘炮不如就近咬步兵 */
  ['炮兵不再加权（绕两格摘炮不如就近咬步兵）',
   '  if (isArty(t)) v += 0.7;',
   '',
   '炮兵的价值高于同点数步兵'],

  /* 崩溃目标不加分：不优先补刀，留着残部继续占点 */
  ['崩溃目标不再加分（不优先补刀）',
   '  if (isBroken(t)) v += 0.2;',
   '',
   '崩溃目标额外加分'],

  /* 目标只按距离挑：追击退化成"谁近打谁" */
  ['追击目标只看距离（谁近打谁）',
   '    const s = huntValue(t) - hexDist(u.pos, t.pos) * 0.12;',
   '    const s = -hexDist(u.pos, t.pos);',
   '高价值优先：3 格外的炮兵'],

  /* 目标轴不换：眼里只有要点，高价值单位路过也不追 */
  ['追击不换目标轴（眼里只有要点）',
   '  if (hunt) {\n    const ht = aiHuntTarget(u);\n    if (ht) return ht.pos.slice();\n  }',
   '  if (false) {\n    const ht = aiHuntTarget(u);\n    if (ht) return ht.pos.slice();\n  }',
   '追击时目标轴指向高价值敌军'],

  /* 走位不压：目标轴对了，路过的人还是视而不见 */
  ['追击走位不往敌军压（沿途遭遇变成路过）',
   '  if (hunt) {\n    let mind = Infinity;\n    for (const f of alive(other(u.side))) mind = Math.min(mind, hexDist(p, f.pos));\n    if (mind < Infinity) s -= Math.min(mind, 8) * HUNT_PULL;\n  }',
   '  if (false) {\n    let mind = Infinity;\n    for (const f of alive(other(u.side))) mind = Math.min(mind, hexDist(p, f.pos));\n    if (mind < Infinity) s -= Math.min(mind, 8) * HUNT_PULL;\n  }',
   '追击给贴近敌军的落点加分'],

  /* 开火门槛不归零：兵力 2 倍还在挑性价比 */
  ['追击不放开开火门槛（只多走两步）',
   '  if (hunt) return 0;',
   '  if (false) return 0;',
   '追击把开火门槛压到 0'],

  /* 列表层不放行：目标列表照旧是空的，人就在眼前也点不着 */
  ['追击目标进不了列表（看得见打不着）',
   '           huntContact(u, t, opts);',
   '           false;',
   '追击目标列表放行'],

  /* 结算层不放行：列表看得见，doAttack 兜底闸照样拒 */
  ['追击放不进 doAttack 兜底闸（列表放行、结算仍拒）',
   '      !huntContact(att, def, opts)) return false;',
   '      false) return false;',
   '不带追击令时 doAttack 兜底闸拒绝'],

  /* ── v4.21 反坦克连：4 点编制 / 0.30 防御 / 设伏 ── */

  /* 编制 +1 失效：场上回到 3 点，设伏换一炮还是亏 */
  ['反坦克连编制 +1 失效（回到 3 点）',
   "function typeStrBonus(type) { return type === 'at' ? 1 : 0; }",
   'function typeStrBonus(type) { return 0; }',
   '开局反坦克连按 4 点进场'],

  /* defStr 不叠：面板/账本认 4 点，场上还是 3 点 */
  ['defStr 不叠编制加成（只有面板认 4 点）',
   '  return (Number.isFinite(n) ? n : 0) + typeStrBonus(def.type);',
   '  return Number.isFinite(n) ? n : 0;',
   'defStr：反坦克连定义 3 点按 4 点计'],

  /* 防御加成缩水：坦克对策卡的正面互换又回到吃亏 */
  ['反坦克连的防御加成掉到 0.20',
   "  if (def.type === 'at' && (isArmor(att) || att.type === 'mech')) defMod += 0.30;",
   "  if (def.type === 'at' && (isArmor(att) || att.type === 'mech')) defMod += 0.20;",
   '反坦克连被装甲攻击时防御 +0.30'],

  /* 对步兵也吃加成：反坦克连变成万能守军 */
  ['反坦克连对步兵也吃防御加成',
   "  if (def.type === 'at' && (isArmor(att) || att.type === 'mech')) defMod += 0.30;",
   "  if (def.type === 'at') defMod += 0.30;",
   '步兵攻击反坦克连没有这份加成'],

  /* 自筑阵地不算掩体：开阔地上的设伏永远点不亮 */
  ['自筑阵地不算掩体（设伏永远点不亮）',
   '  if (u.fortify > 0) return true;',
   '  if (false) return true;',
   '设伏成立：静止 + 掩体 + 未被发现 + 目标装甲'],

  /* 观察哨瞎了：蹲坑连打变成无解 */
  ['观察哨发现不了炮位（设伏永远成立）',
   '  return alive(other(u.side)).some(f => !isAir(f) && !isNaval(f) && !isBroken(f) &&',
   '  return false && alive(other(u.side)).some(f => !isAir(f) && !isNaval(f) && !isBroken(f) &&',
   '相邻敌军步兵发现炮位'],

  /* 暴露不进判定：打完还能原地再伏，转移阵地失去意义 */
  ['暴露状态不进设伏判定（打完还能原地再伏）',
   '  const still = !u.moved && !u.exposed;',
   '  const still = !u.moved;',
   '已暴露 → 要先转移阵地'],

  /* atAmbush 不看 ready：任何状态都算设伏 */
  ['atAmbush 不看 ready（条件不齐也能设伏）',
   '  return !!(st && st.ready);',
   '  return !!st;',
   '本回合动过 → 不能设伏'],

  /* 自筑速度减半：两回合才攒出掩体，节奏对不上 */
  ['自筑阵地每回合只加 10%',
   '  u.fortify = Math.min(0.30, u.fortify + 0.15);',
   '  u.fortify = Math.min(0.30, u.fortify + 0.10);',
   '静止一回合自动 +15% 发射阵地'],

  /* 上限放宽：蹲三回合攒出 45%，与设计不符。
     守卫与 Math.min 是双保险，单独改哪一处都会被另一处兜住，
     所以这条变异同时改两处——改完就是"上限真的变成 45%"。 */
  ['自筑阵地上限放到 45%',
   '  if (!canSelfFortify(u) || u.moved || u.fired || u.fortify >= 0.30) return 0;\n  const before = u.fortify;\n  u.fortify = Math.min(0.30, u.fortify + 0.15);',
   '  if (!canSelfFortify(u) || u.moved || u.fired || u.fortify >= 0.45) return 0;\n  const before = u.fortify;\n  u.fortify = Math.min(0.45, u.fortify + 0.15);',
   '自筑阵地上限 30%'],

  /* 开火不暴露：反坦克连可以蹲在同一个坑里连打 */
  ['反坦克连开火不暴露（蹲坑连打）',
   '  if (AT_LIKE.includes(att.type)) att.exposed = true;',
   '  if (false) att.exposed = true;',
   '反坦克连开火后位置暴露'],

  /* 原地“移动”也清暴露：同一格重新隐身 */
  ['原地移动也清除暴露（同一格重新隐身）',
   '  if (relocated) u.exposed = false;',
   '  u.exposed = false;',
   '原地“移动”不算转移阵地'],

  /* 转移不清暴露：打完再也伏不了 */
  ['转移阵地不清暴露（打完再也伏不了）',
   '  if (relocated) u.exposed = false;',
   '  if (false) u.exposed = false;',
   '真正转移到新格才重新隐蔽'],

  /* 满编账绕过 defStr：满编 3、场上 4 对不上 */
  ['blueInitialStr 绕过 defStr（满编账对不上）',
   "  return LEVEL.units.filter(u => u.side === 'blue' && u.wave === 1)\n    .reduce((s, u) => s + defStr(u), 0);",
   "  return LEVEL.units.filter(u => u.side === 'blue' && u.wave === 1)\n    .reduce((s, u) => s + (Number(u.str) || 0), 0);",
   'blueInitialStr 与 defStr 同一份基准'],

  /* makeUnit 不走 defStr：开局只有 3 点 */
  ['makeUnit 不走 defStr（场上只有 3 点）',
   '  if (u.str !== undefined) unit.str = defStr(u);',
   '  if (u.str !== undefined) unit.str = u.str;',
   'makeUnit 把反坦克连按 4 点布置'],

  /* 回合末不调用：机制写在函数里、结算不执行 */
  ['回合结算不调用自筑阵地 tick（机制不接线）',
   '    selfFortifyTick(u);',
   '    void 0;',
   '回合结算会自动调用自筑阵地 tick'],

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
const GREP = (process.argv.find(a => a.startsWith('--grep=')) || '').slice(7);
let bad = 0;
try {
  for (const [name, old, neu, expect, runner] of MUTANTS) {
    if (GREP && name.indexOf(GREP) < 0) continue;
    const anchor = resolve(base, old, neu);
    if (!anchor) {
      console.log('  ? ' + name + '\n    锚点找不到，引擎这行改过了，MUTANTS 表要更新');
      bad++;
      continue;
    }
    fs.writeFileSync(TMP, base.replace(anchor[0], anchor[1]), 'utf8');
    const script = runner === 'brief' ? 'briefcheck.js' : 'selftest.js';
    const r = cp.spawnSync(process.execPath, [path.join(__dirname, script), TMP],
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
