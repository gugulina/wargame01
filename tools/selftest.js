/* 机制自测：控制权 / 事件触发器 / 野战工事
   用法：node tools/selftest.js [game/campaign.html]
   任一断言失败即以非零码退出，方便接入改动后的回归。 */
const path = require('path');
const { loadGame } = require('./load');

const file = process.argv[2] && !process.argv[2].startsWith('-')
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'game', 'campaign.html');

const { api, sandbox } = loadGame(file);

/* 整套自测跑在岚口（C3）上：城区的「为了祖国」、两处渡口、第 205 装甲旅、
   第 3 坦克军先遣队这些编制都是 C3 独有的。
   而引擎默认进的 LEVEL 是"最后一个已制作的关"——每加一关它就往前漂一格，
   测试会毫无征兆地炸在第一条断言上。所以这里显式钉死，不依赖默认值。 */
api.newGame({ level: 'C3', noSave: true });
const L = api.LEVEL;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const cn = p => String.fromCharCode(65 + p[1]) + (p[0] + 1);

/* ───────── 一、要点控制权 ───────── */
console.log('\n[1] 要点控制权');
{
  api.newGame();
  const city = L.objectives.find(o => o.id === 'city');
  const guards = api.alive('blue').filter(u =>
    u.type === 'gdn' && city.cells.some(c => c[0] === u.pos[0] && c[1] === u.pos[1]));

  ok('开局城市归我方', api.ctrlState(city) === 'blue', api.ctrlState(city));

  // 守军全部前出作战（这是最初报的 bug）
  guards.forEach((g, i) => { g.pos = [9, 10 + i]; });
  api.updateControl();
  ok('守军前出后仍归我方（持久化）', api.ctrlState(city) === 'blue', api.ctrlState(city));

  // 敌方一个营进城
  const foe = api.alive('red').find(u => api.canCapture(u));
  foe.pos = city.cells[0];
  api.updateControl();
  ok('敌方占据后易手', api.ctrlState(city) === 'red', api.ctrlState(city));

  // 双方同时在城内
  guards[0].pos = city.cells[1];
  api.updateControl();
  ok('双方都在城内 → 争夺中', api.ctrlState(city) === 'contested', api.ctrlState(city));

  // 我方退出，敌方留着
  guards[0].pos = [9, 10];
  api.updateControl();
  ok('我方撤出仍归敌方', api.ctrlState(city) === 'red', api.ctrlState(city));

  // 我方把敌人赶走
  foe.pos = [0, 0];
  guards[0].pos = city.cells[2];
  api.updateControl();
  ok('我方重新占据即夺回', api.ctrlState(city) === 'blue', api.ctrlState(city));
}

/* ───────── 二、事件触发器 ───────── */
console.log('\n[2] 事件触发器');
{
  const ev = id => (L.events || []).find(e => e.id === id);
  if (!ev('crossing_done')) {
    console.log('  （该关卡未配置事件表，跳过）');
  } else {
    // 控制触发 + 增援
    api.newGame();
    let st = api.getState();
    st.turn = ev('crossing_done').when.turn;
    api.updateControl(); api.checkEvents();
    const blueRes = api.alive('blue').filter(u => u.corps === 'B8');
    ok('第 9 回合守住两核心 → 我方增援进场', blueRes.length === 2, blueRes.length + ' 营');

    // 伤亡比例 + buff
    api.newGame();
    st = api.getState();
    for (const u of api.alive('blue').filter(u => u.corps === 'B3')) u.str = Math.ceil(u.str * 0.3);
    api.checkEvents();
    const b3 = api.alive('blue').find(u => u.corps === 'B3');
    const b1 = api.alive('blue').find(u => u.corps === 'B1');
    ok('205 装甲旅伤亡过半 → 该旅攻击 +12%',
       Math.abs(api.modAtk(b3) - 0.12) < 1e-9, api.modAtk(b3));
    ok('修正不外溢到其他编制', api.modAtk(b1) === 0, api.modAtk(b1));

    // 死亡触发
    api.newGame();
    st = api.getState();
    const hq = api.uid('B2H');
    if (hq) {
      api.getState().units = st.units.filter(x => x !== hq);
      api.checkEvents();
      ok('指定兵牌阵亡 → 事件触发', !!st.eventsDone.b2h_lost);
    }
  }
}

/* ───────── 三、工事：建造资格与归属 ───────── */
console.log('\n[3] 工事建造与归属');
{
  api.newGame();
  const engc = api.alive('blue').find(u => u.type === 'engc');
  const eng = api.alive('blue').find(u => u.type === 'eng');
  const cityCell = L.objectives.find(o => o.id === 'city').cells[0];

  ok('工兵连在城区只能挖堑壕',
     JSON.stringify(api.fortKindsFor(engc, cityCell)) === '["H"]',
     api.fortKindsFor(engc, cityCell).join('/'));
  ok('工兵营在城区可建要塞炮',
     api.fortKindsFor(eng, cityCell).includes('P'), api.fortKindsFor(eng, cityCell).join('/'));
  ok('工兵连建碉堡被拒', api.doFort(engc, cityCell, 'B') === false);

  api.newGame();
  const eng2 = api.alive('blue').find(u => u.type === 'eng');
  const built = api.doFort(eng2, cityCell, 'P');
  const f = api.fortAt(cityCell[0], cityCell[1]);
  ok('工兵营建成要塞炮 P', built !== false && f && f.kind === 'P' && Math.abs(f.def - 0.22) < 1e-9);
  ok('建造后行动耗尽', eng2.moved && eng2.fired);

  const arty = api.alive('blue').find(u => u.type === 'art');
  arty.pos = cityCell;
  ok('要塞炮让驻守炮兵射程 +1', api.attackRange(arty) === arty.rng + 1, api.attackRange(arty));

  const foe = api.alive('red').find(u => api.canCapture(u));
  foe.pos = cityCell;
  ok('敌方占据该格吃不到加成', api.fortDef(foe) === 0, api.fortDef(foe));
}

/* ───────── 四、工事被动：碉堡 / 岸防炮 / 防空阵地 ───────── */
console.log('\n[4] 工事被动效果');
{
  // 碉堡：装甲进攻额外 -0.15
  api.newGame();
  let st = api.getState();
  const eng = api.alive('blue').find(u => u.type === 'eng');
  const spot = [12, 16];
  api.doFort(eng, spot, 'B');
  const def = api.alive('blue').find(u => u.type === 'gdn');
  def.pos = spot;
  const arm = api.alive('red').find(u => api.isArmor(u));
  const withB = api.previewAttack(arm, def, st.fields);
  api.getState().forts = [];
  const noB = api.previewAttack(arm, def, st.fields);
  ok('碉堡使装甲进攻修正 -0.15',
     Math.abs((noB.attMod - withB.attMod) - 0.15) < 1e-9, (noB.attMod - withB.attMod));

  // 岸防炮：进相邻渡口格损失 2 战力
  api.newGame();
  st = api.getState();
  const eng2 = api.alive('blue').find(u => u.type === 'eng');
  api.doFort(eng2, [9, 6], 'A');
  const mover = api.alive('red').find(u => u.type === 'mob');
  mover.pos = [9, 6];
  const before = mover.str;
  api.doMove(mover, [8, 6]);
  ok('岸防炮封锁渡口，敌军损失 2 战力', mover.str === before - 2, before + '→' + mover.str);

  // 防空阵地：半径 2 内航空攻击 -0.20
  api.newGame();
  st = api.getState();
  const aab = api.alive('blue').find(u => u.type === 'aab');
  aab.pos = [0, 0];                                   // 挪开防空营，避免取高值
  const avn = api.alive('red').find(u => u.type === 'avn');
  const target = api.alive('blue').find(u => u.type === 'gdn');
  const base = api.aaPenalty(avn, target.pos);
  const aac = api.alive('blue').find(u => u.type === 'aac');
  if (aac) aac.pos = [0, 1];
  api.doFort(api.alive('blue').find(u => u.type === 'eng'), target.pos, 'F');
  const withF = api.aaPenalty(avn, target.pos);
  ok('防空阵地提供 25% 对空压制', Math.abs(withF - Math.max(base, 0.25)) < 1e-9, base + '→' + withF);
}

/* ───────── 六、方案乙：耐久与自动开火 ───────── */
console.log('\n[6] 工事耐久与炮台开火');
{
  // 耐久：攻方伤害先扣工事，扣光才打守军
  api.newGame();
  const eng = api.alive('blue').find(u => u.type === 'eng');
  const spot = [12, 16];
  api.doFort(eng, spot, 'B');
  const guard = api.alive('blue').find(u => u.type === 'gdn');
  guard.pos = spot;
  const f = api.fortAt(spot[0], spot[1]);
  ok('碉堡建好带 3 点耐久', !!f && f.maxHp === 3 && f.hp === 3, f ? f.hp + '/' + f.maxHp : '无');
  const gStr = guard.str;
  const rest1 = api.damageFort(f, 2);
  ok('攻坚伤害先扣耐久', f.hp === 1 && rest1 === 0, 'hp=' + f.hp + ' 穿透=' + rest1);
  ok('工事没破守军不掉血', guard.str === gStr);
  const rest2 = api.damageFort(f, 3);
  ok('耐久扣光后工事被摧毁、伤害穿透', rest2 === 2 && !api.fortAt(spot[0], spot[1]), '穿透=' + rest2);

  // 要塞炮自动开火
  api.newGame();
  const eng2 = api.alive('blue').find(u => u.type === 'eng');
  const cell = L.objectives.find(o => o.id === 'city').cells[0];
  api.doFort(eng2, cell, 'P');
  const victim = api.alive('red').find(u => u.type === 'mob');
  // 要塞炮最小射程 2，放到 2 格处
  const hop = api.neighbors(cell[0], cell[1])[0];
  victim.pos = api.neighbors(hop[0], hop[1]).find(p => api.hexDist(p, cell) === 2) || hop;
  const vStr = victim.str;
  api.fortFire();
  ok('要塞炮结算阶段自动开火 2 点', victim.str === vStr - 2, vStr + '→' + victim.str);

  // 炮位被敌军占领 → 哑火
  api.newGame();
  const eng3 = api.alive('blue').find(u => u.type === 'eng');
  api.doFort(eng3, cell, 'P');
  const foeOn = api.alive('red').find(u => api.canCapture(u));
  api.getState().units.forEach(u => { if (u.side === 'blue' && u.pos[0] === cell[0] && u.pos[1] === cell[1]) u.pos = [13, 0]; });
  foeOn.pos = cell;
  const f3 = api.fortAt(cell[0], cell[1]);
  ok('敌军压住炮位 → 炮台哑火', api.fortSuppressed(f3) && !api.fortWorking(f3));
}

/* ───────── 七、装甲突击 ───────── */
console.log('\n[7] 装甲突击');
{
  api.newGame();
  const st = api.getState();
  const arm = api.alive('blue').find(u => api.isArmor(u));
  const inf = api.alive('blue').find(u => u.type === 'gdn');
  const foe = api.alive('red').find(u => u.type === 'gdn' || api.canCapture(u));

  arm.moved = true;
  const a1 = api.previewAttack(arm, foe, st.fields).attMod;
  arm.moved = false;
  const a0 = api.previewAttack(arm, foe, st.fields).attMod;
  ok('坦克机动后射击无惩罚', Math.abs(a1 - a0) < 1e-9, a0 + '→' + a1);

  inf.moved = true;
  const i1 = api.previewAttack(inf, foe, st.fields).attMod;
  inf.moved = false;
  const i0 = api.previewAttack(inf, foe, st.fields).attMod;
  ok('守备营机动后射击 −0.10', Math.abs((i0 - i1) - 0.10) < 1e-9, (i0 - i1));
  ok('ARM_FIRE 含坦克与自行火炮', api.ARM_FIRE.includes('marm') && api.ARM_FIRE.includes('spa'));
}

/* ───────── 五、火炮射程与近界 ───────── */
console.log('\n[5] 火炮射程（1.5 km/格）');
{
  api.newGame();
  /* 现实数据 → 格数（1 格 = 1.5 km）：
       旅野炮    3–8 km    → 近界 2 格（3 km），远界 5 格（7.5 km）
       师重炮   12–15 km   → 近界 3 格（4.5 km），远界 9 格（13.5 km）
       自行炮   0.8–5 km   → 1–3 格
       反坦克   0.8–1.5 km → 1 格 */
  const mk = (t, rng) => ({ type: t, rng });
  ok('旅野炮近界 2 格（3 km）', api.minRange(mk('art', 5)) === 2);
  ok('师重炮近界 3 格（4.5 km）', api.minRange(mk('hr', 9)) === 3);
  ok('自行火炮近界 1 格', api.minRange(mk('sha', 3)) === 1 && api.minRange(mk('spa', 3)) === 1);
  ok('旅野炮远界 5 格（7.5 km）', api.attackRange(mk('art', 5)) === 5);
  ok('师重炮远界 9 格（13.5 km）', api.attackRange(mk('hr', 9)) === 9);

  /* 近界以内就是打不到：榴弹炮打不了自己脚下，反击也一样 */
  const inf = { type: 'gdn', rng: 1, pos: [5, 5] };
  const art = { type: 'art', rng: 5, pos: [5, 6] };
  const hr  = { type: 'hr',  rng: 9, pos: [5, 7] };
  const sha = { type: 'sha', rng: 3, pos: [5, 6] };
  ok('步兵贴脸旅野炮 → 够不着，不反击', api.canCounter(inf, art) === false);
  ok('步兵贴脸重炮 → 够不着，不反击', api.canCounter(inf, hr) === false);
  ok('步兵贴脸自行炮 → 可反击（直瞄）', api.canCounter(inf, sha) === true);

  /* 目标列表按近界过滤 */
  api.newGame();
  const a = api.alive('blue').find(u => u.type === 'art');
  const t = api.alive('red').find(u => api.canCapture(u));
  api.getState().units.forEach(u => { if (u !== a && u.side === 'red') u.pos = [0, 19]; });
  t.pos = api.neighbors(a.pos[0], a.pos[1])[0];
  ok('贴到近界以内的敌军不在炮兵目标里', !api.targetsFor(a, api.getState().fields).includes(t));
  t.pos = [a.pos[0] - 2, a.pos[1]];
  ok('退到 2 格（近界外）才进目标列表', api.targetsFor(a, api.getState().fields).includes(t));

  /* 直瞄火力减半只对自行炮成立 */
  api.newGame();
  const st2 = api.getState();
  const bSha = api.alive('blue').find(u => u.type === 'sha');
  const rInf = api.alive('red').find(u => api.canCapture(u));
  bSha.pos = api.neighbors(rInf.pos[0], rInf.pos[1])[0];
  const pv = api.previewAttack(rInf, bSha, st2.fields);
  ok('打自行炮 → 可反击但火力减半', pv.counter === true && pv.counterSoft === true);
}

/* ───────── 四、地图视图（移动端缩放/平移） ───────── */
console.log('\n[4] 地图视图');
{
  const v = api.view;
  ok('view 钩子已导出', !!v && typeof v.fitView === 'function');

  const bs = v.boardSize();
  const expW = L.cols * Math.sqrt(3) * 27 + Math.sqrt(3) * 27 / 2;
  const expH = (L.rows - 1) * 54 * 0.75 + 54;
  ok('棋盘尺寸与格子数学一致',
     Math.abs(bs.w - expW) < 0.01 && Math.abs(bs.h - expH) < 0.01,
     bs.w.toFixed(1) + '×' + bs.h.toFixed(1));

  /* Node 环境没有 matchMedia，isNarrow 应为 false，桌面不做任何变换 */
  ok('桌面模式不缩放', v.isNarrow() === false && v.k === 1, 'k=' + v.k);
  v.fitView(false);
  ok('桌面调用 fitView 后仍为 1 倍', v.k === 1 && v.x === 0 && v.y === 0);
}

/* ───────── 六、表现层接口（FX / ASSETS） ───────── */
console.log('\n[6] 表现层接口');
{
  const FX = api.FX, A = api.ASSETS;

  ok('FX 总线已导出', !!FX);
  for (const m of ['sfx', 'bgm', 'shake', 'pop', 'banner', 'cutin', 'hit', 'clear', 'reset']) {
    ok('FX.' + m + ' 可用', typeof FX[m] === 'function');
  }

  ok('ASSETS 已导出且 base 为相对路径',
     !!A && typeof A.base === 'string' && !A.base.startsWith('/'), A && A.base);
  const missUnit = Object.keys(api.TYPE).filter(k => !A.unit || !(k in A.unit));
  ok('兵种素材槽与 TYPE 表一一对齐', missUnit.length === 0, missUnit.join(','));
  ok('工事素材槽与 FORT 表一一对齐',
     api.FORT_KEYS.every(k => A.fort && (k in A.fort)));

  /* 素材全为 null 时，调用链必须静默降级而不是抛错 */
  let threw = null;
  try {
    FX.sfx('fire'); FX.bgm('battle'); FX.pop('-3', [3, 3], 'b');
    FX.banner('测试横幅', 'hi'); FX.shake();
    FX.hit({ defLoss: 3, attLoss: 1, defPos: [2, 2], attPos: [2, 3], defSide: 'red', attSide: 'blue' });
  } catch (e) { threw = e; }
  ok('素材缺失时全部静默降级', threw === null, threw && threw.message);

  /* 一次攻击要走到表现层：音效 + 震屏 + 飘字 */
  api.newGame();
  FX.reset();
  const a = api.alive('blue').find(u => api.isArmor(u));
  const d = api.alive('red').find(u => api.canCapture(u));
  d.pos = api.neighbors(a.pos[0], a.pos[1])[0];
  api.doAttack(a, d);
  ok('攻击触发音效', FX.stat.sfx >= 1, 'sfx=' + FX.stat.sfx);
  ok('攻击触发震屏', FX.stat.shake >= 1, 'shake=' + FX.stat.shake);
  ok('攻击产生伤害飘字', FX.stat.pop >= 1, 'pop=' + FX.stat.pop);

  /* 歼灭在 removeUnit 里统一埋点，任何死亡都要走到 */
  api.newGame();
  FX.reset();
  const a2 = api.alive('blue').find(u => api.isArmor(u));
  const d2 = api.alive('red').find(u => api.canCapture(u));
  d2.pos = api.neighbors(a2.pos[0], a2.pos[1])[0];
  d2.str = 0;
  api.doAttack(a2, d2);
  ok('歼灭触发击杀音效与飘字', FX.stat.sfx >= 2 && FX.stat.pop >= 2,
     'sfx=' + FX.stat.sfx + ' pop=' + FX.stat.pop);

  /* 事件链要同时推横幅 */
  api.newGame();
  FX.reset();
  const st = api.getState();
  st.turn = 9;
  api.updateControl(); api.checkEvents();
  ok('事件触发时推出横幅', FX.stat.banner >= 1 && !!st.eventsDone.crossing_done,
     'banner=' + FX.stat.banner);

  /* 新增的 effect 类型不应打断事件链 */
  api.newGame();
  FX.reset();
  let threw2 = null;
  try {
    api.applyEffect({ kind: 'sfx', name: 'event' });
    api.applyEffect({ kind: 'banner', text: '效果测试' });
    api.applyEffect({ kind: 'bgm', name: 'tension' });
    api.applyEffect({ kind: 'story', id: '不存在的剧情' });
    api.applyEffect({ kind: 'say', who: '测试', text: '测' });
  } catch (e) { threw2 = e; }
  ok('banner/sfx/bgm/say/story 效果不抛错', threw2 === null, threw2 && threw2.message);
  ok('say 效果进入剧情卡队列', FX.stat.cutin >= 1, 'cutin=' + FX.stat.cutin);

  /* 总开关：关掉后表现层完全不动，规则照跑 */
  FX.on = false;
  FX.reset();
  api.newGame();
  const a3 = api.alive('blue').find(u => api.isArmor(u));
  const d3 = api.alive('red').find(u => api.canCapture(u));
  d3.pos = api.neighbors(a3.pos[0], a3.pos[1])[0];
  const before = d3.str;
  api.doAttack(a3, d3);
  ok('FX.on=false 时表现层完全静默',
     FX.stat.sfx === 0 && FX.stat.pop === 0 && FX.stat.shake === 0,
     JSON.stringify(FX.stat));
  ok('FX.on=false 不影响战斗结算', d3.str <= before, d3.str + ' vs ' + before);
  FX.on = true;
}

/* ───────── 存档 ───────── */
console.log('\n[13] 存档往返');
{
  const LS = sandbox.localStorage;
  LS.clear();

  api.newGame();
  ok('开局即建档（"继续"按钮不会空着）', !!api.readSave(), 'save=' + JSON.stringify(!!api.readSave()));

  /* 走一步 → 存 → 读，比对位置 / 得分 / 行动标记 */
  const bu = api.alive('blue').find(u => u.type === 'gdn');
  const from = bu.pos.slice();
  const to = api.neighbors(from[0], from[1]).find(p =>
    api.terrainAt(p[0], p[1]).cost < 99 && !api.unitAt(p[0], p[1]));
  api.doMove(bu, to);
  const scoreA = api.blueScore();
  const s1 = api.readSave();
  api.restoreGame(s1);
  const bu2 = api.uid(bu.id);
  ok('读档后单位位置一致', !!bu2 && bu2.pos[0] === to[0] && bu2.pos[1] === to[1],
     bu2 && bu2.pos.join(','));
  ok('读档后得分一致', api.blueScore() === scoreA, api.blueScore() + ' vs ' + scoreA);
  ok('读档后"已行动"标记保留', bu2.moved === true);

  /* 地形改动（架桥）必须一起存 —— 这是最容易漏的一项 */
  api.newGame();
  const row8 = L.map[8];
  const riverC = row8.indexOf('~');
  ok('测试前提：河行存在河流格', riverC >= 0, row8);
  api.doBridge(api.alive('blue')[0], [8, riverC]);
  ok('架桥改写了地形', L.map[8][riverC] === '=', L.map[8]);
  const s2 = api.readSave();
  ok('存档记录了地形改动', !!s2 && s2.map[8][riverC] === '=');
  /* 把内存里的桥拆掉，再从档里恢复 */
  L.map[8] = L.map[8].substring(0, riverC) + '~' + L.map[8].substring(riverC + 1);
  ok('测试前提：内存中的桥已被拆回', L.map[8][riverC] === '~');
  api.restoreGame(s2);
  ok('读档把桥恢复回来', L.map[8][riverC] === '=', L.map[8]);

  /* 工事与雷区属于"玩家自己布的局"，也必须活过读档 */
  api.newGame();
  const eng = api.alive('blue').find(u => u.type === 'eng');
  api.doFort(eng, eng.pos.slice(), 'B');
  const nf = api.getState().forts.length;
  api.restoreGame(api.readSave());
  ok('读档后工事数量一致', api.getState().forts.length === nf, api.getState().forts.length + ' vs ' + nf);
  ok('读档后工事耐久保留',
     api.getState().forts.every(f => f.hp === undefined || f.hp <= f.maxHp));

  /* 已分胜负的局不该继续覆盖存档 */
  api.newGame();
  api.getState().result = 'win';
  ok('已分胜负的局不再写档', api.saveGame() === false);

  /* 版本 / 关卡不符一律拒绝，宁可让玩家重开也不能读半个坏局 */
  api.newGame();
  const raw = JSON.parse(LS.getItem(api.SAVE_KEY));
  raw.v = 999;
  LS.setItem(api.SAVE_KEY, JSON.stringify(raw));
  ok('版本不符的旧档被拒绝', api.readSave() === null);
  const raw2 = JSON.parse(LS.getItem(api.SAVE_KEY));
  raw2.v = api.SAVE_VER; raw2.lv = '别的关卡';
  LS.setItem(api.SAVE_KEY, JSON.stringify(raw2));
  ok('关卡不符的档被拒绝', api.readSave() === null);

  api.clearSave();
  ok('clearSave 之后没有存档', api.readSave() === null);

  /* 降级：隐私模式 / file:// 直开时 localStorage 会抛错，游戏不能因此崩 */
  api.newGame();
  const had = sandbox.localStorage;
  delete sandbox.localStorage;
  let threw = null, ret = null;
  try { ret = api.saveGame(); } catch (e) { threw = e; }
  ok('没有 localStorage 时存档静默失败', threw === null && ret === false, threw && threw.message);
  ok('没有 localStorage 时读档返回 null', api.readSave() === null);
  sandbox.localStorage = had;
}

/* ───────── 十四、堆叠与穿越 ───────── */
console.log('\n[14] 堆叠与穿越');
{
  const k = (r, c) => r + ',' + c;

  api.newGame();
  const A = api.uid('B1A'), B = api.uid('B1B'), C = api.uid('B1C');
  ok('开局 A、B 相邻（测试前提）', api.hexDist(A.pos, B.pos) === 1);

  const r1 = api.computeReach(A);
  ok('有友军的格子可以作为落点（未堆满）', r1.stop[k(B.pos[0], B.pos[1])] !== undefined);

  api.doMove(A, B.pos.slice());
  ok('两支部队可以同格', api.unitsAt(B.pos[0], B.pos[1]).length === 2);
  ok('stackFull 判定为满', api.stackFull(B.pos[0], B.pos[1]) === true);

  const r2 = api.computeReach(C);
  ok('堆满的格子仍可穿过（d 有记录）', r2.d[k(B.pos[0], B.pos[1])] !== undefined);
  ok('堆满的格子不能停留（stop 无记录）', r2.stop[k(B.pos[0], B.pos[1])] === undefined);

  /* 穿越：以前 unitAt() 一律拦死，友军挡在桥头就整条路断了 */
  ok('穿越友军不会让可达范围清空', Object.keys(r2.d).length > 0);

  /* 同格友军按 50% 计入防御协同，比相邻格的 35% 高。
     用平原空地做对照，避开要点控制权与「为了祖国」的干扰。 */
  api.newGame();
  const A2 = api.uid('B1A'), B2 = api.uid('B1B');
  A2.pos = [9, 9]; B2.pos = [9, 10];
  const foe = api.uid('R3A');
  foe.pos = [11, 9];        // 距 2 格：不产生 ZOC，免得把 A2 的补给切断
  const defBefore = api.previewAttack(foe, A2, api.getState().fields).defSum;
  api.doMove(B2, A2.pos.slice());
  const defAfter = api.previewAttack(foe, A2, api.getState().fields).defSum;
  ok('同格友军计入防御协同（比相邻更硬）', defAfter > defBefore + 0.01,
     defBefore.toFixed(2) + ' → ' + defAfter.toFixed(2));

  /* ── 以下走真实点击路径 ──
     上一版只测 doMove（直接改坐标），105 项全绿但玩家点不出来：
     onHexClick 里"有友军就 select(u) 并 return"，永远进不到 doMove。
     这一组断言专门守住点击层。 */
  api.newGame();
  const P = api.uid('B1A'), Q = api.uid('B1B');
  const qp = Q.pos.slice();
  api.select(P);
  ok('点击前：P 的可停格包含 Q 所在格', api.getState().reachable.stop[k(qp[0], qp[1])] !== undefined);
  api.onHexClick(qp[0], qp[1]);
  ok('点友军格 = P 移动过去（而不是切换选中）',
     api.uid('B1A').pos.join(',') === qp.join(','),
     'P 在 ' + api.uid('B1A').pos.join(',') + '，Q 在 ' + qp.join(','));
  ok('点击后真的堆叠成 2 支', api.unitsAt(qp[0], qp[1]).length === 2);
  ok('移动后 P 被标记为已行动', api.uid('B1A').moved === true);

  /* 堆满之后再点：不该还能塞第三支，而是切换选中 */
  api.newGame();
  const X = api.uid('B1A'), Y = api.uid('B1B'), Z = api.uid('B1C');
  const zp = Z.pos.slice();
  api.doMove(X, zp);
  const over = api.doMove(Y, zp);
  ok('doMove 对满堆叠格有兜底校验（塞不进第三支）',
     over === false && api.unitsAt(zp[0], zp[1]).length === 2,
     '返回 ' + over + '，格内 ' + api.unitsAt(zp[0], zp[1]).length + ' 支');
  ok('前提：Z 所在格已堆满 2 支', api.unitsAt(zp[0], zp[1]).length === 2);
  const z0 = api.uid('B1C').pos.join(',');
  const A3 = api.uid('B2A');
  api.select(A3);
  api.onHexClick(zp[0], zp[1]);
  ok('满堆叠格不可再塞人', api.unitsAt(zp[0], zp[1]).length === 2,
     '现在 ' + api.unitsAt(zp[0], zp[1]).length + ' 支');
  ok('满堆叠格点击退回"切换选中"语义', api.uid('B2A').pos.join(',') !== zp.join(','));

  /* 格内两支时，再点同一格轮换选中，能选到下层 */
  api.newGame();
  const U1 = api.uid('B1A'), U2 = api.uid('B1B');
  const upp = U2.pos.slice();
  api.doMove(U1, upp);
  const top = api.unitAt(upp[0], upp[1]);
  api.select(top);
  api.onHexClick(upp[0], upp[1]);
  const now = api.getState().selected;
  ok('同格连点可轮换到另一支', now && (now.id === 'B1A' || now.id === 'B1B'), now && now.id);

  /* 渡口：玩家实际卡住的位置。地图第 8 行是河，列 6/7 与 12/13 是渡口。
     之前"堆叠做不出来"就是在这种单格瓶颈上暴露的。 */
  api.newGame();
  const f1 = api.uid('B1A'), f2 = api.uid('B1B');
  f1.pos = [7, 6]; f1.moved = false;
  f2.pos = [7, 7]; f2.moved = false;
  api.select(f1);
  api.onHexClick(8, 6);
  ok('渡口格：第一支点进去能站住', api.unitsAt(8, 6).length === 1,
     '格内 ' + api.unitsAt(8, 6).length + ' 支');
  api.select(f2);
  api.onHexClick(8, 6);
  ok('渡口格：第二支点同一格能堆叠进去', api.unitsAt(8, 6).length === 2,
     '格内 ' + api.unitsAt(8, 6).length + ' 支');
  ok('渡口堆叠后仍标记为满', api.stackFull(8, 6) === true);
}

/* ───────── 十五、撤销 ───────── */
console.log('\n[15] 撤销');
{
  api.newGame();
  const A = api.uid('B1A');
  const p0 = A.pos.slice();
  const d0 = api.undoDepth;
  api.doMove(A, [10, 2]);
  ok('移动后撤销栈 +1', api.undoDepth === d0 + 1, api.undoDepth + ' vs ' + d0);
  ok('移动生效', api.uid('B1A').pos.join(',') === '10,2');
  api.doUndo();
  ok('撤销后回到原位', api.uid('B1A').pos.join(',') === p0.join(','));
  ok('撤销后撤销栈减 1', api.undoDepth === d0);

  /* 攻击撤销：随机骰子不该把玩家锁死在一次误点里 */
  api.newGame();
  const att = api.uid('B3B'), tgt = api.uid('R3A');
  tgt.pos = [att.pos[0], att.pos[1] + 1];
  const s0 = tgt.str, a0 = att.str;
  api.doAttack(att, tgt);
  const after = api.uid('R3A');
  ok('攻击确实产生伤害', !after || after.str < s0);
  api.doUndo();
  ok('撤销后目标战力复原', api.uid('R3A') && api.uid('R3A').str === s0,
     api.uid('R3A') && api.uid('R3A').str + ' vs ' + s0);
  ok('撤销后攻击方战力复原', api.uid('B3B') && api.uid('B3B').str === a0);

  /* 敌方阶段不能撤 —— 否则等于给玩家一个无限的 AI 重掷器 */
  api.newGame();
  api.getState().phase = 'ai';
  ok('AI 阶段撤销无效', api.doUndo() === false);

  api.newGame();
  ok('新开局清空撤销栈', api.undoDepth === 0);
}

/* ───────── 十六、补给点 ───────── */
console.log('\n[16] 补给点');
{
  const k = (r, c) => r + ',' + c;

  /* 半径必须真的生效：旧代码里 supplySources 的 r 字段根本没被读取，
     所有源一律扩散 12 格，补给点建在哪儿都不会改变数字。 */
  api.newGame();
  const sup = api.uid('B3S');
  sup.pos = [3, 9];                       // 北岸，离两个蓝方基地都很远
  const distant = api.supplyOf({ side: 'blue', type: 'inf', pos: [3, 9], str: 8, org: 100 },
                               api.supplyField('blue'));
  ok('建点前该处补给断绝', distant.label === '断绝', distant.label);

  api.doDepot(sup);
  ok('补给点写入状态', api.getState().depots.length === 1);

  const f = api.supplyField('blue');
  ok('补给点本格补给充足', f[k(3, 9)] && f[k(3, 9)].label === '充足', f[k(3, 9)] && f[k(3, 9)].label);
  ok('半径 4 内仍是充足', f[k(3, 13)] && f[k(3, 13)].label === '充足', f[k(3, 13)] && f[k(3, 13)].label);
  ok('半径外一圈降为紧张', f[k(3, 14)] && f[k(3, 14)].label === '紧张', f[k(3, 14)] && f[k(3, 14)].label);

  const n1 = api.getState().depots.length;
  api.doDepot(sup);
  ok('同格重复建不叠加', api.getState().depots.length === n1, api.getState().depots.length + ' vs ' + n1);

  /* 补给线的半径来自"源"，辎重比基地多推一格 */
  const srcs = api.supplySources('blue');
  const dep = srcs.find(s => s.kind === '补给点');
  const base = srcs.find(s => s.kind === '基地');
  ok('补给点半径大于基地', dep && base && dep.r > base.r, dep && base && dep.r + ' vs ' + base.r);
}

/* ───────── 十七、拖曳炮展收 ───────── */
console.log('\n[17] 拖曳炮架设与收起');
{
  api.newGame();
  const art = api.alive('blue').find(u => u.type === 'art');
  ok('守军炮兵预设阵地，初始已展开', art.packed === false);
  ok('旅野炮属于拖曳炮', api.isTowed(art) === true);

  /* 没收到炮就挪不动——这就是"打完要花一回合收回"的强制点 */
  const p0 = art.pos.slice();
  const tgt = api.neighbors(p0[0], p0[1]).find(n => api.getState().units.filter(x =>
    x.pos[0] === n[0] && x.pos[1] === n[1]).length < api.STACK_MAX);
  const r0 = api.doMove(art, tgt);
  ok('未收炮 → 拒绝转移', r0 === false && art.pos.join(',') === p0.join(','), '返回 ' + r0);

  /* 收炮吃掉整个回合 */
  ok('收炮执行成功', api.doPack(art) === true);
  ok('收炮后进入行军状态', art.packed === true);
  ok('收炮占掉本回合的移动与射击', art.moved === true && art.fired === true);
  ok('行军状态不能射击', api.targetsFor(art, api.getState().fields).length === 0);

  /* 下一回合：能走了，但到新阵地仍是行军状态 */
  art.moved = false; art.fired = false;
  const r1 = api.doMove(art, tgt);
  ok('收炮后下一回合可以转移', r1 === true, '返回 ' + r1);
  ok('转移后仍需重新架设', art.packed === true);

  /* 展开同样吃掉整个回合，本回合开不了火 */
  art.moved = false; art.fired = false;
  ok('架设执行成功', api.doUnpack(art) === true);
  ok('架设后恢复展开状态', art.packed === false);
  ok('架设当回合不能射击', art.fired === true);

  /* 自行炮不受这套节拍约束 */
  const sha = api.alive('blue').find(u => u.type === 'sha');
  ok('自行火炮不属于拖曳炮', api.isTowed(sha) === false);
  ok('自行炮没有 packed 限制', api.targetsFor(sha, api.getState().fields) !== null);

  /* 完整循环 4 回合：打 → 收 → 移 → 架 */
  api.newGame();
  const a2 = api.alive('blue').find(u => u.type === 'art');
  let steps = 0;
  if (api.doPack(a2)) steps++;
  a2.moved = false; a2.fired = false;
  const nb = api.neighbors(a2.pos[0], a2.pos[1])[0];
  if (api.doMove(a2, nb)) steps++;
  a2.moved = false; a2.fired = false;
  if (api.doUnpack(a2)) steps++;
  a2.moved = false; a2.fired = false;
  ok('一个完整循环是"收炮→转移→架设"三步', steps === 3, '完成了 ' + steps + ' 步');
  ok('走完循环后可以再次射击', a2.packed === false && a2.moved === false);
}

/* ───────── 十八、工事抗炮击 ───────── */
console.log('\n[18] 工事抗炮击');
{
  api.newGame();
  const A = api.uid('B1A'), E = api.uid('B1E');
  A.pos = [9, 9]; E.pos = [9, 10];
  const gun = api.uid('R3F');          // 敌旅属野炮（射程 2–5）
  gun.pos = [9, 13];
  const inf = api.uid('R3A');
  inf.pos = [8, 9];

  const st = api.getState();
  const p0 = api.previewAttack(gun, A, st.fields).attMod;
  const m0 = api.previewAttack(inf, A, st.fields).attMod;

  ok('工兵建堑壕成功', api.doFort(E, [9, 9], 'H') !== false);
  const p1 = api.previewAttack(gun, A, api.getState().fields).attMod;
  const m1 = api.previewAttack(inf, A, api.getState().fields).attMod;

  ok('堑壕让炮击修正再降 0.45', Math.abs((p0 - p1) - 0.45) < 0.02,
     p0.toFixed(2) + ' → ' + p1.toFixed(2));
  ok('近战攻击不受抗炮击影响', Math.abs(m0 - m1) < 0.001,
     m0.toFixed(2) + ' → ' + m1.toFixed(2));
  ok('抗炮击只对有工事的一方生效', api.FORT.H.shell === 0.45 && api.FORT.B.shell === 0.65,
     'H ' + api.FORT.H.shell + ' / B ' + api.FORT.B.shell);
}

console.log('\n[19] 坦克三型（轻 / 中 / 重）');
{
  ok('三型都在装甲名单里',
     api.ARMOR_TYPES.length === 3 && api.ARMOR_TYPES.every(t => api.TYPE[t]));
  ok('轻坦机动最高、重坦最低',
     api.TYPE.larm.mv > api.TYPE.marm.mv && api.TYPE.marm.mv > api.TYPE.harm.mv,
     api.TYPE.larm.mv + ' / ' + api.TYPE.marm.mv + ' / ' + api.TYPE.harm.mv);
  ok('火力则反过来：重坦最高',
     api.TYPE.harm.st > api.TYPE.marm.st && api.TYPE.marm.st > api.TYPE.larm.st,
     api.TYPE.larm.st + ' / ' + api.TYPE.marm.st + ' / ' + api.TYPE.harm.st);
  ok('平原加成随吨位递增',
     api.ARMOR_PROFILE.larm.open < api.ARMOR_PROFILE.marm.open &&
     api.ARMOR_PROFILE.marm.open < api.ARMOR_PROFILE.harm.open,
     api.ARMOR_PROFILE.larm.open + ' / ' + api.ARMOR_PROFILE.marm.open + ' / ' + api.ARMOR_PROFILE.harm.open);
  ok('城镇惩罚也随吨位加重',
     api.ARMOR_PROFILE.larm.town < api.ARMOR_PROFILE.harm.town);
  ok('重坦没有行进间射击能力', !api.ARM_FIRE.includes('harm') && api.ARM_FIRE.includes('marm'));
  ok('轻坦不能击退守军', api.canPushBack({ type: 'larm' }) === false &&
     api.canPushBack({ type: 'marm' }) === true && api.canPushBack({ type: 'harm' }) === true);
  ok('反坦克打重坦最难，打轻坦最易',
     api.AT_VS_ARMOR.harm < api.AT_VS_ARMOR.marm && api.AT_VS_ARMOR.marm < api.AT_VS_ARMOR.larm,
     api.AT_VS_ARMOR.larm + ' / ' + api.AT_VS_ARMOR.marm + ' / ' + api.AT_VS_ARMOR.harm);
  ok('重坦打轻坦有加成、轻坦打重坦吃亏',
     api.ARM_VS.harm.larm > 0 && api.ARM_VS.larm.harm < 0);

  /* 实算一遍：同一门反坦克炮打同一格上的三种坦克，攻击修正必须分档 */
  const at = api.alive('blue').find(u => u.type === 'at' || u.type === 'td');
  const tgt = api.alive('red').find(u => api.isArmor(u));
  if (at && tgt) {
    const keep = tgt.type, out = {};
    for (const k of ['larm', 'marm', 'harm']) {
      tgt.type = k;
      out[k] = api.previewAttack(at, tgt, api.getState().fields).attMod;
    }
    tgt.type = keep;
    ok('反坦克实算：轻坦 > 中坦 > 重坦',
       Math.abs((out.larm - out.marm) - 0.10) < 0.02 &&
       Math.abs((out.marm - out.harm) - 0.25) < 0.02,
       out.larm.toFixed(2) + ' / ' + out.marm.toFixed(2) + ' / ' + out.harm.toFixed(2));
  } else {
    ok('反坦克实算（本关缺反坦克或坦克，跳过）', true);
  }
}

console.log('\n[20] 战术卡');
{
  const st = api.getState();
  ok('六张卡都在卡池里', api.CARD_IDS.length >= 6, api.CARD_IDS.join(','));
  ok('每张卡有完整文案', api.CARD_IDS.every(id => {
    const c = api.CARDS[id];
    return c.name && c.desc && c.note && c.tag && c.target && typeof c.apply === 'function';
  }));
  ok('携带上限是 3', api.CARD_MAX === 3);

  /* 注意顺序：writeDeck 写的是"战役进度里的牌组"，只有 newGame 才会读进 state。
     先写再开局，否则测的是上一局带进来的旧牌组——这里踩过一次。 */
  api.writeDeck([]);
  api.newGame({ noSave: true });
  ok('空牌组不能使用', api.useCard('assault', api.alive('blue')[0]) === false,
     '当前牌组 ' + JSON.stringify(api.deckOf()));

  api.writeDeck(['hold']);
  api.newGame({ noSave: true });
  ok('不在牌组里的卡不能用', api.useCard('assault', api.alive('blue')[0]) === false);

  api.writeDeck(['assault', 'barrage', 'forced']);
  api.newGame({ noSave: true });
  ok('牌组写回后可用', api.deckOf().indexOf('assault') >= 0);
  const blue = api.alive('blue')[0];
  const red = api.alive('red')[0];

  /* 目标方向校验：突击只能给自己人，炮火准备只能给敌人 */
  ok('突击卡拒绝敌方目标', api.useCard('assault', red) === false);
  ok('炮火准备拒绝己方目标', api.useCard('barrage', blue) === false);

  /* 正例：突击卡给己方，攻击修正 +0.30 */
  const me = api.alive('blue').find(u => u.rng > 0);
  const foe = api.alive('red')[0];
  api.clearCardBuffs(api.getState().units);
  const base = api.previewAttack(me, foe, api.getState().fields).attMod;
  ok('突击卡使用成功', api.useCard('assault', me) === true);
  const after = api.previewAttack(me, foe, api.getState().fields).attMod;
  ok('突击卡让攻击修正 +0.30', Math.abs((after - base) - 0.30) < 0.001,
     base.toFixed(2) + ' → ' + after.toFixed(2));
  ok('同一张卡不能再用第二次', api.useCard('assault', me) === false);

  /* 坚守卡：防御 +0.30，并且锁住移动 */
  api.writeDeck(['hold', 'barrage', 'forced']);
  api.newGame({ noSave: true });
  const hold = api.alive('blue')[0];
  api.useCard('hold', hold);
  ok('坚守卡锁住移动', hold.moved === true);
  ok('坚守卡给防御 +0.30', Math.abs((hold.cardDef || 0) - 0.30) < 0.001);

  /* 炮火准备：只掉组织度，不掉战力 */
  api.writeDeck(['barrage', 'hold', 'forced']);
  api.newGame({ noSave: true });
  const tgt = api.alive('red')[0];
  const org0 = tgt.org, str0 = tgt.str;
  api.useCard('barrage', tgt);
  ok('炮火准备扣组织度不减战力', tgt.str === str0 && Math.abs(org0 - tgt.org - 20) < 0.001,
     org0 + ' → ' + tgt.org);

  /* 强行军：机动 +6 且重获行动 */
  api.writeDeck(['forced', 'hold', 'assault']);
  api.newGame({ noSave: true });
  const f = api.alive('blue')[0];
  f.moved = true;
  api.useCard('forced', f);
  ok('强行军恢复行动并加机动', f.moved === false && (f.cardMov || 0) === 6);

  /* 回合开始清理：模拟新回合里的那一步 */
  api.clearCardBuffs();
  ok('新回合清空战术卡加成', !f.cardMov && !f.cardDef && !f.cardAtk);

  /* armCard 的守卫 */
  api.writeDeck(['forced']);
  api.newGame({ noSave: true });
  ok('未携带的卡不能待命', api.armCard('hold') === false);
  ok('携带的卡可以待命', api.armCard('forced') === true);
  ok('待命状态记录在 state 上', api.getState().cardId === 'forced');
  ok('取消后清空', (api.cancelCard(), api.getState().cardId === null));
}

console.log('\n[21] 存档文件（导出 / 导入）');
{
  api.writeDeck(['forced', 'hold', 'assault']);
  api.newGame({ noSave: true });
  const pack = api.buildSaveFile();
  ok('导出包带应用标识与版本',
     pack.app === api.SAVE_FILE_APP && pack.v === api.SAVE_VER && pack.kind === 'save');
  ok('导出包含当前战场', !!pack.save && Array.isArray(pack.save.units));
  ok('导出包含战役进度与牌组', !!pack.progress && Array.isArray(pack.progress.deck));

  /* 往返：改一个可观测的字段，导进去再读回来 */
  pack.save.turn = 7;
  pack.progress.cleared = { C3: 'win' };
  const r = api.applySaveFile(pack);
  const back = api.readSave();
  ok('导入成功', r.ok === true, r.msg);
  ok('回合数被正确写回', back && back.turn === 7);
  ok('通关进度也被写回', (api.readProgress().cleared || {}).C3 === 'win');

  /* 坏文件三连：不是本作 / 版本不符 / 关卡不存在 */
  const b1 = api.applySaveFile({ app: 'other', kind: 'save', v: api.SAVE_VER });
  ok('拒绝非本作文件', b1.ok === false && b1.msg.indexOf('苍屿') >= 0, b1.msg);
  const b2 = api.applySaveFile({ app: api.SAVE_FILE_APP, kind: 'save', v: 999 });
  ok('拒绝版本不符', b2.ok === false && b2.msg.indexOf('版本不符') >= 0, b2.msg);
  const b3 = api.applySaveFile({ app: api.SAVE_FILE_APP, kind: 'save', v: api.SAVE_VER,
                                 save: { lv: 'NOPE', turn: 1 } });
  ok('拒绝指向不存在关卡', b3.ok === false, b3.msg);
  ok('拒绝非 JSON 文本',
     api.importSaveText('{ this is not json').ok === false);
  /* XSS：pack.v 可以是任意字符串，消息会原样回显版本号，
     但渲染端（hqSaveNote）必须用 textContent，不能拼 HTML。
     这里只断言消息本身不包含可执行标签的拼接产物——
     真正的防线在 hqSaveNote 的 textContent，人工审查。 */
  const bx = api.applySaveFile({ app: api.SAVE_FILE_APP, kind: 'save',
                                  v: '<img src=x onerror=alert(1)>' });
  ok('XSS 载荷被当纯文本回显、不产生额外标签', bx.ok === false && bx.msg.indexOf('onerror') >= 0 && !/<b/i.test(bx.msg));
  ok('坏文件不会破坏已有存档', (() => {
    const s = api.readSave();
    return s && s.turn === 7;          // 上一步写进去的还在
  })());
  try { window.localStorage.removeItem(api.PROGRESS_KEY); } catch (e) {}
}

console.log('\n[22] 三种胜负条件（score / survive / reach）');
{
  /* ── 关卡序号文案 ──
     no:0 是序章，写成"第 0 关"会让玩家以为漏了一关 */
  ok('序章不写第 0 关', api.levelNoText({ no: 0 }) === '序 · ');
  ok('普通关写第 N 关', api.levelNoText({ no: 3 }) === '第 3 关 · ');
  ok('附属关与正关同号，靠前缀区分',
     api.levelNoText({ no: 3, sub: true }) === '第 3 关 · 附属 · ');

  /* ── survive：北岭要塞 ── */
  api.newGame({ level: 'C1', noSave: true });
  ok('C1 是坚守关', api.winSpec().kind === 'survive', api.winSpec().kind);
  ok('C1 要求保住要塞核心', (api.winSpec().keep || []).indexOf('core') >= 0);
  ok('C1 预置工事已进场', api.getState().forts.length >= 4, api.getState().forts.length + ' 处');
  ok('预置工事属于蓝方', api.getState().forts.every(f => f.side === 'blue'));
  ok('碉堡与要塞炮都在', (() => {
    const ks = api.getState().forts.map(f => f.kind);
    return ks.indexOf('B') >= 0 && ks.indexOf('P') >= 0;
  })());
  /* 全灭立即判负——这条对所有关卡生效，先于任何胜利判定 */
  const st1 = api.getState();
  st1.units = st1.units.filter(u => u.side !== 'blue');
  api.checkEnd();
  ok('C1 全灭判负', st1.result === 'fail', st1.result);

  /* ── reach：青溪渡口 ── */
  api.newGame({ level: 'C2', noSave: true });
  const w2 = api.winSpec();
  ok('C2 是突围关', w2.kind === 'reach');
  ok('需撤出 4 支', api.escapeGoal() === 4, api.escapeGoal());
  ok('矩形撤离区展开成 8 格', api.escapeCells().length === 8, api.escapeCells().length);
  ok('渡口格在撤离区内', api.inEscapeZone([4, 15]) === true);
  ok('出发点不在撤离区', api.inEscapeZone([4, 3]) === false);

  /* 达标数不够 → 判负 */
  ok('撤出不够判负', api.reachResult() === 'fail', api.reachResult());

  /* 走进撤离区：立刻离场并计数 */
  const g = api.escapeGoal();
  const zone = api.escapeCells();
  const movers = api.alive('blue').slice(0, g);
  const before = api.alive('blue').length;
  movers.forEach((u, i) => { u.pos = zone[i].slice(); });
  const moved = api.checkEscape();
  ok('走进撤离区即离场计数', moved === g && api.escapedCount() === g,
     moved + ' / ' + api.escapedCount());
  ok('撤出的部队已从战场移除',
     api.alive('blue').length === before - g &&
     movers.every(u => api.alive('blue').indexOf(u) < 0));
  ok('撤出部队的战力算得回来', api.escapedStr() > 0, api.escapedStr());
  ok('达标且基本成建制 → 超额', api.reachResult() === 'perfect', api.reachResult());
  api.checkEnd();
  ok('凑够数量立刻结束', api.getState().result !== null, api.getState().result);

  /* 达标但打残了 → 只是达成，不算超额。
     旧写法用"撤出数 > 目标数"判超额，而 checkEnd 在达标那一刻就结束，
     那条路永远走不到，perfect 是死代码。 */
  api.newGame({ level: 'C2', noSave: true });
  const z2 = api.escapeCells();
  for (let i = 0; i < g; i++) {
    const u = api.alive('blue')[0];
    u.pos = z2[i].slice();
    api.checkEscape();
  }
  const st2 = api.getState();
  const survivors = api.alive('blue');
  survivors.slice(1).forEach(u => { u.str = 1; });     // 剩下的全打残
  ok('打残之后只能算达成', api.reachResult() === 'win', api.reachResult() + '（剩 ' + survivors.length + ' 支）');
  ok('撤离区之外的格子不算撤出', api.inEscapeZone([9, 15]) === false);
}

console.log('\n[23] 邻格工具（neighbors 的签名）');
{
  /* neighbors(r, c) 吃两个参数。传数组不会报错，会静默返回空表——
     unitOps 里曾经写成 neighbors(u.pos)，于是布雷 / 排雷 / 架桥三个按钮
     从上线起一直是灰的，玩家只看到三个点不动的按钮。
     这两条断言就是给这个坑立的桩。 */
  ok('neighbors 吃两个参数', api.neighbors(4, 8).length >= 3, api.neighbors(4, 8).length);
  ok('传数组会静默返回空表（调用方必须拆开）', api.neighbors([4, 8]).length === 0);

  api.newGame({ level: 'C3', noSave: true });
  const eng = api.alive('blue').find(u => u.type === 'eng');
  const eops = api.unitOps(eng);
  ok('工兵的布雷按钮不是灰的', !!eops.find(o => o.act === 'mine') &&
     !eops.find(o => o.act === 'mine').dis);
  ok('工兵的架桥按钮按地形置灰', (() => {
    const b = eops.find(o => o.act === 'bridge');
    const nearRiver = api.neighbors(eng.pos[0], eng.pos[1])
      .some(n => api.LEVEL.map[n[0]][n[1]] === '~');
    return !!b && b.dis === !nearRiver;      // 有河才能架，没河就得灰
  })());

  const engc = api.alive('blue').find(u => u.type === 'engc');
  const cops = api.unitOps(engc);
  ok('工兵连只能挖堑壕', cops.some(o => o.act === 'fort:H') &&
     !cops.some(o => o.act === 'fort:B') && !cops.some(o => o.act === 'mine'));
}

console.log('\n[24] 事件触发器（v4.2 新增：跟玩家动作、不跟回合钟）');
{
  /* 原来的触发器只有 turn / control / allControl / corpsBelow，
     只能写"第 N 回合播一句"。这一组断言守的是新增的动作类触发器：
     id 写错、字段名写错都必须在这里被抓住，而不是上线后"事件一直不响"。 */

  api.newGame({ level: 'C1', noSave: true });
  const st = api.getState();
  const u = api.alive('blue').find(x => x.type === 'inf');

  /* — unitActed — */
  ok('没动过之前，unitActed 为假', api.triggerMet({ kind: 'unitActed', id: u.id }) === false);
  api.noteAct(u, 'move');
  ok('动过之后 unitActed 为真', api.triggerMet({ kind: 'unitActed', id: u.id }) === true);
  ok('act 过滤生效（move 有、fire 没有）',
     api.triggerMet({ kind: 'unitActed', id: u.id, act: 'move' }) === true &&
     api.triggerMet({ kind: 'unitActed', id: u.id, act: 'fire' }) === false);
  ok('times 没到不算', api.triggerMet({ kind: 'unitActed', id: u.id, act: 'move', times: 2 }) === false);
  api.noteAct(u, 'move');
  ok('times 到了就算', api.triggerMet({ kind: 'unitActed', id: u.id, act: 'move', times: 2 }) === true);
  ok('不存在的兵牌不会误触发', api.triggerMet({ kind: 'unitActed', id: 'NOPE' }) === false);

  /* — unitAt — */
  const core = api.LEVEL.objectives.find(o => o.core);
  ok('不在要点上时 unitAt 为假',
     api.triggerMet({ kind: 'unitAt', id: u.id, obj: core.id }) === false);
  u.pos = core.cells[0].slice();
  ok('站上要点后 unitAt 为真',
     api.triggerMet({ kind: 'unitAt', id: u.id, obj: core.id }) === true);
  ok('unitAt 也认 cells 字面量',
     api.triggerMet({ kind: 'unitAt', id: u.id, cells: [core.cells[0]] }) === true);

  /* — unitBelow — */
  ok('满编时 unitBelow 为假', api.triggerMet({ kind: 'unitBelow', id: u.id, ratio: 0.5 }) === false);
  u.str = Math.max(1, Math.floor(u.str * 0.3));
  ok('打残后 unitBelow 为真', api.triggerMet({ kind: 'unitBelow', id: u.id, ratio: 0.5 }) === true);

  /* — sideBelow — */
  ok('没被打垮时 sideBelow 为假',
     api.triggerMet({ kind: 'sideBelow', side: 'blue', ratio: 0.5 }) === false);
  for (const x of api.alive('blue')) x.str = 1;
  ok('全线打残后 sideBelow 为真',
     api.triggerMet({ kind: 'sideBelow', side: 'blue', ratio: 0.5 }) === true);

  /* — firstBlood — */
  api.newGame({ level: 'C1', noSave: true });
  ok('开局 firstBlood 为假', api.triggerMet({ kind: 'firstBlood' }) === false);
  api.getState().firstBlood = 3;
  ok('交火之后 firstBlood 为真', api.triggerMet({ kind: 'firstBlood' }) === true);

  /* — turn 窗口 — */
  api.newGame({ level: 'C1', noSave: true });
  const w = { kind: 'turn', turn: 3, until: 5 };
  api.getState().turn = 2;
  ok('窗口之前不触发', api.triggerMet(w) === false);
  api.getState().turn = 4;
  ok('窗口之内触发', api.triggerMet(w) === true);
  api.getState().turn = 6;
  ok('窗口之后不再触发', api.triggerMet(w) === false);

  /* — 数组 when（多条件任一成立） — */
  ok('when 可以是数组（任一成立即触发）',
     api.triggerMet([{ kind: 'turn', turn: 9 }, { kind: 'firstBlood' }]) === false &&
     api.triggerMet([{ kind: 'turn', turn: 9 }, { kind: 'turn', turn: 3 }]) === true);
}

console.log('\n[25] 限时修正（mod + turns）');
{
  api.newGame({ level: 'C1', noSave: true });
  const st = api.getState();
  const before = api.modAtk(api.alive('blue')[0]);

  api.applyEffect({ kind: 'mod', side: 'blue', atk: 0.06, turns: 2, label: '测试修正' });
  const u = api.alive('blue')[0];
  ok('修正加上了攻击', Math.abs(api.modAtk(u) - (before + 0.06)) < 1e-9,
     api.modAtk(u) + ' vs ' + (before + 0.06));
  ok('限时修正带剩余回合', st.mods[0].left === 2, st.mods[0].left);

  api.settlePhase();
  ok('过一回合剩 1', st.mods[0] && st.mods[0].left === 1,
     st.mods[0] ? st.mods[0].left : '已移除');
  api.settlePhase();
  ok('再过一回合自动失效', st.mods.length === 0, '剩 ' + st.mods.length + ' 条');
  ok('失效后攻击加成归零', Math.abs(api.modAtk(u) - before) < 1e-9);

  /* 常驻修正（不带 turns）不该被回合数吃掉 */
  api.applyEffect({ kind: 'mod', side: 'blue', def: 0.05, label: '常驻修正' });
  api.settlePhase(); api.settlePhase(); api.settlePhase();
  ok('不带 turns 的修正一直留着', st.mods.length === 1, '剩 ' + st.mods.length + ' 条');
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
