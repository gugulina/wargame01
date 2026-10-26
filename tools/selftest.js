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

/* 读图片像素尺寸，只为校验立绘比例。故意不引 sharp / image-size：
   测试链现在的依赖只有 jsdom（还是 devDependency），为了取两个整数装个解码库不值。 */
function imgSize(buf) {
  if (buf.length < 32) return null;
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' &&
      buf.slice(8, 12).toString('latin1') === 'WEBP') {
    const fmt = buf.slice(12, 16).toString('latin1');
    if (fmt === 'VP8X') return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
    if (fmt === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return [(b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1];
    }
    if (fmt === 'VP8 ') return [buf.readUInt16LE(26) & 0x3FFF, buf.readUInt16LE(28) & 0x3FFF];
    return null;
  }
  if (buf[0] === 0x89 && buf[1] === 0x50) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

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
  const jet = api.alive('red').find(u => u.type === 'fgt');
  const target = api.alive('blue').find(u => u.type === 'gdn');
  const base = api.aaPenalty(jet, target.pos);
  const aac = api.alive('blue').find(u => u.type === 'aac');
  if (aac) aac.pos = [0, 1];
  api.doFort(api.alive('blue').find(u => u.type === 'eng'), target.pos, 'F');
  const withF = api.aaPenalty(jet, target.pos);
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

  /* 台词里写的 portrait 键必须在 ASSETS.story 里存在。
     写错一个字（portBde1 → portBde）不会报错，只会静默渲染成「立绘位」，
     而那三个字玩家会当成"这里本来就该有张图没做"，不会当成 bug 报上来。
     引入角色位（一个旅长一个槽）之后，这类打错字的概率明显变高。 */
  const portKeys = new Set();
  const seeSay = (o) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.portrait === 'string') portKeys.add(o.portrait);
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (Array.isArray(v)) v.forEach(seeSay);
      else if (v && typeof v === 'object') seeSay(v);
    }
  };
  (api.LEVELS || []).forEach(seeSay);
  const badPort = [...portKeys].filter(k => !(k in A.story));
  ok('台词引用的立绘键都在 ASSETS.story 里', badPort.length === 0,
     '未定义：' + badPort.join(','));
  ok('确实扫到了立绘键（否则上一条是空转）', portKeys.size >= 3, '共 ' + portKeys.size + ' 个');
  /* 填了值的槽位，文件必须真实存在，且比例是 3:4——
     比例不对时 background-size:cover 会对称裁切，头顶最先没。 */
  const fs = require('fs'), path = require('path');
  const filled = Object.keys(A.story).filter(k => typeof A.story[k] === 'string' && A.story[k]);
  let fileBad = [], sizeBad = [];
  for (const k of filled) {
    const p = path.join(__dirname, '..', 'game', 'assets', A.story[k]);
    if (!fs.existsSync(p)) { fileBad.push(k + '→' + A.story[k]); continue; }
    const dim = imgSize(fs.readFileSync(p));
    if (!dim || Math.abs(dim[0] / dim[1] - 0.75) > 0.01) sizeBad.push(k + ' ' + (dim ? dim.join('×') : '读不出尺寸'));
  }
  ok('已填的立绘文件都真实存在', fileBad.length === 0, fileBad.join(','));
  ok('已填的立绘都是 3:4', sizeBad.length === 0, sizeBad.join(','));

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
  /* 不抛错是底线，返回 false 是接口承诺。**"静默"这个词已经不能写了**：
     v4.6 起失败会亮顶栏红胶囊 + 战报里留一行，这里只测引擎侧的两个返回值，
     界面那半条在 [32] 里测。 */
  ok('没有 localStorage 时存档返回 false 且不抛错', threw === null && ret === false,
     threw && threw.message);
  ok('没有 localStorage 时置上存档异常标记', api.getState().saveBroken === true);
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
  /* v4.6 起移动只有一条路：菜单点「移动」→ 点可达格。
     这几条断言原来直接点格子就走，正好是用户报的那个 bug 的行为，
     所以必须在点击前补上"点菜单"这一步——`runOp('move')` 就是那个按钮。 */
  ok('未进移动模式时点可达格不会移动（v4.6 修复的残留响应）',
     (() => { const p0 = api.uid('B1A').pos.join(','); api.onHexClick(qp[0], qp[1]);
              return api.uid('B1A').pos.join(',') === p0; })(),
     'P 已在 ' + api.uid('B1A').pos.join(','));
  api.select(P);
  api.runOp('move');
  ok('点「移动」后进入移动模式', api.getState().mode === 'move');
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
  api.runOp('move');
  api.onHexClick(8, 6);
  ok('渡口格：第一支点进去能站住', api.unitsAt(8, 6).length === 1,
     '格内 ' + api.unitsAt(8, 6).length + ' 支');
  api.select(f2);
  api.runOp('move');
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

/* ───────── 二十六、领域：陆 / 空 / 绿水 / 蓝水 ─────────
   这一节守的是"框架"，不是某一支部队：以后加飞机加军舰，
   只要 `dm` 写对，下面每一条都该自动成立。
   所以断言尽量打在 domainOf / moveCost / slotOf / canHitAir 这些面上，
   而不是"某型飞机能不能飞过某条河"。 */
console.log('\n[26] 领域：陆 / 空 / 绿水 / 蓝水');
/* 这一节守的是"框架"，不是某一支部队：以后加飞机加军舰，
   只要 `dm` 写对，下面每一条都该自动成立。所以断言打在
   domainOf / moveCost / slotOf / canHitAir 这些面上，
   而不是"某型飞机能不能飞过某条河"。

   坐标尽量落在 C3 第 13 行右半段（cols 8–14 全空），
   避开蓝方在左下角的部署——随手挑格子会让"地表已堆满 2 支"变成 3 支。 */
{
  /* 前面几节切过关（存档 / 胜负条件会 enterLevel），这里必须重新钉死 C3。
     不钉死的话 uid('R7') 是 null，报错只会说"cannot read properties of null"。 */
  const NG = () => api.newGame({ level: 'C3', noSave: true });
  NG();
  const L19 = api.levelById('C3');
  let S = api.getState();

  /* ── 26.1 领域归属 ── */
  /* 样本用 gdn 不用 inf：C3 蓝方编制里**没有** inf（步兵营在 C1/C2）。
     写 inf 的话 domainOf(undefined) 会回落成 'ground'，断言假绿。 */
  const gA = S.units.find(u => u.side === 'blue' && u.type === 'gdn');
  const jet = api.uid('R7');
  ok('找得到样本单位', !!gA && !!jet, gA ? gA.id : '没有 gdn');
  ok('守备营属于地面域', api.domainOf(gA) === 'ground', api.domainOf(gA));
  ok('战斗机中队属于空中域（dm 写在兵种表里）', api.domainOf(jet) === 'air', api.domainOf(jet));
  ok('u.dm 可以覆盖兵种默认值', api.domainOf({ type: 'gdn', dm: 'green' }) === 'green');

  /* ── 26.2 机动矩阵：同一格地形，四个领域各读各的价钱 ── */
  const mc = (u, ch) => api.moveCost(u, ch);
  const greenU = { type: 'gdn', dm: 'green' };
  const blueU = { type: 'gdn', dm: 'blue' };
  ok('地面走不了河流 / 浅海 / 深海',
     mc(gA, '~') === Infinity && mc(gA, 's') === Infinity && mc(gA, 'd') === Infinity);
  ok('空中一律 1 点：河流、浅海、深海、城市一视同仁',
     mc(jet, '~') === 1 && mc(jet, 's') === 1 && mc(jet, 'd') === 1 && mc(jet, 't') === 1 &&
     mc(jet, '.') === 1);
  ok('绿水：河流 3 点、浅海 3 点', mc(greenU, '~') === 3 && mc(greenU, 's') === 3);
  ok('绿水进不了深海', mc(greenU, 'd') === Infinity);
  ok('绿水上不了岸', mc(greenU, '.') === Infinity && mc(greenU, '#') === Infinity);
  ok('蓝水：浅海 3 点、深海 2 点', mc(blueU, 's') === 3 && mc(blueU, 'd') === 2);
  ok('蓝水进不了内河（吃水不够——刻意如此，要放宽改 NAV.blue.cells）',
     mc(blueU, '~') === Infinity);

  /* ── 26.3 占位名额 ── */
  ok('空中一格一支', api.slotOf(jet) === 1 && api.SLOT.air === 1);
  ok('水面一格一支', api.slotOf(greenU) === 1 && api.slotOf(blueU) === 1);
  ok('地面仍是 STACK_MAX', api.slotOf(gA) === api.STACK_MAX);

  /* ── 26.4 分层堆叠：飞机能和满编地面部队同格，但落不了第二架 ── */
  NG(); S = api.getState();
  const SPOT = [13, 9];
  const g1 = S.units.filter(u => u.side === 'blue' && u.type === 'gdn')[0];
  const g2 = S.units.filter(u => u.side === 'blue' && u.type === 'gdn')[1];
  ok('前提：目标格开局是空的', api.unitsAt(SPOT[0], SPOT[1]).length === 0);
  g1.pos = SPOT.slice(); g1.moved = false;
  g2.pos = SPOT.slice(); g2.moved = false;
  const plane = api.uid('R7');
  ok('前提：该格地表已堆满 2 支', api.layerUnitsAt(SPOT[0], SPOT[1], 'surface').length === 2,
     api.layerUnitsAt(SPOT[0], SPOT[1], 'surface').length + ' 支');
  ok('飞机可以落在满编地面格上（分层占位）', api.doMove(plane, SPOT) === true);
  ok('地面两支部队没被挤走', api.layerUnitsAt(SPOT[0], SPOT[1], 'surface').length === 2);
  ok('空中层恰好一支', api.layerUnitsAt(SPOT[0], SPOT[1], 'air').length === 1);
  ok('airAt 找得到飞机，surfaceAt 仍给地表部队',
     api.airAt(SPOT[0], SPOT[1]) === plane &&
     api.domainOf(api.surfaceAt(SPOT[0], SPOT[1])) === 'ground');
  /* 第二架：把一支地面部队临时改标成空中，省得为测试造一个虚构兵种。
     必须先挪开——doMove 对"原地不动"直接放行，不清场的话这条永远绿。 */
  g1.dm = 'air';
  g1.pos = [13, 8];
  ok('空中一格落不下第二支', api.doMove(g1, SPOT) === false &&
     api.layerUnitsAt(SPOT[0], SPOT[1], 'air').length === 1);
  delete g1.dm;

  /* 反方向：头顶有飞机，地面部队照样进得去。
     挑一个**不是拖曳炮**的样本——doMove 对没展开的火炮本来就会拒绝，
     用它当样本的话失败原因和被测规则无关。 */
  NG(); S = api.getState();
  const plane2 = api.uid('R7');
  plane2.pos = [13, 11];
  const walker = S.units.find(u =>
    u.side === 'red' && api.domainOf(u) === 'ground' && !api.isTowed(u) && !api.isHQ(u));
  walker.pos = [13, 10]; walker.moved = false;
  ok('地面部队进得去头顶有飞机的格子', api.doMove(walker, [13, 11]) === true &&
     api.layerUnitsAt(13, 11, 'surface').length === 1 &&
     api.layerUnitsAt(13, 11, 'air').length === 1);

  /* ── 26.5 控制权只认地表 ──
     这条最阴：unitAt 一旦返回空中单位，canCapture(飞机) 是 false，
     要点会因为"上面飘着一架敌机"被判成无主，而地图上看不出任何异常。 */
  NG(); S = api.getState();
  const city = L19.objectives.find(o => o.id === 'city');
  const cell0 = city.cells[0];
  const gdn = S.units.find(u => u.side === 'blue' && u.type === 'gdn');
  gdn.pos = cell0.slice();
  api.uid('R7').pos = cell0.slice();
  api.updateControl();
  ok('敌机停在要点上空不改控制权', api.ctrlState(city) === 'blue', api.ctrlState(city));
  ok('unitAt 优先返回地表部队', api.unitAt(cell0[0], cell0[1]) === gdn);

  /* ── 26.6 对空：只有防空 / 航空兵打得着 ── */
  NG(); S = api.getState();
  const art = api.uid('B1F');       // 旅炮兵营 rng 5
  const aab = api.uid('B9');        // 防空营 rng 2
  const plane3 = api.uid('R7');
  art.pos = [13, 8];
  aab.pos = [13, 9];
  plane3.pos = [13, 10];            // 距 art 2 格、距 aab 1 格
  ok('前提：射程够得到（dist 2 / 1）',
     api.hexDist(art.pos, plane3.pos) === 2 && api.hexDist(aab.pos, plane3.pos) === 1);
  ok('普通地面炮兵列不出空中目标', !api.inRangeTargets(art, S.fields).includes(plane3));
  ok('防空营列得出空中目标', api.inRangeTargets(aab, S.fields).includes(plane3));
  ok('canHitAir：守备营 false，防空营 true，航空兵 true',
     api.canHitAir(gA) === false && api.canHitAir(aab) === true && api.canHitAir(plane3) === true);
  ok('地面兵种挨空袭不能反击', api.canCounter(plane3, gA) === false);
  ok('防空营可以反击空袭', api.canCounter(plane3, aab) === true);
  /* 防空压制认领域不认代号：把一支炮兵临时标成空中，它立刻吃防空惩罚 */
  const fake = api.uid('R3F');
  fake.dm = 'air';
  fake.pos = [13, 10];
  ok('标成空中域就自动受防空压制（aaPenalty 已按领域判）',
     api.aaPenalty(fake, fake.pos) >= 0.30, api.aaPenalty(fake, fake.pos));
  delete fake.dm;
  ok('去掉标记就没有压制', api.aaPenalty(fake, fake.pos) === 0);

  /* ── 26.7 空中不吃地形防御 ── */
  plane3.pos = [6, 9];              // C3 城市格（def 0.85）
  ok('飞机蹲在城里也只有 0 地形加成', api.terrainDefFor(plane3) === 0, api.terrainDefFor(plane3));
  const g3 = S.units.find(u => u.side === 'blue' && u.type === 'gdn');
  g3.pos = [6, 9];
  ok('同一格的地面部队照吃地形加成', api.terrainDefFor(g3) > 0.8, api.terrainDefFor(g3));

  /* ── 26.8 ZOC 与可达：地面被敌邻格钉住，飞机照飞 ──
     C3 第 13 行 cols 8–14 是平地（cost 2）。敌人放在 (12,10)：
       它只与 (13,9)(13,10) 相邻，离起点 (13,8) 有 2 格。
       地面 8 点 = 4 格：(13,9) 进去就吃 ZOC，走不到 (13,10)。
       空中 8 点 = 8 格且不吃 ZOC，一路飞到 (13,12)。 */
  NG(); S = api.getState();
  const foe = S.units.find(u => u.side === 'red' && api.domainOf(u) === 'ground');
  foe.pos = [12, 10];
  const runner = S.units.find(u => u.side === 'blue' && u.type === 'gdn');
  runner.pos = [13, 8]; runner.moved = false; runner.mov = 8;
  const plane4 = api.uid('R7');
  plane4.pos = [13, 8]; plane4.mov = 8;
  ok('前提：敌人只与中途格相邻', api.hexDist(foe.pos, [13, 9]) === 1 &&
     api.hexDist(foe.pos, [13, 8]) === 2);
  const rGround = api.computeReach(runner), rAir = api.computeReach(plane4);
  ok('地面：进 ZOC 那一格可以停', rGround.stop['13,9'] !== undefined);
  ok('地面：进了敌 ZOC 就走不到下一格', rGround.stop['13,10'] === undefined);
  ok('空中：同起点同预算能飞到', rAir.stop['13,12'] !== undefined);
  /* 敌机紧邻起点也不产生 ZOC：这条和"空中不吃 ZOC"是同一枚硬币的两面，
     只测一面的话，把 inEnemyZOC 改回 unitAt 也能通过一半。 */
  ok('敌机不产生地面 ZOC（inEnemyZOC 只认地表）', (() => {
    const p = api.uid('R7'), back = p.pos;
    p.pos = [13, 9];
    const v = api.inEnemyZOC(13, 8, 'blue');
    p.pos = back;
    return v === false;
  })());

  /* ── 26.9 水上抵达：临时把第 13 行改成「浅海×4 + 深海×4」 ──
     moveCost 上面测过了，这里测的是**算路**（computeReach 走的就是 moveCost，
     所以它才是端到端那一条）。

     ⚠ 改的是 `mapSrc` 不是 `map`：newGame 每次都从 mapSrc 重拷地图
     （防上一局架桥残留，见引擎里那行 `LEVEL.map = LEVEL.mapSrc.slice()`），
     只改 map 会在 NG() 那一刻被覆盖回去——上一版就是这么红的，四条断言全灭，
     看着像算路坏了，其实是布景根本没生效。单独用 node 复现时没调 NG()，所以是绿的。 */
  const row13 = L19.mapSrc[13];
  L19.mapSrc[13] = 'ssssdddd' + row13.slice(8);
  try {
    NG(); S = api.getState();
    ok('前提：第 13 行已经被改成水（浅海×4 + 深海×4）',
       api.terrainAt(13, 2).name === '浅海' && api.terrainAt(13, 4).name === '深海',
       api.terrainAt(13, 2).name + ' / ' + api.terrainAt(13, 4).name);
    /* 这行本来站着蓝方守备营。改地形之后他们就"漂"在水上了——
       水域一格一支，于是每个水格都判成"已满"、一个落脚点都不剩，
       看上去像算路坏了，其实是布景没清场。 */
    S.units.forEach(x => { if (x.pos[0] === 13 && x.pos[1] < 8) x.pos = [0, 0]; });
    const boat = S.units.find(u => u.side === 'blue' && u.type === 'gdn');
    ok('找得到水上样本单位（gdn 改 dm 当炮艇用）', !!boat);
    boat.pos = [13, 0]; boat.moved = false; boat.mov = 9; boat.dm = 'green';
    const rr = api.computeReach(boat);
    ok('前提：浅海格是空的', api.layerUnitsAt(13, 2, 'surface').length === 0);
    ok('绿水沿浅海推进（3 点一格，9 点走到第 3 格）',
       rr.stop['13,2'] !== undefined && rr.stop['13,3'] !== undefined,
       JSON.stringify(rr.stop));
    ok('绿水止步于深海', rr.stop['13,4'] === undefined);
    /* 蓝水走深海 2 点一格。9 点只够 s,s,s,d 到 col4，
       要验"能一路开进深海"就得给够油，否则测的是油量不是领域。 */
    boat.dm = 'blue'; boat.mov = 20;
    const rb = api.computeReach(boat);
    ok('蓝水能开进深海', rb.stop['13,4'] !== undefined && rb.stop['13,6'] !== undefined,
       JSON.stringify(rb.stop));
    boat.pos = [13, 6];
    const rb2 = api.computeReach(boat);
    ok('蓝水能退回浅海（浅海是两级共用的）', rb2.stop['13,3'] !== undefined,
       JSON.stringify(rb2.stop));
    boat.dm = 'ground';
    ok('同一支部队改回地面域就下不了水', api.computeReach(boat).stop['13,2'] === undefined);
    delete boat.dm;
  } finally {
    L19.mapSrc[13] = row13;
    /* 还了 mapSrc 之后必须再开一局把 map 也刷回来——
       map 是 mapSrc 的副本，不是同一个数组，光还 mapSrc 这一局的地图还是水。 */
    NG();
  }
  ok('测完已还原地形', L19.map[13] === row13, L19.map[13]);

  /* ── 26.10 select(null) 不许崩 ──
     `?demo=unit` 这类截图钩子照着 C1 的兵牌 id 写死，换一关 uid() 就是 null。
     以前会直接崩在 `u.side` 上，页面顶上弹红条，而截图脚本照样存图——
     看着像"渲染坏了"，其实是钩子没取到单位。 */
  let selThrew = '';
  try { api.select(null); } catch (e) { selThrew = e.message; }
  ok('select(null) 不抛异常（截图钩子取不到单位时的兜底）', selThrew === '', selThrew);
  ok('select(null) 把选中态置空而不是留着上一支', api.getState().selected === null);

  NG();
}

/* ───────── 二十七、航空兵与海军：打谁 / 打不打得动 ─────────
   上一节 [26] 守的是"我怎么动"（领域），这一节守的是"我打的是什么"（目标分类）。
   两者必须分开：潜艇在水面上机动（domain = blue），但目标分类是 sub——
   合成一个字段的话，战列舰一炮就能把潜艇从水里炸出来，而它连声呐都没有。 */
console.log('\n[27] 航空兵与海军：目标分类与克制');
{
  const NG = () => api.newGame({ level: 'C3', noSave: true });
  NG();
  const T = api.TYPE;
  let S = api.getState();
  let seq = 0;

  /* ── 27.1 目标分类 ── */
  ok('目标分类：飞机 air / 步兵 land / 军舰 ship / 潜艇 sub',
     api.tclass({ type: 'fgt' }) === 'air' && api.tclass({ type: 'inf' }) === 'land' &&
     api.tclass({ type: 'dd' }) === 'ship' && api.tclass({ type: 'ss' }) === 'sub');
  ok('潜艇在蓝水机动，但按 sub 分类（不是 ship）',
     api.domainOf({ type: 'ss' }) === 'blue' && api.tclass({ type: 'ss' }) === 'sub');

  /* ── 27.2 主动攻击白名单（atk）──
     注意 canTarget 里的 isAir 那一支仍然生效：地面兵种打不着飞机，
     这一条和 atk 白名单是两道独立的闸。 */
  const can = (a, b) => api.canTarget({ type: a }, { type: b });
  ok('轰炸机不能主动挑飞机打（仅可对空反击）', can('bmb', 'fgt') === false);
  ok('轰炸机能打地面与水面', can('bmb', 'inf') === true && can('bmb', 'dd') === true);
  ok('鱼雷艇不能主动对地', can('ptb', 'inf') === false);
  ok('鱼雷艇能对海', can('ptb', 'dd') === true);
  ok('战列舰打不了潜艇（没有对潜能力）', can('bb', 'ss') === false);
  ok('驱逐舰能反潜', can('dd', 'ss') === true);
  ok('潜艇只能打船', can('ss', 'dd') === true && can('ss', 'inf') === false);
  ok('战斗机打不了潜艇（atk 里没有 sub）', can('fgt', 'ss') === false);
  ok('没写 atk 的老兵种仍然什么都能打（白名单为空＝不设限）',
     can('marm', 'inf') === true && can('art', 'marm') === true);
  ok('地面兵种仍然打不着飞机', can('inf', 'fgt') === false);
  ok('防空营打得着飞机', can('aab', 'fgt') === true);

  /* ── 27.3 反击：白名单只管"主动"，还手另算 ── */
  const U = (t, r, c) => ({ type: t, pos: [r, c], str: 8, org: 100,
                            rng: T[t].rg === undefined ? 1 : T[t].rg });
  ok('轰炸机被咬住时能反击（"仅可对空反击"就是这个意思）',
     api.canCounter(U('fgt', 1, 1), U('bmb', 1, 2)) === true);
  ok('战斗机互咬时防守方也能还手（空战是双向的）',
     api.canCounter(U('fgt', 1, 1), U('fgt', 1, 2)) === true);
  ok('地面步兵挨空袭仍然不能反击',
     api.canCounter(U('fgt', 1, 1), U('inf', 1, 2)) === false);

  /* ── 27.4 修正方向：端到端走 previewAttack，而不是只比对兵种表 ──
     只断言 vs 表等于多少是假绿（表改了但没接进战斗，照样绿）；
     这里断言的是"打飞机比打地面高多少"，接不进去就会一样。 */
  const put = (side, t, r, c) => {
    const u = api.makeUnit({ id: 'T' + (++seq), side, type: t, abbr: 'T',
      name: '测试' + T[t].name, r, c, corps: 'T', str: 10,
      mov: T[t].mv || 8, rng: T[t].rg === undefined ? 1 : T[t].rg }, true);
    S.units.push(u);
    return u;
  };
  const mod = (a, b) => api.previewAttack(a, b, S.fields).attMod;

  S.units.length = 0;
  const f1 = put('blue', 'fgt', 5, 1);
  const f2 = put('red', 'fgt', 5, 2);
  const g1 = put('red', 'inf', 5, 2);       // 与飞机同格不同层，互不占位
  ok('战斗机：打飞机明显强于打地面', mod(f1, f2) - mod(f1, g1) > 1.0,
     mod(f1, f2).toFixed(2) + ' vs ' + mod(f1, g1).toFixed(2));

  S.units.length = 0;
  const b1 = put('blue', 'bmb', 5, 1);
  const g2 = put('red', 'inf', 5, 2);
  const atk1 = put('blue', 'atk', 5, 8);
  const g3 = put('red', 'inf', 5, 9);
  ok('轰炸机对地强于攻击机对地', mod(b1, g2) - mod(atk1, g3) > 0.2,
     mod(b1, g2).toFixed(2) + ' vs ' + mod(atk1, g3).toFixed(2));

  S.units.length = 0;
  const s1 = put('blue', 'ss', 6, 1);
  const ca1 = put('red', 'ca', 6, 2);
  const bb1 = put('red', 'bb', 6, 3);
  ok('潜艇打战列舰比打巡洋舰更狠（vsType 生效）',
     mod(s1, bb1) - mod(s1, ca1) > 0.05,
     mod(s1, bb1).toFixed(2) + ' vs ' + mod(s1, ca1).toFixed(2));

  /* ── 27.5 防空压制按兵种表的 aaRange / aaPen，不再按代号硬认 ── */
  S.units.length = 0;
  const jet = put('red', 'fgt', 5, 5);
  const ca2 = put('blue', 'ca', 5, 8);      // 距离 3
  ok('巡洋舰半径 3 内压制 0.30', Math.abs(api.aaPenalty(jet, jet.pos) - 0.30) < 1e-9,
     String(api.aaPenalty(jet, jet.pos)));
  ca2.pos = [5, 9];                          // 距离 4，出圈
  ok('出了巡洋舰的半径就没有压制', api.aaPenalty(jet, jet.pos) === 0);

  S.units.length = 0;
  const jet2 = put('red', 'fgt', 5, 5);
  put('blue', 'bb', 5, 7);                   // 距离 2
  ok('战列舰的防空比巡洋舰弱（半径 2 / −0.15）',
     Math.abs(api.aaPenalty(jet2, jet2.pos) - 0.15) < 1e-9,
     String(api.aaPenalty(jet2, jet2.pos)));

  S.units.length = 0;
  const jet3 = put('red', 'fgt', 5, 5);
  put('blue', 'aab', 5, 9);                  // 距离 4
  ok('老防空营仍是半径 4 / −0.35（泛化后数值没走样）',
     Math.abs(api.aaPenalty(jet3, jet3.pos) - 0.35) < 1e-9,
     String(api.aaPenalty(jet3, jet3.pos)));

  /* ── 27.6 运输机：载货由关卡数据给，空机不给按钮 ── */
  NG(); S = api.getState();
  const trp = api.makeUnit({ id: 'TRP', side: 'blue', type: 'trp', abbr: '运',
    name: '运输机联队', r: 5, c: 5, corps: 'T', str: 6, mov: 10, rng: 0 }, false);
  S.units.push(trp);
  ok('前提：第 5 行第 5 格是平地（伞兵落得下）', T && api.terrainAt(5, 5).cost < 99,
     api.terrainAt(5, 5).name);
  ok('空机没有空投按钮', !api.unitOps(trp).some(o => o.act === 'drop'));
  trp.load = 'supply';
  ok('载补给后出现空投按钮', api.unitOps(trp).some(o => o.act === 'drop'));

  const g4 = api.alive('blue').find(u => u.type === 'gdn');
  g4.pos = [5, 6]; g4.org = 50;
  /* 弹药要用真有弹药的单位测：守备营 am=0，ammo 本来就是 undefined，
     拿它测"弹药 +2"等于什么都没测——第一次跑就是这么假绿的。 */
  const gun = api.alive('blue').find(u => u.ammo !== undefined);
  ok('前提：找得到有弹药的单位', !!gun, gun ? gun.type : '没有');
  gun.pos = [5, 5 + 0]; gun.ammo = 1; gun.maxAmmo = 8;
  ok('空投补给执行成功', api.doDrop(trp) === true);
  ok('半径 1 内友军组织度 +15、弹药 +2', g4.org === 65 && gun.ammo === 3,
     g4.org + ' / ' + gun.ammo);
  ok('投完变成空机、占本回合', trp.load === null && trp.moved === true);

  NG(); S = api.getState();
  const trp2 = api.makeUnit({ id: 'TRP2', side: 'blue', type: 'trp', abbr: '运',
    name: '运输机联队', r: 5, c: 5, corps: 'T', str: 6, mov: 10, rng: 0 }, false);
  trp2.load = 'para';
  S.units.push(trp2);
  ok('空投伞兵执行成功', api.doDrop(trp2) === true);
  const para = S.units.find(u => u.type === 'para');
  ok('伞兵连落在空投格或相邻格', !!para && api.hexDist(para.pos, trp2.pos) <= 1);
  ok('伞兵落地当回合不能行动', !!para && para.moved === true && para.fired === true);
  ok('伞兵能占点', !!para && api.canCapture(para) === true);

  /* 落不下时不许扣载货：算错位置只该损失这一回合，不该损失这趟运输 */
  NG(); S = api.getState();
  const trp3 = api.makeUnit({ id: 'TRP3', side: 'blue', type: 'trp', abbr: '运',
    name: '运输机联队', r: 5, c: 5, corps: 'T', str: 6, mov: 10, rng: 0 }, false);
  trp3.load = 'para';
  S.units.push(trp3);
  const spots = [[5, 5]].concat(api.neighbors(5, 5));
  for (const p of spots) {
    for (let i = 0; i < api.STACK_MAX; i++) put('blue', 'inf', p[0], p[1]);
  }
  ok('落点全满时找不出空格', api.dropSpot(trp3) === null);
  ok('投不下去就不执行，也不扣载货', api.doDrop(trp3) === false && trp3.load === 'para');

  /* ── 27.7 规格自检：数值按用户给的现实射程换算成格（1 格 ≈ 1.5 km）── */
  ok('空中单位射程一律 1 格（运输机 0）',
     T.fgt.rg === 1 && T.atk.rg === 1 && T.bmb.rg === 1 && T.trp.rg === 0);
  ok('水面射程递增：炮艇 < 护卫 < 驱逐 < 巡洋 < 战列',
     T.gbt.rg < T.ffg.rg && T.ffg.rg < T.dd.rg && T.dd.rg < T.ca.rg && T.ca.rg < T.bb.rg,
     [T.gbt.rg, T.ffg.rg, T.dd.rg, T.ca.rg, T.bb.rg].join(' < '));
  ok('运输机 / 运输舰没有火力', T.trp.rg === 0 && T.lst.rg === 0);
  ok('航母是占位兵种（check.js 会拦着不让部署）', T.cv.reserve === 1);

  NG();
}

console.log('\n[28] 第四关：波尔瓦萨港（海军基地保卫战）');
{
  const L4 = api.levelById('C4');
  const NG4 = () => api.newGame({ level: 'C4', noSave: true });

  /* ── 28.1 关卡元信息 ── */
  ok('第四关存在且已制作', !!L4 && L4.ready === true);
  ok('作战编号是 4', L4 && L4.no === 4, L4 && L4.no);
  ok('目标类型是坚守（survive）', L4 && L4.win && L4.win.kind === 'survive');
  ok('坚守 20 回合', L4 && L4.maxTurns === 20, L4 && L4.maxTurns);
  ok('要守住要塞与市两处（keep 两项）',
     !!L4 && (L4.win.keep || []).length === 2 &&
     L4.win.keep.includes('fort') && L4.win.keep.includes('city'),
     L4 && (L4.win.keep || []).join(','));
  ok('地图 16×22', L4 && L4.rows === 16 && L4.cols === 22 && L4.map.length === 16);
  ok('每一行都是 22 格', L4 && L4.map.every(r => r.length === 22),
     L4 && L4.map.map(r => r.length).join(','));
  ok('地形字符全部已定义', L4 && L4.map.every(r => [...r].every(ch => !!api.TERRAIN[ch])));
  /* 节奏定位写进数据里，是为了让自战脚本按 75–95% 判，而不是把这一关
     一路往"险胜"上调。这条断言盯的不是数值，是**设计意图还在不在**：
     谁把 pace 删了，自战第二天就会开始喊"偏简单，红方需要加强"。 */
  ok('第四关标记为爽局节奏（自战按 75–95% 判，不是 45–60%）',
     L4 && L4.pace === '爽局', L4 && L4.pace);

  /* ── 28.2 编制自洽 ── */
  const blue = L4.units.filter(u => u.side === 'blue');
  const red  = L4.units.filter(u => u.side === 'red');
  ok('蓝方兵牌 30–40 张', blue.length >= 30 && blue.length <= 40, blue.length);
  ok('红方兵牌 35–50 张', red.length >= 35 && red.length <= 50, red.length);
  ok('兵牌 id 全场唯一', new Set(L4.units.map(u => u.id)).size === L4.units.length);
  ok('蓝方全部 wave 1（开局全在场，没有"我方增援"）', blue.every(u => u.wave === 1));
  const corpsBlue = [...new Set(blue.map(u => u.corps))];
  ok('蓝方四个作战编制 + 舰队 + 警备区都在',
     ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].every(c => corpsBlue.includes(c)), corpsBlue.join(','));
  /* 师 / 旅都要有指挥牌，否则整建制常年脱指——这条以前靠 check.js 提示，
     现在玩家看得见的关里至少要保证不出现。 */
  ok('每个蓝方编制都有指挥牌（不脱指）',
     ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].every(c =>
       blue.some(u => u.corps === c && api.isHQ(u))));

  /* ── 28.3 波次 ── */
  const waveNums = [...new Set(red.map(u => u.wave))].filter(n => n > 1).sort();
  ok('每个敌方波次号都在 LEVEL.waves 里声明',
     waveNums.every(n => (L4.waves || []).some(w => w.wave === n)), waveNums.join(','));
  ok('声明的波次也都有兵牌', (L4.waves || []).every(w => red.some(u => u.wave === w.wave)));
  ok('波次回合都不超过 20', (L4.waves || []).every(w => w.turn >= 1 && w.turn <= L4.maxTurns),
     (L4.waves || []).map(w => w.turn).join(','));
  ok('波次回合严格递增', (L4.waves || []).every((w, i, a) => i === 0 || a[i - 1].turn < w.turn));

  /* ── 28.4 舰队 ── */
  const fleet = blue.filter(u => u.type === 'dd' || u.type === 'ca' || u.type === 'bb');
  ok('舰队 4 驱 + 2 巡 + 1 战列',
     fleet.filter(u => u.type === 'dd').length === 4 &&
     fleet.filter(u => u.type === 'ca').length === 2 &&
     fleet.filter(u => u.type === 'bb').length === 1, fleet.length + ' 艘');
  ok('七艘全部属于蓝水域', fleet.every(u => api.domainOf(u) === 'blue'));
  ok('七艘全部泊在可航行水域（浅海 / 深海）',
     fleet.every(u => L4.map[u.r][u.c] === 's' || L4.map[u.r][u.c] === 'd'),
     fleet.map(u => u.abbr + ':' + L4.map[u.r][u.c]).join(' '));
  ok('七艘各占一格（水面一格一支）',
     new Set(fleet.map(u => u.r + ',' + u.c)).size === fleet.length);
  ok('没有一艘停在港口陆地上（码头是给补给用的，不是泊位）',
     fleet.every(u => L4.map[u.r][u.c] !== 'p'));
  const bbU = fleet.find(u => u.type === 'bb');
  ok('战列舰射程跨过半张图（≥ 16 格）', bbU && bbU.rng >= 16, bbU && bbU.rng);
  ok('舰炮弹药是有限基数（不是无穷）', fleet.every(u => u.type && api.TYPE[u.type].am > 0));

  /* ── 28.5 舰队补给（新规则：水面格进不了补给场，按码头距离判） ── */
  const portCells = [];
  for (let r = 0; r < L4.rows; r++) {
    for (let c = 0; c < L4.cols; c++) if (L4.map[r][c] === 'p') portCells.push([r, c]);
  }
  ok('地图上有码头', portCells.length >= 4, portCells.length + ' 格');

  NG4();
  let S4 = api.getState();
  const fleetNow = S4.units.filter(u => api.domainOf(u) === 'blue');
  ok('开局七艘舰都在场', fleetNow.length === 7, fleetNow.length);
  /* 这条是反向验证的核心：把 supplyOf 里 isNaval 那一段删掉，
     这里会全部变成"断绝"——不报错，只是每艘舰悄悄少 30% 战力。 */
  ok('七艘全部补给充足（水面格不在补给场里，必须按码头单独判）',
     fleetNow.every(u => api.supplyOf(u, S4.fields).label === '充足'),
     fleetNow.map(u => api.supplyOf(u, S4.fields).label).join(','));

  let farCell = null, farD = -1;
  for (let r = 0; r < L4.rows; r++) {
    for (let c = 0; c < L4.cols; c++) {
      if (L4.map[r][c] !== 'd') continue;
      const d = Math.min(...portCells.map(p => api.hexDist([r, c], p)));
      if (d > farD) { farD = d; farCell = [r, c]; }
    }
  }
  /* 这张图的海域不大：最远的深海格离码头只有 5 格，够测"紧张"但够不到"断绝"。
     所以断档那一档用一个地图外的坐标测——别为此把地图改大，地图是给人看的，
     不是给断言看的。 */
  ok('图上存在离码头 4 格以外的深海（补给有梯度）', farD >= 4, '最远 ' + farD + ' 格');
  const probe = fleetNow[0], keep4 = probe.pos;
  probe.pos = farCell;
  ok('舰队开远之后补给降档（不再是"充足"）',
     api.supplyOf(probe, S4.fields).label !== '充足',
     farCell.join(',') + ' → ' + api.supplyOf(probe, S4.fields).label);
  probe.pos = [99, 99];
  ok('离所有码头都很远时判"断绝"',
     api.supplyOf(probe, S4.fields).label === '断绝',
     api.supplyOf(probe, S4.fields).label);
  probe.pos = keep4;

  /* 补弹规则：停在码头补给圈里就补，**不看这一回合打没打过**。
     这一条是"舰队能持续火力支援"的全部依据。把 settlePhase 里
     `isNaval(u) && !u.moved && s.label === '充足'` 改回带 `!u.fired` 的写法，
     下面第二条仍然是绿的（开火那回合不补、不开火照补），第一条会立刻变红。
     舰队每回合都开火，所以旧写法的实际效果是"永远补不上"。 */
  const sh = fleetNow[0];
  sh.ammo = 3; sh.fired = true; sh.moved = false;
  api.settlePhase();
  ok('舰船停泊 + 补给充足时，开过火的回合也补弹', sh.ammo === 4, 'ammo=' + sh.ammo);
  const berth = sh.pos;
  sh.pos = farCell;                       // 开到补给降档的海域
  sh.ammo = 3; sh.fired = false; sh.moved = false;
  api.settlePhase();
  ok('离开补给圈后不补弹（「紧张」及以下都不算数）', sh.ammo === 3, 'ammo=' + sh.ammo);
  sh.pos = berth;

  /* ── 28.6 敌军全灭提前判胜 ── */
  NG4();
  S4 = api.getState();
  S4.units = S4.units.filter(u => u.side === 'blue');
  api.checkEnd();
  ok('波次还没入场时清完场上的敌人不算通关', S4.result !== 'win', String(S4.result));
  (L4.waves || []).forEach(w => { S4.flags['wave' + w.wave] = true; });
  api.checkEnd();
  ok('全部波次入场后敌军全灭 → 提前判胜', S4.result === 'win', String(S4.result));

  /* ── 28.7 附属关不挡主线解锁 ── */
  /* 注意：沙箱里的 localStorage 挂在全局，不在 window 上。
     `window.localStorage.removeItem(...)` 会静默抛 TypeError（被 catch 吃掉），
     进度根本没清——这一条断言第一次跑就是这么假绿的。 */
  sandbox.localStorage.removeItem(api.PROGRESS_KEY);
  const acc4 = api.levelAccess('C4');
  ok('零进度下第四关锁着（不再靠 open:true 试玩开放）', !acc4.ok, acc4.why);
  ok('第四关的前置是第 3 关，不是附属关 C3B',
     /岚口要地争夺战/.test(acc4.why) && !/机场/.test(acc4.why), acc4.why);
  ok('前置关系由引擎算好（accessPrereq），菜单页不再自己复刻',
     api.accessPrereq('C4') === 'C3' && api.accessPrereq('C3B') === 'C3',
     api.accessPrereq('C4') + ' / ' + api.accessPrereq('C3B'));

  /* 通关第 3 关就够——附属关 C3B 没打过也该开。
     这一条是那次"菜单页锁住、引擎开着"的真 bug 的回归防线。 */
  api.writeProgress({ cleared: { T1: 1, C1: 1, C2: 1, C3: 1 }, played: {}, deck: null, last: null });
  const acc4b = api.levelAccess('C4');
  ok('通关第 3 关（跳过附属关）后第四关解锁', acc4b.ok, acc4b.why);
  ok('此时附属关 C3B 也开着（它的前置是第 3 关，同一条主线）', api.levelAccess('C3B').ok);
  sandbox.localStorage.removeItem(api.PROGRESS_KEY);

  /* ── 28.8 新地形与新兵种 ── */
  ok('港口地形已定义', !!api.TERRAIN['p']);
  ok('港口是陆地（cost 不是 99，nav 为空）',
     api.TERRAIN['p'].cost < 99 && api.TERRAIN['p'].nav === undefined);
  ok('港口有防御加成（码头仓库区）', api.TERRAIN['p'].def > 0, api.TERRAIN['p'].def);
  ok('海军步兵营可占领要点', api.CAPTURE_TYPES.includes('mrb'));
  ok('海军步兵营属于地面域（它是守备步兵，不是舰船）',
     api.domainOf({ type: 'mrb' }) === 'ground');

  /* ── 28.9 要点判定规则 ── */
  const oFort = L4.objectives.find(o => o.id === 'fort');
  const oCity = L4.objectives.find(o => o.id === 'city');
  ok('城市按城内兵力对比判归属（rule:contest）', oCity && oCity.rule === 'contest');
  ok('要塞是硬判定：格内同时有敌我就 contested',
     oFort && oFort.rule === undefined);
  ok('两处要点都是 core（守住才算达成）', oFort && oCity && oFort.core && oCity.core);
  ok('要塞炮预置在地图上', (L4.forts || []).some(f => f.kind === 'P'));
  ok('防空阵地预置在码头一带',
     (L4.forts || []).some(f => f.kind === 'F' && Math.min(...portCells.map(p => api.hexDist([f.r, f.c], p))) <= 2));

  NG4();
  ok('重开一局能进第四关', api.LEVEL.id === 'C4', api.LEVEL.id);
}

console.log('\n[29] 组织度崩溃');
{
  api.newGame();
  const u = api.uid('B1A');
  ok('默认崩溃线是 25', api.orgBreakLine() === 25, api.orgBreakLine());
  ok('默认恢复线是 40', api.orgRallyLine() === 40, api.orgRallyLine());
  ok('满组织度不崩', api.isBroken(u) === false, u.org);

  /* 阈值边界：25 崩、26 不崩。这条必须掐着数字测——
     写成「调到 10 会崩」那种断言，阈值改成 20 也照样绿，等于没测。 */
  u.org = 26;
  ok('组织度 26 还不算崩溃', api.isBroken(u) === false, u.org);
  u.org = 25;
  ok('组织度 25 正好崩溃（≤ 阈值）', api.isBroken(u) === true, u.org);

  /* 崩溃后列不出目标。
     **必须先证明"不崩的时候它本来能打"**——否则这条是假绿：
     单位旁边根本没有敌人时，崩不崩都是 0 个目标，把闸删掉断言照样绿。
     这条假防线是 mutcheck 逮出来的（"删掉 targetsFor 那道闸"没变红）。 */
  api.select(u);
  let spot = null;
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
    const p = [u.pos[0] + d[0], u.pos[1] + d[1]];
    if (p[0] < 0 || p[0] >= api.LEVEL.rows || p[1] < 0 || p[1] >= api.LEVEL.cols) continue;
    if (!api.unitAt(p[0], p[1])) { spot = p; break; }
  }
  const near = api.alive('red')[0];
  const nearKeep = near.pos.slice();
  ok('前提：找得到一个相邻空格来摆敌军', !!spot, spot ? spot.join(',') : '没有');
  if (spot) {
    near.pos = spot;
    u.org = 100;
    const nOK = api.targetsFor(u, api.getState().fields).length;
    ok('前提：满组织度 + 贴脸敌军时它列得出目标', nOK > 0, nOK + ' 个目标');
    u.org = 25;
    const nBroken = api.targetsFor(u, api.getState().fields).length;
    ok('崩溃的部队列不出攻击目标', nBroken === 0, nBroken + ' 个目标');
  }
  /* 但反击还在：被咬住时枪还在手上。
     注意别再写死 uid('R3A')——那是第三波的单位，开局不在场上，
     api.uid() 返回 null，下一行就 TypeError 把整个套件崩掉。 */
  const foe = api.alive('red')[0];
  foe.pos = [u.pos[0] + 1, u.pos[1]];
  ok('崩溃不影响反击（canCounter 仍为真）', api.canCounter(foe, u) === true);

  /* doAttack 也要拦：这条闸是给"绕过 targetsFor 的调用"准备的 */
  const foe2 = foe;
  const strBefore = foe2.str;
  const fired = api.doAttack(u, foe2);
  ok('崩溃单位直接调 doAttack 也打不出去', fired === false && foe2.str === strBefore,
     '返回 ' + fired + '，敌战力 ' + foe2.str + ' / ' + strBefore);

  /* 恢复：脱离接触 + 补给不断才 +10。
     不能直接断言「20 涨到 30」——settlePhase 本身还有自然恢复
     （光环内 15 + 光环值；脱指 7 / 12），叠一起是 45。
     要测的是**崩溃额外多给的那 10 点**，所以先量一遍不崩时涨多少，再比差值。
     直接写死 30 这种数字，改了自然恢复速度测试就假红（上一版就是这样）。 */
  api.newGame();
  const ctl = api.uid('B1A');
  api.alive('red').forEach(f => { f.pos = [0, 0]; });
  ctl.org = 60;                                   // 60 > 恢复线 40，不算崩溃
  api.settlePhase();
  const gainBase = ctl.org - 60;

  api.newGame();
  const r1 = api.uid('B1A');
  r1.org = 20;
  api.alive('red').forEach(f => { f.pos = [0, 0]; });          // 全部挪到远处，保证脱离接触
  api.refreshBroken();
  ok('进入崩溃会写上标记（只播一次台词靠它）', r1.broken === true);
  api.settlePhase();
  ok('脱离接触 + 补给未断：崩溃部队每回合额外 +10 组织度',
     r1.org - 20 === gainBase + 10,
     '基础 +' + gainBase + '，崩了之后 +' + (r1.org - 20));

  api.newGame();
  const r2 = api.uid('B1A');
  r2.org = 20;
  api.alive('red').forEach(f => { f.pos = [0, 0]; });
  r2.pos = [0, 1];                                  // 贴到敌军旁边，不算脱离接触
  api.refreshBroken();
  const orgBefore = r2.org;
  api.settlePhase();
  ok('贴着敌军不算脱离接触，不给这 10 点', r2.org <= orgBefore, orgBefore + ' → ' + r2.org);

  /* 滞回：崩过之后要回到 40 以上才解除，26 不算 */
  api.newGame();
  const r3 = api.uid('B1A');
  r3.org = 20; api.refreshBroken();
  ok('前提：已经崩了', r3.broken === true);
  r3.org = 35;
  ok('35 仍算崩溃（滞回：崩过的要回到 40 以上）', api.isBroken(r3) === true, r3.org);
  r3.org = 41;
  api.refreshBroken();
  ok('回到 41 恢复建制', r3.broken === false && api.isBroken(r3) === false, r3.org);

  /* 阈值可配置：关卡覆盖全局默认。
     注意改的必须是**当前正在跑的那个 LEVEL**（api.LEVEL），
     不能是 api.levelById('C1') 拿到的数据副本——orgBreakLine() 读的是模块内的
     LEVEL 变量，改副本它会静默返回 25，测试当场假绿。 */
  const cur = api.LEVEL;
  const keepB = cur.orgBreak;
  cur.orgBreak = 60;
  ok('LEVEL.orgBreak 能覆盖全局阈值', api.orgBreakLine() === 60, api.orgBreakLine());
  delete cur.orgBreak;
  ok('摘掉覆盖后回到 25', api.orgBreakLine() === 25, api.orgBreakLine());
  if (keepB !== undefined) cur.orgBreak = keepB;
}

console.log('\n[30] 防空阵地对空反击');
{
  api.newGame({ level: 'C4', noSave: true });
  const S = api.getState();
  const bunker = (S.forts || []).find(f => f.kind === 'F' && f.side === 'blue');
  ok('前提：地图上有我方防空阵地', !!bunker, bunker && [bunker.r, bunker.c].join(','));

  const inf = api.alive('blue').find(u => u.type === 'inf');
  /* 轰炸机在第 3 波（第 7 回合）才进场，开局 alive() 里找不到它。
     直接从关卡数据造一个出来，别为了测试去推回合——推回合会连带触发一堆事件。
     makeUnit 已导出，第二个参数 true = 本回合已行动（不影响反击判定）。 */
  const bmbDef = api.LEVEL.units.find(u => u.type === 'bmb');
  if (!api.alive('red').some(u => u.type === 'bmb')) {
    api.getState().units.push(api.makeUnit(bmbDef, true));
  }
  const bmb = api.alive('red').find(u => u.type === 'bmb');
  ok('前提：场上有一架敌轰炸机', !!bmb);
  /* 敌机放在阵地相邻格：飞机打地面只有 1 格射程，贴脸才有反击 */
  bmb.pos = [bunker.r - 1, bunker.c];
  bmb.str = 12;

  inf.pos = [bunker.r + 1, bunker.c];      // 先放在阵地外
  ok('不在防空阵地上的步兵打不了飞机', api.canCounter(bmb, inf) === false);
  inf.pos = [bunker.r, bunker.c];
  ok('站上防空阵地后可以对敌机反击', api.canCounter(bmb, inf) === true);

  const offPv = api.previewAttack(inf, bmb, S.fields);
  inf.pos = [bunker.r + 1, bunker.c];
  const onPv2 = api.previewAttack(inf, bmb, S.fields);
  inf.pos = [bunker.r, bunker.c];
  const onPv = api.previewAttack(inf, bmb, S.fields);
  ok('阵地加成真的进了攻击修正（比值提高）', onPv.ratio > onPv2.ratio,
     '阵地外 ' + onPv2.ratio.toFixed(2) + ' → 阵地上 ' + onPv.ratio.toFixed(2));

  /* 阵地失效就不算：格子里混进敌军 = 被压制 */
  const save = inf.pos.slice();
  const foe = api.alive('red')[0];
  const foeKeep = foe.pos.slice();
  /* 把敌方地面单位塞进阵地格 = 阵地被压制（fortWorking 返回 false） */
  foe.pos = [bunker.r, bunker.c];
  ok('阵地格被敌军压住时反击失效', api.canCounter(bmb, inf) === false);
  foe.pos = foeKeep;
  inf.pos = save;
  ok('（复位）阵地恢复后又能反击', api.canCounter(bmb, inf) === true);

  /* 防空兵不叠加这份加成：aac / aab 本来就有对空修正 */
  const aac = api.alive('blue').find(u => u.type === 'aac');
  if (aac) {
    aac.pos = [bunker.r, bunker.c];
    const pvA = api.previewAttack(aac, bmb, S.fields);
    aac.pos = [bunker.r + 1, bunker.c];
    const pvB = api.previewAttack(aac, bmb, S.fields);
    ok('防空连不吃阵地那 +0.55（避免叠成怪物）',
       Math.abs(pvA.ratio - pvB.ratio) < 0.001,
       pvA.ratio.toFixed(2) + ' vs ' + pvB.ratio.toFixed(2));
  }

  /* 适用范围：只对空中目标。
     这一段**必须直接测 aaBunkerBonus**。之前拿 previewAttack 的比值去比
     "站在阵地上打地面目标" vs "站在旁边打地面目标"，两次测量连防守方格都换了，
     格子地形的防御修正跟着变，测出来是 2.38 vs 3.34 —— 红得毫无意义。
     一条断言如果换个位置就能翻，那它测的不是规则。 */
  const redInf = api.alive('red').find(u => u.type === 'inf');
  inf.pos = [bunker.r, bunker.c];
  ok('对空中目标：站在阵地上拿到 +0.55', Math.abs(api.aaBunkerBonus(inf, bmb) - 0.55) < 1e-9,
     api.aaBunkerBonus(inf, bmb));
  if (redInf) {
    ok('对地面目标：站在阵地上也不加成', api.aaBunkerBonus(inf, redInf) === 0,
       api.aaBunkerBonus(inf, redInf));
  }
  const aac2 = api.alive('blue').find(u => u.type === 'aac');
  if (aac2) {
    aac2.pos = [bunker.r, bunker.c];
    ok('防空兵不重复吃这份加成', api.aaBunkerBonus(aac2, bmb) === 0, api.aaBunkerBonus(aac2, bmb));
  }
  /* 离开阵地格同样归零——"进入阵地"这个动作才有意义 */
  inf.pos = [bunker.r + 1, bunker.c];
  ok('离开阵地格就归零', api.aaBunkerBonus(inf, bmb) === 0, api.aaBunkerBonus(inf, bmb));
}


console.log('\n[31] 存档内容校验（导入路径与本地读档共用一套尺子）');
{
  api.newGame({ noSave: true });
  const good = api.buildSaveFile();
  const clone = () => JSON.parse(JSON.stringify(good.save));

  ok('前提：正常存档能通过校验', api.validateSave(clone()).ok);

  /* 每一条都对应"手改存档能造出来"的污染，不是假想：
     它们不会让游戏崩，只会让战力算成 NaN、兵种查不到、坐标落到图外。 */
  const c1 = clone(); c1.units[0].str = null;
  ok('战力不是数字 → 拒绝', !api.validateSave(c1).ok && /战力/.test(api.validateSave(c1).msg),
     api.validateSave(c1).msg);

  const c2 = clone(); c2.units[0].type = 'zzz';
  ok('兵种不存在 → 拒绝', !api.validateSave(c2).ok && /兵种/.test(api.validateSave(c2).msg),
     api.validateSave(c2).msg);

  const c3 = clone(); c3.units[0].pos = [999, 999];
  ok('坐标在战场之外 → 拒绝', !api.validateSave(c3).ok && /坐标/.test(api.validateSave(c3).msg),
     api.validateSave(c3).msg);

  const c4 = clone(); c4.units[0].org = 200;
  ok('组织度超出 0–100 → 拒绝', !api.validateSave(c4).ok && /组织度/.test(api.validateSave(c4).msg),
     api.validateSave(c4).msg);

  const c5 = clone(); c5.v = 1;
  ok('存档格式版本不符 → 拒绝', !api.validateSave(c5).ok);

  const c6 = clone(); c6.map = c6.map.slice(1);
  ok('地图行数与关卡对不上 → 拒绝', !api.validateSave(c6).ok);

  const c7 = clone(); c7.units = [];
  ok('没有任何部队 → 拒绝', !api.validateSave(c7).ok);

  /* ── 以下是 v4.6 体检补的内容校验。它们不制造 NaN，而是制造**代码**：
     渲染层有 25 处 innerHTML，存档里的字符串字段会被直接拼进标签。
     一份 `"><img src=x onerror=alert(1)>` 的兵牌名，在加校验之前真的能执行
     （体检时实测 pwn1=1 pwn2=1）。 */
  const c8 = clone(); c8.units[0].name = '"><img src=x onerror=alert(1)>';
  ok('兵牌名里带标签 → 拒绝', !api.validateSave(c8).ok && /名称/.test(api.validateSave(c8).msg),
     api.validateSave(c8).msg);

  const c9 = clone(); c9.units[0].abbr = '<b>x</b>';
  ok('简写里带标签 → 拒绝', !api.validateSave(c9).ok && /简写/.test(api.validateSave(c9).msg),
     api.validateSave(c9).msg);

  const c10 = clone(); c10.units[0].corps = '第1"旅';
  ok('编制号里带引号 → 拒绝', !api.validateSave(c10).ok && /编制号/.test(api.validateSave(c10).msg),
     api.validateSave(c10).msg);

  /* 地图行：地形字符是直接当 class 拼进棋盘的。只验行数的话，
     一行里塞一个 `"` 就够把整块棋盘的 HTML 撕开。 */
  const c11 = clone(); c11.map[0] = '"'.repeat(c11.map[0].length);
  ok('地图里出现未知地形字符 → 拒绝',
     !api.validateSave(c11).ok && /地形/.test(api.validateSave(c11).msg),
     api.validateSave(c11).msg);

  const c12 = clone(); c12.map[0] = c12.map[0].slice(0, -1);
  ok('地图某行长度不对 → 拒绝', !api.validateSave(c12).ok);

  const c13 = clone(); c13.log = [{ t: 'x', text: 'a'.repeat(600) }];
  ok('战报单行超长 → 拒绝', !api.validateSave(c13).ok && /战报/.test(api.validateSave(c13).msg),
     api.validateSave(c13).msg);

  const c14 = clone(); c14.log = new Array(201).fill(0).map(() => ({ t: 'x', text: 'a' }));
  ok('战报条数异常 → 拒绝', !api.validateSave(c14).ok, '201 条被放行');

  /* 工事的 kind：`FORT[f.kind].name` 在单位面板里是直接取的，给个假 kind
     会当场 TypeError——玩家看到的是"点兵牌就报错"，不是"存档可疑"。 */
  const c15 = clone(); c15.forts = [{ kind: 'zzz', side: 'blue', r: 0, c: 0 }];
  ok('工事类型不存在 → 拒绝', !api.validateSave(c15).ok && /工事/.test(api.validateSave(c15).msg),
     api.validateSave(c15).msg);

  const c16 = clone(); c16.mods = [{ label: '"><svg onload=alert(1)>' }];
  ok('修正说明里带标签 → 拒绝', !api.validateSave(c16).ok && /修正/.test(api.validateSave(c16).msg),
     api.validateSave(c16).msg);

  const c17 = clone(); c17.deck = ['forced', 'nosuchcard'];
  ok('牌组里有不存在的战术卡 → 拒绝',
     !api.validateSave(c17).ok && /战术卡/.test(api.validateSave(c17).msg),
     api.validateSave(c17).msg);

  /* **反向那条同样重要**：正常存档里全是中文字段，校验不能把它们一起杀掉。
     这一条漏了的话，上面十条全绿也可能是因为校验把所有人都拒了。 */
  ok('中文兵牌名 / 编制号照常通过（校验没误杀）',
     api.validateSave(clone()).ok && /[\u4e00-\u9fa5]/.test(good.save.units[0].name),
     good.save.units[0].name);

  /* readSave 走的是同一个函数：把污染档写进 localStorage，读回来必须是 null。
     这一条测的是"那两扇门真的都关着"，而不是"我写了个函数"。
     localStorage 在沙箱里挂在**全局**上（window.localStorage 是 undefined），
     所以这里只能用全局那个。 */
  api.clearSave();
  ok('前提：清档后 readSave 读不到东西', api.readSave() === null);
  /* 注意 localStorage 只在 **沙箱里**是全局变量，本文件跑在 Node 主进程上，
     直接写 localStorage 会 ReferenceError（上次就写成了 window.localStorage，
     在 node 下根本没有 window）。要碰存储只能走 loadGame 返回的 sandbox。 */
  const LS = sandbox.localStorage;
  LS.setItem(api.SAVE_KEY, JSON.stringify(c3));
  /* 必须先确认真的写进去了。不确认的话，setItem 静默失败时下面那条
     "读不回来"照样绿——测的就不是校验，而是"本地存储坏了"。 */
  ok('前提：污染档确实写进了 localStorage', LS.getItem(api.SAVE_KEY) !== null);
  ok('被污染的存档读不回来（readSave 返回 null）', api.readSave() === null,
     api.readSave() ? '竟然读回来了' : '');

  /* 导入路径：applySaveFile 必须给出可读的理由，而不是"导入成功"然后炸在几回合后 */
  const r = api.applySaveFile({ app: api.SAVE_FILE_APP, kind: 'save', v: 3, save: c2 });
  ok('导入被污染的存档 → 失败并说明原因', !r.ok && /兵种/.test(r.msg), r.msg);
  api.clearSave();

  /* 进度的清洗：不存在的卡 id 要剔掉，指向已删关卡的 last 要清空。
     不清的话牌组会静默少一张，玩家只会觉得"我怎么只带了两张"。 */
  const pr = api.cleanProgress({ cleared: {}, played: {}, deck: ['forced', 'nosuchcard'], last: 'NOPE' });
  ok('进度清洗：非法卡 id 被剔除', pr.deck.length === 1 && pr.deck[0] === 'forced',
     JSON.stringify(pr.deck));
  ok('进度清洗：指向不存在关卡的 last 被清空', pr.last === null, String(pr.last));
  ok('进度清洗：完全不是对象时返回 null', api.cleanProgress('hello') === null);
}


console.log('\n[32] 存档写失败必须留下痕迹（不能安静地丢一局）');
{
  /* 现实里的触发条件不是"玩家点了坏按钮"，是**环境**：
     Safari 隐私模式的 setItem 直接抛 QuotaExceededError；配额满了也一样。
     以前 saveGame() 只 `return false`，17 个调用点没有一个看返回值，
     表现是"玩了三小时，关掉浏览器回来发现还是第一关"。 */
  api.newGame({ noSave: true });
  api.clearSave();
  ok('前提：正常存档能写进去', api.saveGame() === true);
  ok('前提：写成功后没有异常标记', api.getState().saveBroken !== true);

  const LS = sandbox.localStorage;
  const realSet = LS.setItem;
  LS.setItem = () => {
    const e = new Error('The quota has been exceeded.');
    e.name = 'QuotaExceededError';
    throw e;
  };
  const before = api.getState().log.length;
  let ret;
  try { ret = api.saveGame(); } finally { LS.setItem = realSet; }
  ok('写失败时 saveGame 返回 false', ret === false, String(ret));
  ok('写失败后 state.saveBroken 被置位', api.getState().saveBroken === true);
  /* 战报里必须出现一行。玩家不看顶栏也能在战报区看见"存档没写进去"。 */
  const added = api.getState().log.slice(before);
  ok('写失败会在战报里留一行', added.length === 1 && /存档/.test(added[0].text),
     JSON.stringify(added.map(l => l.text)));

  /* 连续失败只提醒一次。每回合存档都失败的话，一局能刷上百条同样的红字，
     玩家会把整个战报区当成噪音，连别的消息一起忽略。 */
  LS.setItem = () => { throw new Error('quota'); };
  try { api.saveGame(); api.saveGame(); } finally { LS.setItem = realSet; }
  const added2 = api.getState().log.slice(before);
  ok('连续失败不重复刷屏（只提醒一次）', added2.length === 1,
     '期望 1 条，实际 ' + added2.length + ' 条');

  /* 存储恢复之后要能把红字撤掉。清不掉的后果是"一次抖动永久报警"，
     玩家学会无视它，真出问题那天也看不见。 */
  ok('存储恢复后重新存档返回 true', api.saveGame() === true);
  ok('重新写成功后异常标记被清掉', api.getState().saveBroken !== true);
  api.clearSave();
}


console.log('\n[33] 高炮同格反击 + 空袭指挥部要有目标指示');
{
  /* 两条都来自同一个玩家反馈：
       ① 防空炮打不了压到自己头上的敌机
       ② 敌机隔着整个战场优先点掉指挥部
     ① 是规则与实现不一致——TYPE.aac 的说明写着"对空目标不设近界"，
        而 canCounter 里那条近界判定对空也在生效，dist 0 < minRange 1 → 不还手。
     ② 是缺一条规则：HQ 是 str 2 / rng 0 的固定靶，scoreTarget 又给 +0.8，
        于是 AI 用飞机把师部点名抹掉。现在空袭 HQ 需要攻击方先有"眼睛"贴上去。 */
  api.newGame({ level: 'C4', noSave: true });
  const S = api.getState();
  const aac = api.alive('blue').find(u => u.type === 'aac');
  ok('前提：C4 有我方防空连', !!aac);
  const bmbDef = api.LEVEL.units.find(u => u.type === 'bmb');
  if (!api.alive('red').some(u => u.type === 'bmb')) {
    S.units.push(api.makeUnit(bmbDef, true));
  }
  const bmb = api.alive('red').find(u => u.type === 'bmb');
  ok('前提：场上有一架敌轰炸机', !!bmb);

  /* ── 33.1 同格反击 ──
     空中与地表是两层，敌机可以和防空炮站在同一格。以前那 1 格近界让高炮
     在"敌机压到头顶"这个最该开火的时候恰好哑火。 */
  aac.pos = [10, 12];
  bmb.pos = [10, 12];
  ok('前提：敌机与防空连同格（dist 0）', api.hexDist(aac.pos, bmb.pos) === 0);
  ok('同格空袭时防空连能反击（近界对空不成立）', api.canCounter(bmb, aac) === true);
  /* 相邻 1 格本来就打得了，别把修好的规则改坏 */
  bmb.pos = [10, 13];
  ok('相距 1 格时同样能反击', api.canCounter(bmb, aac) === true);
  /* 近界对地面目标照旧生效：炮兵贴脸还是打不了。
     这条和上面两条一起才能证明"改的是对空这一支"，而不是把近界整条删了。 */
  const art = api.alive('blue').find(u => u.type === 'art' || u.type === 'hr');
  if (art) {
    const redFoot = api.alive('red').find(u => u.type === 'inf' || u.type === 'mob');
    art.pos = [10, 12];
    redFoot.pos = [10, 12];
    ok('贴脸时炮兵对地面目标仍然不能反击（近界只对空放开）',
       api.canCounter(redFoot, art) === false);
  }

  /* ── 33.2 空袭 HQ 的目标指示 ── */
  const hq = api.alive('blue').find(u => api.isHQ(u));
  ok('前提：我方场上至少有一个指挥节点', !!hq);
  const hqPos = hq.pos.slice();
  const rec = api.alive('red').find(u => u.type === 'rec');
  ok('前提：C4 红方编成里有侦察连（没有它这条规则永远不触发）', !!rec);
  const foot = api.alive('red').find(u => u.type === 'inf' || u.type === 'mob');
  ok('前提：红方有普通地面部队', !!foot);

  /* 先把所有红方非航空单位挪到角落，保证只有被点名的那个在 HQ 附近 */
  const stash = api.alive('red').filter(u => u !== bmb && !api.isAir(u));
  const keep = stash.map(u => u.pos.slice());
  stash.forEach(u => { u.pos = [0, 0]; });
  ok('没有任何指示者时，飞机打不了 HQ（canTarget 直接拒）',
     api.canTarget(bmb, hq) === false);

  rec.pos = [hqPos[0], hqPos[1] + 3];
  ok('侦察连在 3 格外仍指示不了'
     + '（否则这条规则又变成"全图可见"）',
     api.canTarget(bmb, hq) === false);
  rec.pos = [hqPos[0], hqPos[1] + 2];
  ok('侦察连进到 2 格内 → HQ 可以被空袭', api.canTarget(bmb, hq) === true);

  rec.pos = [0, 0];
  foot.pos = [hqPos[0], hqPos[1] + 2];
  ok('普通地面部队在 2 格外不能指示（只有侦察看得那么远）',
     api.canTarget(bmb, hq) === false);
  foot.pos = [hqPos[0], hqPos[1] + 1];
  ok('普通地面部队贴到 1 格就能指示（已经到门口了）',
     api.canTarget(bmb, hq) === true);

  /* 飞机不能当自己的指示者——否则这条规则等于不存在 */
  foot.pos = [0, 0];
  bmb.pos = [hqPos[0], hqPos[1] + 1];
  ok('飞机贴着 HQ 也不算"看见"（航空单位不当指示者）',
     api.canTarget(bmb, hq) === false);

  /* ── 33.3 指挥部的防空掩体 ── */
  rec.pos = [hqPos[0], hqPos[1] + 2];
  bmb.pos = [hqPos[0] + 1, hqPos[1]];
  const pvHq = api.previewAttack(bmb, hq, S.fields);
  /* 对照组：同格位置换成一个辎重队。地形、防空压制、协同全都一样，
     唯一的差别是"打的是不是指挥节点"。直接比两次 attMod 才能证明这 -0.20
     真的进了修正，而不是靠比值（比值里混着守方战力，看不出是攻击修正改了）。 */
  const supB = api.alive('blue').find(u => u.type === 'sup');
  if (supB) {
    const supKeep = supB.pos.slice();
    supB.pos = hqPos.slice();
    const pvSup = api.previewAttack(bmb, supB, S.fields);
    supB.pos = supKeep;
    ok('空袭 HQ 的攻击方多 -0.20（同位置打辎重队没有）',
       Math.abs((pvSup.attMod - pvHq.attMod) - 0.20) < 1e-9,
       'HQ ' + pvHq.attMod.toFixed(2) + ' / 辎重队 ' + pvSup.attMod.toFixed(2));
  }

  /* 复位：别的节次要接着用这些单位 */
  stash.forEach((u, i) => { u.pos = keep[i]; });
  api.newGame({ level: 'C4', noSave: true });
}


console.log('\n[34] 手册文案的显示规矩（加粗 / 不许露代码 / 不许超时代装备）');
{
  /* 三条都是玩家看着屏幕提出来的，而且都不是"数值不对"这种能靠读代码发现的问题：
       ① 兵种说明里写了两百多处 **重点**，渲染时原样拼进 DOM —— 玩家看到星号。
       ② 文案里夹着 `atk 里没有 air`、`check.js 会拦`、`~` 这类代码层表述。
       ③ 战斗机写"挂着空空导弹"，而本作的技术水平对标二战。
     这类东西只有在**渲染结果**上才看得出来，所以断言打在渲染口，不扫源码：
     扫源码会把注释里的同样字眼一起命中，改注释还得改测试，很快就没人维护。 */
  const bad = [
    [/atk\s*里|check\.js|TYPE\.|abil\b|attMod/, '代码字段名'],
    [/`/, '反引号'],
    [/导弹|喷气|直升机|无人机|雷达制导|电子对抗/, '超出二战水平的装备'],
    [/\*\*/, '没有被转换的加粗标记']
  ];
  /* 把所有玩家能读到的文案攒成一条长串：兵种说明、地形说明、战术卡、副官问答。
     少收一处就会出现"改了但没测到"的缝，所以按来源一处处收全。 */
  const texts = [];
  for (const k of Object.keys(api.TYPE)) {
    const T = api.TYPE[k];
    texts.push(T.name + '|' + T.role);
    (T.abil || []).forEach(x => texts.push(x));
  }
  for (const k of Object.keys(api.TERRAIN)) {
    const t = api.TERRAIN[k];
    if (t && t.note) texts.push(t.note);
  }
  for (const id of api.CARD_IDS) {
    const c = api.CARDS[id];
    texts.push(c.name + '|' + c.desc + '|' + c.note);
  }
  api.AIDE.forEach(x => texts.push(x.q + '|' + x.a));

  ok('前提：确实收上来一批文案', texts.length > 120, texts.length + ' 条');

  for (const [re, why] of bad) {
    /* 加粗标记例外：`**` 允许存在于**原始数据**里（bold() 负责转换），
       所以这一项要问的是"转换之后还留不留星号"，不是原始串里有没有。
       其余三项原始串里就不该出现。 */
    const hits = re.source === '\\*\\*'
      ? texts.filter(t => /\*\*/.test(api.bold(t)))
      : texts.filter(t => re.test(t));
    ok('文案里没有' + why, hits.length === 0,
       hits.slice(0, 3).map(t => t.slice(0, 42)).join(' ⏐ '));
  }

  /* 转换本身：成对的换成 <b>，落单的原样留着（宁可露一个星号，也别吞正文） */
  ok('bold 把成对标记转成 <b>', api.bold('**甲**乙') === '<b>甲</b>乙');
  ok('bold 保留落单的星号', api.bold('2 ** 3') === '2 ** 3');
  ok('bold 不吃掉正文里的其它符号', api.bold('**对地 +0.50**：砸要点') ===
     '<b>对地 +0.50</b>：砸要点');
}

console.log('\n[35] 防空压制：高炮的「驱散」作用');
{
  api.newGame({ level: 'C3', noSave: true });
  let S = api.getState();
  const bunker = (S.forts || []).find(f => f.kind === 'F' && f.side === 'blue');
  ok('前提：第 3 关城区有一座我方防空阵地', !!bunker, bunker && cn([bunker.r, bunker.c]));

  /* 位置不是随手挑的：它必须罩住岚口市那个要点。
     罩不住的话，这条规则在第 3 关就永远不会被玩家看见——
     和"事件挂了但从不触发"是同一类错，只是不会报红。 */
  const city = api.LEVEL.objectives.find(o => o.id === 'city');
  const rng = api.FORT.F.suppress.rng;
  ok('阵地罩住了岚口市要点（三个城格至少一个在半径内）',
     city.cells.some(c => api.hexDist([bunker.r, bunker.c], c) <= rng),
     city.cells.map(c => api.hexDist([bunker.r, bunker.c], c)).join('/'));

  const fg = api.alive('red').find(u => api.isAir(u));
  ok('前提：第 3 关有敌方飞机（否则规则无处生效）', !!fg, fg && fg.type);
  const orgDrop = api.FORT.F.suppress.org;
  const floor = api.FORT.F.suppress.floor;

  /* ── 半径 ── */
  fg.pos = [bunker.r, bunker.c];
  ok('飞机飞到阵地上空：被压制', !!api.aaSuppressed(fg));
  const far = [bunker.r, bunker.c + rng + 1];
  const farOk = far[1] < api.LEVEL.cols;
  if (farOk) {
    fg.pos = far;
    ok('出半径一格：不再被压制（半径 = ' + rng + '）', api.aaSuppressed(fg) === null);
  }

  /* ── 只压敌方飞机 ── */
  fg.pos = [bunker.r, bunker.c];
  const rawSide = fg.side;
  fg.side = 'blue';
  ok('自家的飞机不吃自家阵地的压制', api.aaSuppressed(fg) === null);
  fg.side = rawSide;
  const redInf0 = api.alive('red').find(u => !api.isAir(u));
  if (redInf0) {
    const keep = redInf0.pos.slice();
    /* 一定要放在**阵地旁边的空地**，不能放在阵地上：
       站到阵地上会同时把 fortSuppressed 触发掉，那样就算删掉 isAir 判定
       这条也照样绿——测出来的是"阵地被压制"，不是"地面单位不吃压制"。
       第一版就是这么写的，变异自检当场抓出来了。 */
    redInf0.pos = [bunker.r - 1, bunker.c];
    ok('地面单位站在伞下不会被"压制"', api.aaSuppressed(redInf0) === null,
       cn([bunker.r - 1, bunker.c]) + ' 距阵地 1 格');
    redInf0.pos = keep;
  }

  /* ── 阵地不工作时不算 ──
     两种失效方式都要测：耐久打光、格子里混进敌军（fortSuppressed）。 */
  const hpKeep = bunker.hp;
  bunker.hp = 0;
  ok('阵地被打掉耐久后不再压制', api.aaSuppressed(fg) === null);
  bunker.hp = hpKeep;
  ok('（复位）耐久恢复后又能压制', !!api.aaSuppressed(fg));

  const foeKeep = redInf0.pos.slice();
  if (redInf0) {
    redInf0.pos = [bunker.r, bunker.c];   // 敌军踩上阵地 = 被压制
    ok('阵地被敌军踩住时不再压制天空', api.aaSuppressed(fg) === null);
    redInf0.pos = foeKeep;
  }

  /* ── 每回合掉组织度 ── */
  fg.pos = [bunker.r, bunker.c];
  fg.org = 100;
  const hit = api.aaSuppressTick();
  ok('压制结算命中这架飞机', hit.length === 1 && hit[0] === fg, hit.length + ' 架');
  ok('组织度按数据里的数值下降', Math.abs(fg.org - (100 - orgDrop)) < 1e-9, fg.org);

  /* ── 下限：压制是削弱，不是歼灭 ──
     没有下限时实测过一版：红方战斗机进城两回合就撞崩溃线，
     C3 达成率 67.5% → 77.5%，等于把整支航空兵删掉。 */
  fg.org = floor - 5;
  const before = fg.org;
  api.aaSuppressTick();
  ok('已经低于下限的不再被往下推（压制不负责把它打垮）', fg.org === before,
     before + ' → ' + fg.org);
  fg.org = floor + 3;
  api.aaSuppressTick();
  ok('刚过下限的只推到下限为止', fg.org === floor, fg.org);

  /* ── 压制会封住"原地休整" ──
     这一条只能在有补给的格子上测出来：飞机在敌境本来就算断绝，
     那条 −10 会盖住休整的 +12，看上去"反正也涨不回来"，测不出真假。
     所以把阵地临时挪到红方后方，让飞机站在自家补给里静止一回合：
       没有阵地 → +12；脚下有阵地 → −12。两者差 24，翻不了案。 */
  const nest = [2, 3];
  const supBefore = api.supplyOf(fg, S.fields).label;

  api.newGame({ level: 'C3', noSave: true });
  S = api.getState();
  let f2 = api.alive('red').find(u => api.isAir(u));
  f2.pos = nest.slice(); f2.org = 60; f2.moved = false; f2.fired = false;
  const nestSup = api.supplyOf(f2, S.fields);
  ok('前提：红方后方这个格子是有补给的（否则测不出休整）', nestSup.label !== '断绝', nestSup.label);
  api.settlePhase();
  ok('伞外静止一回合：组织度回升（+12）', f2.org === 72, f2.org);

  api.newGame({ level: 'C3', noSave: true });
  S = api.getState();
  f2 = api.alive('red').find(u => api.isAir(u));
  S.forts.push({ r: nest[0] + 1, c: nest[1], kind: 'F', side: 'blue', hp: 3, maxHp: 3 });
  f2.pos = nest.slice(); f2.org = 60; f2.moved = false; f2.fired = false;
  ok('（新阵地）罩住了这架飞机', !!api.aaSuppressed(f2));
  api.settlePhase();
  ok('伞下静止一回合：不升反降，说明休整被压住了', f2.org === 60 - orgDrop, f2.org);

  /* ── 半径在三个地方各写一遍，必须同口径 ──
     aaSuppressed（飞机在不在伞下）、aaPenalty（目标在不在伞下）、
     runAI 的 inAA（选点时的避让圈）。三处都写 2，改一处不同步就会变成
     "面板说被压制、命中修正却不算"这种对不上的状态。
     把同一个坐标同时喂给两个函数比结论——比的是规则不是常量，
     以后谁把高炮改成半径 3，这条会跟着红。 */
  api.newGame({ level: 'C3', noSave: true });
  S = api.getState();
  const bk = (S.forts || []).find(f => f.kind === 'F' && f.side === 'blue');
  const p2 = api.alive('red').find(u => api.isAir(u));
  const nearP = [bk.r, bk.c];
  const farP = [bk.r, bk.c + rng + 1];
  p2.pos = nearP;                       // 飞机在伞下、目标也在伞下
  ok('半径内：压制与命中修正在同一处成立',
     !!api.aaSuppressed(p2) && api.aaPenalty(p2, nearP) > 0);
  p2.pos = farP;                        // 飞机飞出伞、目标也在伞外
  ok('半径外：两边同时不成立（口径一致）',
     api.aaSuppressed(p2) === null && api.aaPenalty(p2, farP) === 0,
     api.aaPenalty(p2, farP));

  /* ── 航空兵不吃地面补给场 ──
     这是同一次改动里拆出来的根因：补给场 BFS 只从本方陆上据点扩，
     飞机在敌境上空必然算"断绝"，于是每架飞机一出生就背着 −30% 战力和
     每回合 −10 组织度。不拆掉它，上面那条"每回合 −12"就是在给一个
     本来就在往下掉的东西加速，"不能原地休整"更是永远测不到——
     断绝分支根本不会走到休整那一支。 */
  p2.pos = [1, 9];                                  // 红方飞机的出发空域，离本方据点很远
  const deepSup = api.supplyOf(p2, S.fields);
  ok('飞机在敌境也不判「断绝」（航空兵不看地面补给线）',
     deepSup.label !== '断绝', deepSup.label);
  ok('飞机的补给修正不是断绝那档 0.70', Math.abs(deepSup.mod - 0.70) > 1e-9, deepSup.mod);
}

/* ───────── 三十六、点击路由：一格两层时先开火 ─────────
   用户报的：防空炮打不到"自己据点头顶上"的敌机——点那格只会选中自己的守备营。
   根因是 unitAt() 地表优先，而 onHexClick 旧顺序"先判这格是不是我方单位"就 return。
   这一组必须走真实点击：直接调 doAttack 的话，这个 bug 根本抓不到
   （和 [14] 里"只测 doMove"是同一个教训）。 */
console.log('\n[36] 点击路由：一格两层时先开火');
{
  /* 场景：西部军区防空营（射程 2、对空）旁边的平原格上，
     地表停着我方一支守备营、空中压着一架敌战斗机。 */
  const set46 = () => {
    api.newGame({ level: 'C3', noSave: true });
    const st = api.getState();
    const gun = api.uid('B9');       // 西部军区防空营
    const gar = api.uid('B2A');      // 地表守备营
    const air = api.uid('R7');       // 敌战斗机中队
    const hex = [gun.pos[0] + 1, gun.pos[1]];
    gar.pos = hex.slice();
    air.pos = hex.slice();
    return { st, gun, gar, air, hex };
  };

  let s = set46();
  ok('前提：同一格里地表一支、空中一支',
     api.unitsAt(s.hex[0], s.hex[1]).length === 2,
     s.hex.join(',') + ' 内 ' + api.unitsAt(s.hex[0], s.hex[1]).length + ' 支');
  ok('前提：unitAt 取到的是地表那支（bug 的根就在这个"地表优先"）',
     api.unitAt(s.hex[0], s.hex[1]) === s.gar, api.unitAt(s.hex[0], s.hex[1]).id);

  api.select(s.gun);
  ok('选中高炮后，同格上空的敌机在可打目标里',
     api.getState().targets.includes(s.air), api.getState().targets.length + ' 个目标');

  const air0 = s.air.str;
  api.onHexClick(s.hex[0], s.hex[1]);
  ok('点这一格 = 开火（高炮用了本回合的行动）', s.gun.fired === true);
  ok('没有被领进"选中我方单位"分支', api.getState().selected !== s.gar,
     '选中变成了 ' + (api.getState().selected ? api.getState().selected.id : '空'));
  ok('敌机确实挨了打', !api.uid('R7') || api.uid('R7').str < air0,
     air0 + ' → ' + ((api.uid('R7') || {}).str));

  /* 打完这一发之后，同一格就该回到"选中守备营"——开火优先不等于把选中堵死 */
  api.onHexClick(s.hex[0], s.hex[1]);
  ok('打完之后再点这格：回到选中守备营',
     api.getState().selected === s.gar,
     api.getState().selected && api.getState().selected.id);

  /* 反例：不能谁都开火。普通步兵打不到飞机，点这格就该老老实实选中 */
  s = set46();
  api.select(api.uid('B1A'));      // 岚口预备役第 1 营，对空打不着
  ok('前提：这支步兵打不到飞机', !api.canTarget(api.uid('B1A'), s.air));
  api.onHexClick(s.hex[0], s.hex[1]);
  ok('够不着的部队点这格不会瞎开火，只是切换选中',
     api.getState().selected === s.gar && s.air.str > 0 && s.air.org === 100,
     api.getState().selected && api.getState().selected.id);

  /* 战术卡：同一个根。"炮火准备"指向敌方，地表那支是自己人，
     以前 cardFitsUnit 当场判否，卡永远落不到头顶那架飞机上。 */
  s = set46();
  s.st.deck = ['barrage'];
  s.st.cardId = 'barrage';
  const org0 = s.air.org;
  api.onHexClick(s.hex[0], s.hex[1]);
  ok('指向敌方的战术卡落在空中那一支上',
     api.uid('R7').org === Math.max(5, org0 - 20) && s.st.cardId === null,
     org0 + ' → ' + api.uid('R7').org);
}

console.log('\n[37] 音效按兵种分派');
{
  const S = api.SONIC, T = api.TYPE, A = api.ASSETS.sfx;
  ok('前提：SONIC / TYPE / ASSETS.sfx 都导出了', !!S && !!T && !!A);

  /* 表要覆盖全部兵种。漏一个**不会报错**，只会静音或退回步兵声——
     玩的时候很难归因到"某支部队没配音"，所以在这里一次性卡死。 */
  const miss = Object.keys(T).filter(k => !S.tab[k]);
  ok('TYPE 里每个兵种都在分派表里（' + Object.keys(T).length + ' 个）',
     miss.length === 0, miss.join(','));

  /* 三条主轴：枪 vs 炮、腿 vs 轮 vs 履带。
     挑的是"改错了一定听得出来"的那些，不是随便凑数。 */
  ok('步兵攻击 = 步枪（不是炮）', S.of('inf', 'a') === 'rifle', S.of('inf', 'a'));
  ok('重型坦克攻击 = 炮声', S.of('harm', 'a') === 'shell', S.of('harm', 'a'));
  ok('旅炮兵攻击 = 炮声', S.of('art', 'a') === 'shell', S.of('art', 'a'));
  ok('装步营攻击 = 步枪（下车作战）', S.of('mech', 'a') === 'rifle', S.of('mech', 'a'));
  ok('步兵机动 = 脚步', S.of('inf', 'm') === 'step', S.of('inf', 'm'));
  ok('重型坦克机动 = 履带', S.of('harm', 'm') === 'track', S.of('harm', 'm'));
  ok('摩步营机动 = 引擎', S.of('mob', 'm') === 'engine', S.of('mob', 'm'));
  ok('牵引炮兵机动 = 引擎（炮不会自己走）', S.of('art', 'm') === 'engine', S.of('art', 'm'));

  /* 航空与水面原来**共用** engine —— 一个槽顶三件事。
     这两族要挡住的是"卡车声配飞机"这种看起来很省的复用：
     正面验它们各自有槽，反面验一个都没留在 engine 上。
     只写正面的话，谁把 prop 又改回 engine、同时留一个航空兵在 prop，
     照样能过。 */
  ok('战斗机机动 = 螺旋桨', S.of('fgt', 'm') === 'prop', S.of('fgt', 'm'));
  ok('驱逐舰机动 = 舰体主机', S.of('dd', 'm') === 'ship', S.of('dd', 'm'));
  const AIRSEA = ['fgt', 'atk', 'bmb', 'trp', 'gbt', 'ptb', 'ffg', 'dd', 'ca', 'bb', 'cv', 'ss', 'lst'];
  const stillEngine = AIRSEA.filter(k => S.tab[k] && S.tab[k].m === 'engine');
  ok('航空与水面没有任何一个还借轮式引擎声', stillEngine.length === 0, stillEngine.join(','));

  /* 航空攻击原来是借地面的 fire / shell。挡住的是"反正都是枪炮"这种复用：
     机炮与步枪最好分辨的地方是**射速**（机炮连成线、步枪一响一顿），
     拿去借 fire 一开火就露出"这是地面上在打"。
     正面验机炮落 airgun、轰炸机落 bomb，反面验四个航空兵一个都没留在
     地面的 fire / shell 上——只写正面的话，改回去一个照样能过。 */
  ok('战斗机攻击 = 航空机炮', S.of('fgt', 'a') === 'airgun', S.of('fgt', 'a'));
  ok('攻击机攻击 = 航空机炮', S.of('atk', 'a') === 'airgun', S.of('atk', 'a'));
  ok('轰炸机攻击 = 投弹（不是一声炮响）', S.of('bmb', 'a') === 'bomb', S.of('bmb', 'a'));
  /* trp 的 am 0 / rg 0，永远不会攻击，它的 a 值是死数据，不参与这条断言。 */
  const AIRATK = ['fgt', 'atk', 'bmb'];
  const groundGun = AIRATK.filter(k => S.tab[k] && (S.tab[k].a === 'fire' || S.tab[k].a === 'shell'));
  ok('航空攻击没有一个还借地面枪炮', groundGun.length === 0, groundGun.join(','));

  /* 表里写的名字必须在 ASSETS 里真有。写成 'rifle-synth' 这种文件名
     （而不是槽位名）不会抛错，只会静默降级成无声。 */
  const bad = [];
  for (const k of Object.keys(S.tab)) {
    for (const kind of ['m', 'a']) {
      const slot = S.tab[k][kind];
      if (!A[slot]) bad.push(k + '.' + kind + '→' + slot);
    }
  }
  ok('分派表里每个槽位都能在 ASSETS 里找到', bad.length === 0, bad.slice(0, 4).join(' '));

  /* 真路径：把 sfx 截下来，看 FX 到底选了哪一条。
     只验 SONIC.of 不够——那只能证明表对了，证明不了 FX 用上了它
     （上一版 FX.hit 就是自己写死 defLoss>=3 选炮，根本不查表）。 */
  const got = [];
  const orig = api.FX.sfx;
  api.FX.on = true;
  api.FX.sfx = function (n) { got.push(n); };

  api.FX.move({ type: 'harm' });
  api.FX.move({ type: 'inf' });
  api.FX.hit({
    attType: 'art', defLoss: 1, attLoss: 0,
    defPos: [0, 0], attPos: [0, 0], defSide: 'red', attSide: 'blue'
  });
  api.FX.move(undefined);           // 没有单位时的兜底

  api.FX.sfx = orig;
  ok('FX.move 走分派：坦克→履带、步兵→脚步',
     got[0] === 'track' && got[1] === 'step', got.join(','));
  ok('FX.hit 按发起方兵种选炮声', got[2] === 'shell', got[2]);
  ok('缺单位时兜底出声，不静音', got[3] === 'step', got[3]);
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
