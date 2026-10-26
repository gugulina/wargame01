/* 变异自检：确认 selftest 的断言**真的会红**。
   用法：node tools/mutcheck.js [--keep] [--grep=关键字]

   --grep 只跑名字里含关键字的几条。全量现在 46 条、其中 17 条要起 jsdom，
   跑一遍两分多钟；调某一条断言时没必要等全部。

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
   "const HQ_TABS = ['dex', 'cards', 'aide', 'save'];",
   "const HQ_TABS = ['cards', 'aide', 'save'];",
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
   "if (isAir(u)) return { label: '紧张', mod: 0.88, dist: 0 };",
   'if (false) return { label: 0, mod: 0.88, dist: 0 };',
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
   '      if (tHere) { doAttack(state.selected, tHere); return; }',
   '      if (false) { doAttack(state.selected, tHere); return; }',
   '点这一格 = 开火'],

  ['一格两层时不看能不能打，格里有敌人就开火',
   '  if (!state.selected || !state.targets.length) return null;\n  return unitsAt(r, c).find(x => state.targets.includes(x)) || null;',
   '  if (!state.selected) return null;\n  return unitsAt(r, c).find(x => x.side !== state.selected.side) || null;',
   '不会瞎开火'],

  ['战术卡又只认 unitAt 算出来的那一支（指向敌方的卡落不到同格飞机上）',
   '      const pick = unitsAt(r, c).find(x => cardFitsUnit(card, x));',
   '      const pick = cardFitsUnit(card, u) ? u : null;',
   '指向敌方的战术卡落在空中那一支上'],

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
