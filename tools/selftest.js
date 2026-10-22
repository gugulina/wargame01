/* 机制自测：控制权 / 事件触发器 / 野战工事
   用法：node tools/selftest.js [game/campaign.html]
   任一断言失败即以非零码退出，方便接入改动后的回归。 */
const path = require('path');
const { loadGame } = require('./load');

const file = process.argv[2] && !process.argv[2].startsWith('-')
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'game', 'campaign.html');

const { api } = loadGame(file);
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
  const arm = api.alive('red').find(u => u.type === 'arm');
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
  const arm = api.alive('blue').find(u => u.type === 'arm');
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
  ok('ARM_FIRE 含坦克与自行火炮', api.ARM_FIRE.includes('arm') && api.ARM_FIRE.includes('spa'));
}

/* ───────── 五、直瞄火炮 ───────── */
console.log('\n[5] 直瞄火炮');
{
  api.newGame();
  ok('旅炮兵营可直瞄', api.minRange({ type: 'art' }) === 1);
  ok('自行火炮连可直瞄', api.minRange({ type: 'sha' }) === 1);
  ok('师自行火炮营可直瞄', api.minRange({ type: 'spa' }) === 1);
  ok('师重炮营不能直瞄', api.minRange({ type: 'hr' }) === 2);

  const art = { type: 'art', rng: 2 };
  const hr = { type: 'hr', rng: 3 };
  const inf = { type: 'gdn', rng: 1 };
  ok('步兵贴脸炮兵 → 炮兵可反击', api.canCounter(inf, art) === true);
  ok('步兵贴脸重炮 → 重炮无法反击', api.canCounter(inf, hr) === false);

  // 相邻目标进入射程
  api.newGame();
  const a = api.alive('blue').find(u => u.type === 'art');
  const t = api.alive('red').find(u => api.canCapture(u));
  api.getState().units.forEach(u => { if (u !== a && u.side === 'red') u.pos = [0, 19]; });
  t.pos = api.neighbors(a.pos[0], a.pos[1])[0];
  ok('相邻敌军进入炮兵目标列表', api.targetsFor(a, api.getState().fields).includes(t));

  // 直瞄炮的反击火力减半
  api.newGame();
  const st2 = api.getState();
  const inf2 = api.alive('blue').find(u => u.type === 'gdn');
  const rArt = api.alive('red').find(u => u.type === 'art');
  rArt.pos = [inf2.pos[0], inf2.pos[1] + 1];
  const pvArt = api.previewAttack(inf2, rArt, st2.fields);
  ok('打直瞄炮 → 可反击但火力减半', pvArt.counter === true && pvArt.counterSoft === true,
     pvArt.counter + '/' + pvArt.counterSoft);
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
  const a = api.alive('blue').find(u => u.type === 'arm');
  const d = api.alive('red').find(u => api.canCapture(u));
  d.pos = api.neighbors(a.pos[0], a.pos[1])[0];
  api.doAttack(a, d);
  ok('攻击触发音效', FX.stat.sfx >= 1, 'sfx=' + FX.stat.sfx);
  ok('攻击触发震屏', FX.stat.shake >= 1, 'shake=' + FX.stat.shake);
  ok('攻击产生伤害飘字', FX.stat.pop >= 1, 'pop=' + FX.stat.pop);

  /* 歼灭在 removeUnit 里统一埋点，任何死亡都要走到 */
  api.newGame();
  FX.reset();
  const a2 = api.alive('blue').find(u => u.type === 'arm');
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
  const a3 = api.alive('blue').find(u => u.type === 'arm');
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

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
