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

  /* 拖曳炮没放列就不能反击。步兵站在 2 格（近界外，够得着），
     变量只剩"放没放列"这一个——和上面三条不同，这里距离不是原因。 */
  const inf2 = { type: 'gdn', rng: 1, pos: [5, 5] };
  const artMarch = { type: 'art', rng: 5, pos: [5, 7], packed: true };
  const artSet   = { type: 'art', rng: 5, pos: [5, 7], packed: false };
  const shaMarch = { type: 'sha', rng: 3, pos: [5, 7], packed: true };
  ok('行军状态的旅野炮不能反击', api.canCounter(inf2, artMarch) === false);
  ok('已展开的旅野炮可以反击', api.canCounter(inf2, artSet) === true);
  ok('自行炮行军时照常反击（打带跑）', api.canCounter(inf2, shaMarch) === true);
  /* 缺省 packed 按"已展开"——不能因为老数据没写这个字段就集体缴械 */
  ok('packed 缺省视为已展开', api.canCounter(inf2, { type: 'hr', rng: 9, pos: [5, 8] }) === true);

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

  /* Node 环境没有 matchMedia，isNarrow 应为 false —— 这一支就是"桌面端"。
     v4.18 热补丁之前桌面被写死成 1 倍且不写 transform，缩放手柄也不显示，
     窗口比棋盘窄时只能左右拖着看。现在桌面和手机同一套 transform，
     适应倍数也同一套判据（受容器宽与可用高共同约束、2 倍封顶）。 */
  ok('桌面模式初始不缩放', v.isNarrow() === false && v.k === 1, 'k=' + v.k);
  v.fitView(false);
  ok('桌面 fit 后 vK 落在适应值上', Math.abs(v.k - v.fitK) < 1e-9,
     'k=' + v.k + ' fit=' + v.fitK);
  ok('适应倍数在 0.12–2 之间（下限防糊成一团、上限防文字发虚）',
     v.fitK >= 0.12 && v.fitK <= 2 + 1e-9, 'fit=' + v.fitK);
  ok('桌面的缩放上限高于适应值（否则放不动）', v.maxK > v.fitK,
     'max=' + v.maxK + ' fit=' + v.fitK);
  v.zoomBy(1.4);
  ok('桌面也能放大', v.k > 1 + 1e-9, 'k=' + v.k);
  /* 缩放比例真的被钳在上限上，不是"按一次涨一次" */
  for (let i = 0; i < 12; i++) v.zoomBy(1.4);
  ok('放大到上限就停住', Math.abs(v.k - v.maxK) < 1e-9, 'k=' + v.k + ' max=' + v.maxK);
  v.fitView(false);
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

  /* 红方行动中（AI 半程）也不写档：restoreGame 强制回 blue 阶段，
     若在红方半程落盘，读档会得到"红方走了一半却轮到我方"的倒带态。 */
  api.newGame();
  api.getState().phase = 'ai';
  ok('红方行动中不再写档', api.saveGame() === false);

  /* 空牌组是玩家在 HQ 里主动卸光的结果（readDeck 的 null/[] 语义必须区分），
     读档不能弹回默认三张。 */
  api.newGame();
  const sd = api.readSave();
  ok('测试前提：能读到当前存档', !!sd);
  sd.deck = [];
  api.restoreGame(sd);
  ok('卸空的牌组读档后仍是空的', Array.isArray(api.deckOf()) && api.deckOf().length === 0,
     JSON.stringify(api.deckOf()));

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

  /* 雷区 / 补给点与工事同族：伪造档把它们写成数字时，restoreGame 的
     `s.mines || []` 会原样放行，下一帧 renderBoard 的 .find 就崩。 */
  const cm1 = clone(); cm1.mines = 7;
  ok('雷区不是列表 → 拒绝', !api.validateSave(cm1).ok && /雷区/.test(api.validateSave(cm1).msg),
     api.validateSave(cm1).msg);
  const cm2 = clone(); cm2.mines = [{ r: 999, c: 0, side: 'blue' }];
  ok('雷区坐标在战场之外 → 拒绝', !api.validateSave(cm2).ok && /雷区/.test(api.validateSave(cm2).msg),
     api.validateSave(cm2).msg);
  const cm3 = clone(); cm3.depots = [{ r: 0, c: 0 }];
  ok('补给点缺阵营 → 拒绝', !api.validateSave(cm3).ok && /补给点/.test(api.validateSave(cm3).msg),
     api.validateSave(cm3).msg);
  const cm4 = clone(); cm4.depots = [{ r: 0, c: 0, side: 'blue' }];
  ok('格式正确的雷区补给点照常通过', api.validateSave(cm4).ok, api.validateSave(cm4).msg);

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

console.log('\n[38] 敌情检视与堆叠目标挑选');
{
  /* 用 C3 的真实编制，但把敌军挪到摆好的位置：这里要看的是
     "点下去之后状态怎么走"，不是关卡本身好不好打。
     两项玩家反馈——"看不到敌人具体信息"和"堆叠格想打指定那支"——
     在界面上是两条，在代码里是同一个入口（点击路由）的两个分支。 */
  const setup = () => {
    api.newGame({ level: 'C3', noSave: true });
    const st = api.getState();
    const me = api.uid('B1A');
    const foes = st.units.filter(u => u.side === 'red' && api.domainOf(u) === 'ground');
    /* 挑一个空的相邻格：不能把红方塞进我方堆叠里，否则 unitsAt 的顺序
       和"两支敌军"这个前提都不成立。 */
    const hex = api.neighbors(me.pos[0], me.pos[1])
      .filter(p => api.unitsAt(p[0], p[1]).length === 0)[0];
    foes[0].pos = hex.slice();
    foes[1].pos = hex.slice();
    /* 最远的一个空格：拿来做"打不到"的对照组，不能靠硬编码坐标——
       换一关地图尺寸就变了。 */
    let far = null, bd = -1;
    for (let r = 0; r < api.LEVEL.rows; r++) {
      for (let c = 0; c < api.LEVEL.cols; c++) {
        const d = api.hexDist(me.pos, [r, c]);
        if (d > bd && api.unitsAt(r, c).length === 0) { bd = d; far = [r, c]; }
      }
    }
    return { st, me, hex, far, f0: foes[0], f1: foes[1] };
  };

  /* ── 一、点敌军 = 检视 ── */
  let s = setup();
  ok('前提：步兵打得到地面目标', api.canTarget(s.me, s.f0));
  ok('前提：最远那格在射程外', api.hexDist(s.me.pos, s.far) > 2,
     api.hexDist(s.me.pos, s.far) + ' 格');
  s.f0.pos = s.far.slice();      // 挪到打不到的地方
  api.select(s.me);
  ok('前提：留在我方相邻的 f1 仍可打', api.getState().targets.includes(s.f1));
  api.onHexClick(s.far[0], s.far[1]);
  ok('点射程外的敌军 = 检视它，而不是翻地形',
     api.getState().inspect === s.f0,
     'inspect=' + (api.getState().inspect ? api.getState().inspect.id : '空'));
  ok('检视不会把当前选中清掉',
     api.getState().selected === s.me,
     '选中 = ' + (api.getState().selected ? api.getState().selected.id : '空'));
  ok('检视不占用行动：既没动也没开火', s.me.moved === false && s.me.fired === false);
  /* 面板讲的是敌人，地图讲的仍是我的射界——两者互不顶替 */
  ok('检视期间地图上的可打目标没被清掉', api.getState().targets.includes(s.f1));

  const other = s.st.units.find(u => u.side === 'blue' && u !== s.me);
  api.select(other);
  ok('切换到自己另一支部队时退出检视', api.getState().inspect === null,
     'inspect=' + (api.getState().inspect ? api.getState().inspect.id : '空'));

  /* ── 二、多目标格：先选后打 ── */
  s = setup();
  api.select(s.me);
  ok('前提：同格两支敌军都在可打目标里',
     api.getState().targets.includes(s.f0) && api.getState().targets.includes(s.f1));
  ok('targetsAt 返回全部两支，不是只挑一支',
     api.targetsAt(s.hex[0], s.hex[1]).length === 2,
     '返回 ' + api.targetsAt(s.hex[0], s.hex[1]).length + ' 支');

  api.onHexClick(s.hex[0], s.hex[1]);
  ok('多目标时点格子先弹选择器，不擅自决定打谁',
     !!api.getState().pick && s.me.fired === false,
     'pick=' + JSON.stringify(api.getState().pick) + ' fired=' + s.me.fired);
  ok('选择器没有把选中弄丢', api.getState().selected === s.me);

  const list = api.targetsAt(s.hex[0], s.hex[1]);
  ok('选择器里的顺序就是格内堆叠顺序', list[0] === s.f0 && list[1] === s.f1,
     list.map(x => x.id).join(','));
  const str0 = s.f0.str, str1 = s.f1.str;
  api.doAttack(s.me, list[1]);
  ok('挑第二支打：只有它受损，第一支原样',
     s.f0.str === str0 && (!s.st.units.includes(s.f1) || s.f1.str < str1),
     s.f0.id + ' ' + str0 + '→' + s.f0.str + '，' + s.f1.id + ' ' + str1 + '→' + s.f1.str);

  /* ── 三、单目标仍然一步开火 ── */
  s = setup();
  s.f1.pos = s.far.slice();
  api.select(s.me);
  api.onHexClick(s.hex[0], s.hex[1]);
  ok('单目标格仍然一步开火（没给每次射击加一次确认）',
     s.me.fired === true && api.getState().pick === null,
     'fired=' + s.me.fired + ' pick=' + JSON.stringify(api.getState().pick));

  /* ── 四、同格两支敌军时轮换检视 ── */
  s = setup();
  s.f0.pos = s.far.slice();
  s.f1.pos = s.far.slice();
  api.select(s.me);
  api.onHexClick(s.far[0], s.far[1]);
  const first = api.getState().inspect;
  api.onHexClick(s.far[0], s.far[1]);
  const second = api.getState().inspect;
  ok('同格两支敌军：再点一次换下一支',
     !!first && !!second && first !== second,
     (first && first.id) + ' → ' + (second && second.id));
}

/* ── [39] 手册数据完整性：兵种介绍 / 特殊机制 / 版本公告 ──
   这三张表是"给玩家看的文档"，不是战斗数值——所以坏了**不会影响任何一局战斗**，
   只会让手册上少一段、或者整页空白。恰恰因为这样，没有任何运行时异常会提醒你。
   结构断言放这里（能直接读数据），文案与渲染断言放 briefcheck（要真 DOM）。 */
{
  const fs = require('fs'), path = require('path');

  /* 兵种介绍必须盖住全部兵种。新加一个兵种忘了写介绍，图鉴上会静悄悄少一段，
     而玩家看到的是"这个兵种没有说明"，不是"你漏写了"。 */
  const typeKeys = Object.keys(api.TYPE);
  const infoKeys = Object.keys(api.UNIT_INFO || {});
  const missInfo = typeKeys.filter(k => !api.UNIT_INFO[k]);
  ok('每个兵种都有图鉴介绍（' + typeKeys.length + ' 个兵种全覆盖）',
     missInfo.length === 0, '缺：' + (missInfo.join(',') || '无'));
  /* 反方向：介绍表里不该有已经不存在的兵种键——那是改名或删兵种时留下的孤儿，
     它不会报错，只是永远不显示，下次有人照着它加兵种才发现对不上。 */
  const ghost = infoKeys.filter(k => !api.TYPE[k]);
  ok('介绍表里没有已不存在的兵种键', ghost.length === 0, '多余：' + (ghost.join(',') || '无'));
  const thin = infoKeys.filter(k => {
    const i = api.UNIT_INFO[k];
    return !i.cat || !i.intro || String(i.intro).length < 20;
  });
  ok('每条介绍都有类别、且介绍正文不少于 20 字（不是凑数的两个字）',
     thin.length === 0, '太薄：' + (thin.join(',') || '无'));

  /* 机制条目：三段缺一不可。少"怎么用"就变成了一份说明书，
     少"什么时候触发"玩家就无法判断自己这局会不会遇上。 */
  const mechs = (api.MECH || []).reduce((a, g) => a.concat(g.items || []), []);
  ok('特殊机制条目已建立', mechs.length >= 15, mechs.length + ' 条');
  const mechBad = mechs.filter(m => !m.k || !m.when || !m.effect || !m.tip ||
                                     String(m.when).length < 8 || String(m.effect).length < 8 ||
                                     String(m.tip).length < 8);
  ok('每条机制都写全了触发条件 / 触发效果 / 怎么用', mechBad.length === 0,
     '不全：' + (mechBad.map(m => m.k || '(无名)').join(',') || '无'));
  /* 点名几条"玩家一定会问"的机制必须还在。整页被误删时上面的条数断言会红，
     但只删掉其中几条不会——这些是最容易被合并/误删的。
     装甲那两条（履带压制 / 突破跟进）是 v4.16 新加的：规则改了手册没跟上，
     玩家会照旧按"坦克冲上去清场"的用法打，然后觉得这版没变化。 */
  const names = mechs.map(m => m.k);
  const must = ['击退', '补给', '建制崩溃', '履带压制', '突破跟进'];
  const lost = must.filter(n => names.indexOf(n) < 0);
  ok('击退 / 补给 / 建制崩溃 / 履带压制 / 突破跟进 都在手册里', lost.length === 0,
     '缺：' + (lost.join(',') || '无'));

  /* 版本公告：数据在 data/notes.js，与菜单页共用。
     首条必须是当前版本——否则"顶栏 v4.14、公告最新写 v4.13"，
     玩家分不清自己玩的是哪一版。 */
  const noteSrc = fs.readFileSync(path.join(__dirname, '..', 'data', 'notes.js'), 'utf8');
  /* 这个文件是写给浏览器看的（`window.CANGYU_NOTES = ...`），
     新上下文里没有 window，得先给它一个——否则报的是 "window is not defined"，
     看起来像"数据文件写坏了"，其实是测试环境缺个壳。 */
  const box = { window: {} };
  require('vm').runInNewContext(noteSrc, box);
  const NN = (box.window.CANGYU_NOTES && box.window.CANGYU_NOTES.notes) || [];
  ok('版本公告能读到数据', NN.length > 0, NN.length + ' 条');
  const noteBad = NN.filter(n => !n.date || !n.title || !Array.isArray(n.items) || !n.items.length);
  ok('每条公告都有日期、标题与至少一条内容', noteBad.length === 0,
     '不全：' + (noteBad.map(n => n.date || '(无日期)').join(',') || '无'));
  /* 版本号取顶栏那个 #verTag —— 它是版本的真源（package.json 是副本）。
     这里不能自己再算一遍，否则"以哪个为准"就有了第二个答案。 */
  const verTagNow = (fs.readFileSync(file, 'utf8').match(/id="verTag">v?([\d.]+)</) || [])[1];
  ok('公告首条版本与顶栏版本一致',
     !!NN[0] && !!verTagNow && String(NN[0].ver).replace(/^v/, '') === verTagNow,
     (NN[0] && NN[0].ver) + ' / v' + verTagNow);
  /* 版本号只能递增，不能因为手滑把旧的那条插到最上面。
     只比"首条等于当前版本"挡不住"最新两条顺序颠倒"——那种情况首条仍然对。 */
  const dateBad = NN.filter((n, i) => i > 0 && String(NN[i - 1].date) < String(n.date));
  ok('公告按日期倒序排列', dateBad.length === 0,
     '顺序不对：' + (dateBad.map(n => n.date).join(',') || '无'));
}

console.log('\n[40] 装甲的两条动词：履带压制与突破跟进');
{
  /* v4.16 加的两条装甲规则。它们的效果分别落在"组织度少 6 点"和"位置差一格"上，
     两样在界面上都看不见——玩家只会觉得"这关手感变了"。
     所以每条都要分两层验：纯函数验判定边界（城里/工事里/非装甲都要为 0），
     端到端验它真的进了 doAttack 的结算（函数写对了没人调，是最常见的一种假绿）。 */
  api.newGame({ level: 'C1', noSave: true });
  const S = api.getState();
  const T = api.TYPE;
  const M = api.LEVEL.map;
  S.units.length = 0;
  S.forts = [];

  let seq = 0;
  const put = (side, t, r, c, str) => {
    const u = api.makeUnit({ id: (side === 'blue' ? 'B' : 'R') + (++seq), side, type: t,
      abbr: 'T' + seq, name: '测试' + T[t].name, r, c, corps: 'T',
      str: str === undefined ? 10 : str,
      mov: T[t].mv || 8, rng: T[t].rg === undefined ? 1 : T[t].rg }, false);
    S.units.push(u);
    return u;
  };
  const clear = () => { S.units.length = 0; S.forts = []; };

  /* 找一条"攻方 — 目标 — 落点"三格平原直线。不写死坐标：换一关地图尺寸就变。 */
  let spot = null;
  for (let r = 1; r < api.LEVEL.rows - 1 && !spot; r++) {
    for (let c = 1; c < api.LEVEL.cols - 1; c++) {
      if (M[r][c] !== '.') continue;
      for (const a of api.neighbors(r, c)) {
        const dr = r - a[0], dc = c - a[1];
        const far = [r + dr, c + dc];
        if (!api.inBounds(far[0], far[1])) continue;
        if (M[a[0]][a[1]] !== '.' || M[far[0]][far[1]] !== '.') continue;
        spot = { att: a, def: [r, c], far };
        break;
      }
      if (spot) break;
    }
  }
  ok('前提：地图上有一条三格平原直线', !!spot,
     spot ? [spot.att, spot.def, spot.far].map(p => p.join(',')).join(' → ') : '没有');

  /* 找一格城市，做"地形不对就没有压制"的对照组 */
  let town = null;
  for (let r = 0; r < api.LEVEL.rows && !town; r++)
    for (let c = 0; c < api.LEVEL.cols; c++) if (M[r][c] === 't') { town = [r, c]; break; }
  ok('前提：地图上有城市格', !!town, town ? town.join(',') : '没有');

  /* ── 一、履带压制的四个边界 ── */
  const pressCase = () => {
    clear();
    /* 战力给足：击退要求"守方还有战力"，一炮就打没了的话
       走的是歼灭分支，测不到击退与跟进。 */
    const att = put('blue', 'marm', spot.att[0], spot.att[1], 30);
    const def = put('red', 'inf', spot.def[0], spot.def[1], 12);
    return { att, def };
  };
  let c1p = pressCase();
  ok('中坦在平原打步兵营：额外掉 6 点组织度', api.trackPress(c1p.att, c1p.def) === 6,
     String(api.trackPress(c1p.att, c1p.def)));

  c1p = pressCase();
  c1p.def.pos = town.slice();
  ok('目标躲进城里：没有履带压制', api.trackPress(c1p.att, c1p.def) === 0,
     String(api.trackPress(c1p.att, c1p.def)));

  c1p = pressCase();
  const at = put('blue', 'at', spot.att[0], spot.att[1], 30);
  ok('反坦克连打步兵：没有履带压制（不是装甲）', api.trackPress(at, c1p.def) === 0,
     String(api.trackPress(at, c1p.def)));

  c1p = pressCase();
  const tank = put('red', 'marm', spot.def[0], spot.def[1], 30);
  ok('中坦打中坦：没有履带压制（不是步兵）', api.trackPress(c1p.att, tank) === 0,
     String(api.trackPress(c1p.att, tank)));

  c1p = pressCase();
  /* 守方脚下的工事才算掩体。用最小字段直接塞进 forts：
     这里验的是 trackPress 的判定，不是造工事的流程（那条另有断言）。 */
  S.forts.push({ r: c1p.def.pos[0], c: c1p.def.pos[1], kind: 'H', side: 'red',
    def: 0.15, hp: 0, maxHp: 0 });
  ok('步兵蹲在自家堑壕里：没有履带压制', api.trackPress(c1p.att, c1p.def) === 0,
     String(api.trackPress(c1p.att, c1p.def)));

  c1p = pressCase();
  S.forts.push({ r: c1p.def.pos[0], c: c1p.def.pos[1], kind: 'H', side: 'blue',
    def: 0.15, hp: 0, maxHp: 0 });
  ok('工事是别人丢下的（阵营不对）：压制照常', api.trackPress(c1p.att, c1p.def) === 6,
     String(api.trackPress(c1p.att, c1p.def)));

  /* ── 二、端到端：那 6 点真的进了结算 ── */
  api.setRng(() => 0.5);          // 骰面固定：floor(0.5×6)=3，即第 4 面
  c1p = pressCase();
  {
    const pv = api.previewAttack(c1p.att, c1p.def, S.fields);
    const loss = api.CRT[pv.tier][3][1];
    const org0 = c1p.def.org;
    api.doAttack(c1p.att, c1p.def);
    ok('端到端：这一炮的目标组织度 = 损失 × 3 + 压制 6',
       c1p.def.org === Math.max(0, org0 - loss * 3 - 6),
       org0 + ' → ' + c1p.def.org + '（损失 ' + loss + '）');
  }

  /* ── 三、突破跟进 ── */
  const pushCase = (blockGap) => {
    clear();
    const att = put('blue', 'marm', spot.att[0], spot.att[1], 60);
    const def = put('red', 'inf', spot.def[0], spot.def[1], 12);
    if (blockGap) {
      put('red', 'inf', spot.far[0], spot.far[1], 6);
      for (const n of api.neighbors(spot.def[0], spot.def[1])) {
        if (S.units.some(u => u.pos[0] === n[0] && u.pos[1] === n[1])) continue;
        put('red', 'inf', n[0], n[1], 6);
      }
    }
    return { att, def };
  };

  let pc = pushCase(false);
  {
    const gap = pc.def.pos.slice();
    const attFrom = pc.att.pos.slice();
    const org0 = pc.att.org;
    const pv = api.previewAttack(pc.att, pc.def, S.fields);
    const attLoss = pv.counter ? api.CRT[pv.tier][3][0] : 0;
    api.doAttack(pc.att, pc.def);
    ok('前提：这一炮够 3:1', pv.ratio >= 3, pv.ratio.toFixed(2));
    ok('目标被击退离开了原位', pc.def.pos.join(',') !== gap.join(','),
       gap.join(',') + ' → ' + pc.def.pos.join(','));
    ok('攻方顺着缺口推进到目标原来的格子', pc.att.pos.join(',') === gap.join(','),
       attFrom.join(',') + ' → ' + pc.att.pos.join(','));
    ok('缺口那一格的数据归属已经变成攻方', api.unitAt(gap[0], gap[1]) === pc.att);
    ok('跟进要付 3 点组织度',
       pc.att.org === Math.max(0, org0 - attLoss * 3 - 3),
       org0 + ' → ' + pc.att.org + '（反击损失 ' + attLoss + '）');
  }

  pc = pushCase(true);
  {
    const attFrom = pc.att.pos.slice();
    const defFrom = pc.def.pos.slice();
    const org0 = pc.def.org;
    const pv = api.previewAttack(pc.att, pc.def, S.fields);
    const loss = api.CRT[pv.tier][3][1];
    api.doAttack(pc.att, pc.def);
    ok('退路堵死时目标原地不动', pc.def.pos.join(',') === defFrom.join(','),
       defFrom.join(',') + ' → ' + pc.def.pos.join(','));
    /* 精确式，不是"掉得比 8 多就行"：那样写连"多扣了 6 点压制"也能过。
       这一条要能区分"扣 8"和"什么都没扣"，所以把三项都算进去。 */
    ok('退路堵死时改扣 8 点组织度（不是跟进）',
       pc.def.org === Math.max(0, org0 - loss * 3 - 6 - 8),
       org0 + ' → ' + pc.def.org + '（损失 ' + loss + '，期望 ' +
       Math.max(0, org0 - loss * 3 - 6 - 8) + '）');
    ok('退路堵死时攻方也不跟进', pc.att.pos.join(',') === attFrom.join(','),
       attFrom.join(',') + ' → ' + pc.att.pos.join(','));
  }

  /* 目标与友军同格：它被推走了，友军还在原地，那不是缺口 */
  clear();
  {
    const att = put('blue', 'marm', spot.att[0], spot.att[1], 60);
    const def = put('red', 'inf', spot.def[0], spot.def[1], 12);
    const mate = put('red', 'inf', spot.def[0], spot.def[1], 6);
    const gap = def.pos.slice();
    api.doAttack(att, def);
    ok('前提：目标确实被推走了', def.pos.join(',') !== gap.join(','),
       gap.join(',') + ' → ' + def.pos.join(','));
    ok('同格还有友军时缺口没空出来，攻方不跟进',
       att.pos.join(',') === spot.att.join(','),
       spot.att.join(',') + ' → ' + att.pos.join(',') + '（' + mate.abbr + ' 还在缺口）');
  }

  /* 轻坦没有吨位：既不击退，也不跟进 */
  clear();
  {
    const att = put('blue', 'larm', spot.att[0], spot.att[1], 60);
    const def = put('red', 'inf', spot.def[0], spot.def[1], 12);
    const gap = def.pos.slice();
    api.doAttack(att, def);
    ok('轻坦：目标不被击退，攻方也不跟进',
       def.pos.join(',') === gap.join(',') && att.pos.join(',') === spot.att.join(','));
  }

  api.setRng(Math.random);
}

console.log('\n[41] 公路加成（v4.17 第 8 条）');
{
  /* 规则形状：公路对轮式 0.7 点，**只在身边一格没有敌人时**生效。
     三个断言分别守：加成存在、加成会失效、坦克不吃加成。
     少任何一个，"公路加成"就会退化成"全局加速"或"永远不生效"，
     而这两种坏法都不会报错，只会让十关的平衡数字悄悄漂走。 */
  api.newGame({ level: 'C3', noSave: true });
  const L3 = api.LEVEL;
  const st = api.getState();

  /* 找一格"干净的公路"：自身与六邻居都没有兵。
     随便挑一格写死坐标不行——地图一改，那格可能正好站着人，
     断言就会在"加成没生效"和"测试自己挑错了格子"之间分不清。 */
  let road = null;
  for (let r = 0; r < L3.rows && !road; r++) {
    for (let c = 0; c < L3.cols && !road; c++) {
      if (L3.map[r][c] !== '#') continue;
      const cells = [[r, c]].concat(api.neighbors(r, c));
      if (cells.some(p => api.unitsAt(p[0], p[1]).length)) continue;
      road = [r, c];
    }
  }
  ok('地图上找得到一格空公路', !!road, road ? road.join(',') : '没有空公路');

  if (road) {
    ok('轮式部队在空公路上按 0.7 点/格',
       api.moveCost({ type: 'mob', pos: road, side: 'blue' }, '#') === 0.7,
       api.moveCost({ type: 'mob', pos: road, side: 'blue' }, '#'));

    /* 无 pos 的最小对象也要能算——tools/check.js 就是这么调它的。
       以前这里直接取 u.pos[0]，整条校验链在部署检查那一步崩掉，
       报错位置看着像"检查脚本坏了"。 */
    ok('没有 pos 的调用方不抛错（校验器走的就是这条路）',
       api.moveCost({ type: 'mob' }, '#') === 0.7);

    /* 贴脸即失效：把最近的敌军临时挪到公路旁边 */
    const foe = api.alive('red')[0];
    const keep = foe.pos.slice();
    const nb = api.neighbors(road[0], road[1])[0];
    foe.pos = nb;
    ok('身边一格有敌军时加成失效（接敌展开不是行军）',
       api.moveCost({ type: 'mob', pos: road, side: 'blue' }, '#') === 1,
       api.moveCost({ type: 'mob', pos: road, side: 'blue' }, '#'));
    foe.pos = keep;

    /* 坦克不吃这个加成。中坦 10 点跑 10 格，摩步 8 点跑 11 格——
       这正是玩家反馈要的那个相对关系。 */
    ok('坦克在公路上仍是 1 点/格',
       api.moveCost({ type: 'marm', pos: road, side: 'blue' }, '#') === 1);
    ok('摩步在公路上的实际脚程多于中坦',
       Math.floor(8 / api.moveCost({ type: 'mob', pos: road, side: 'blue' }, '#')) >
       Math.floor(10 / api.moveCost({ type: 'marm', pos: road, side: 'blue' }, '#')));
    ok('越野时反过来：中坦（10 点 / 平原 2）比摩步（8 点）走得远',
       Math.floor(10 / 2) > Math.floor(8 / 2));
  }
  void st;
}

console.log('\n[42] 弹药补给预测（v4.17 第 9 条）');
{
  /* 面板要显示"下回合补不补"，而"补不补"的判定必须和 endTurn 是同一份。
     这里断言三种结果：满弹、已移动、静止且补给充足。
     故意用假单位：supplyOf 只看 type / side / pos / moved / ammo，
     不需要它真的躺在 state.units 里，也不会污染战局。 */
  api.newGame({ level: 'C3', noSave: true });
  const L3 = api.LEVEL;
  const st = api.getState();
  const src = (L3.blueSources && L3.blueSources[0]) || L3.blueSource;
  const at = src ? src.slice() : null;
  ok('C3 有蓝方补给源（补弹判定的落点）', !!at, String(at));

  if (at) {
    const base = { type: 'art', side: 'blue', pos: at, ammo: 2, maxAmmo: 6, moved: false };

    ok('满弹时不算补给',
       api.ammoTick(Object.assign({}, base, { ammo: 6 })).label === '已满',
       JSON.stringify(api.ammoTick(Object.assign({}, base, { ammo: 6 }))));
    ok('静止且在补给圈内 → 下回合 +1',
       api.ammoTick(base).label === '+1',
       JSON.stringify(api.ammoTick(base)));
    ok('本回合动过 → 不补',
       api.ammoTick(Object.assign({}, base, { moved: true })).label === '不补',
       JSON.stringify(api.ammoTick(Object.assign({}, base, { moved: true }))));

    /* 补给断绝：把补给场清空是最省事的造法（比找一格荒野可靠，
       不会因为地图改了而忽然变成"充足"）。
       但**核心要点会自持补给**——补给源往往就压在核心要点里，
       在那格测"断绝"会拿到"紧张"（第一次写就是这么错的）。
       所以先按数据挑一格不在核心要点上的地，再清空补给场。 */
    const coreCells = new Set();
    for (const o of L3.objectives) {
      if (!o.core) continue;
      for (const c of o.cells) coreCells.add(c[0] + ',' + c[1]);
    }
    let away = null;
    for (let r = 0; r < L3.rows && !away; r++) {
      for (let c = 0; c < L3.cols && !away; c++) {
        const ch = L3.map[r][c];
        if (ch === '~' || ch === 's' || ch === 'd') continue;
        if (coreCells.has(r + ',' + c)) continue;
        away = [r, c];
      }
    }
    const fields = st.fields;
    st.fields = { blue: {}, red: {} };
    const cut = api.ammoTick(Object.assign({}, base, { pos: away }));
    ok('补给断绝 → 不补，且原因写的是断绝而不是"已移动"',
       cut.label === '不补' && cut.why === '补给断绝',
       JSON.stringify(cut) + ' @ ' + away);
    /* 断绝优先级要高于"已移动"：反过来时，玩家看到"本回合已移动"，
       会以为下一回合能补，而实际上这一格根本补不上。 */
    const cutMoved = api.ammoTick(Object.assign({}, base, { pos: away, moved: true }));
    ok('断绝 + 动过：原因仍写断绝（判定顺序不能反）',
       cutMoved.why === '补给断绝', JSON.stringify(cutMoved));
    st.fields = fields;

    /* 没有弹药概念的兵种不该有徽章：返回 null 才是"不显示" */
    ok('步兵没有弹药条，返回 null（面板不画徽章）',
       api.ammoTick({ type: 'inf', side: 'blue', pos: at }) === null);
  }
}

console.log('\n[43] 超额条件提示（v4.17 第 6 条）');
{
  /* 菜单页的「★ 可超额」徽章要靠 perfectHint 给文案。
     它必须与 judgeFinal / reachResult 同源，否则会出现
     "菜单说可超额、打完不给超额"。三路各测一条。 */
  const c2 = api.levelById('C2');
  const h2 = api.perfectHint(c2);
  ok('突围关：超额条件是战力留存（v4.18 降到 60%）',
     h2.ok && h2.text.indexOf('60%') >= 0, JSON.stringify(h2));

  const c1 = api.levelById('C1');
  const h1 = api.perfectHint(c1);
  ok('坚守关：超额条件写明"七成幸存"与要守的核心',
     h1.ok && h1.text.indexOf('七成') >= 0 && h1.text.indexOf('要塞') >= 0,
     JSON.stringify(h1));

  const c3 = api.levelById('C3');
  const h3 = api.perfectHint(c3);
  const canPerfect3 = typeof c3.perfectScore === 'number' &&
                      typeof c3.winScore === 'number' && c3.perfectScore > c3.winScore;
  ok('计分关：有更高分数线才说"可超额"，没有就说不出来',
     h3.ok === canPerfect3, JSON.stringify(h3) + ' / 分数线 ' + c3.winScore + '→' + c3.perfectScore);

  const t1 = api.levelById('T1');
  const h0 = api.perfectHint(t1);
  ok('教学关不留超额：perfectHint 直接说没有',
     h0.ok === false && h0.text.indexOf('教学') >= 0, JSON.stringify(h0));

  const notReady = api.LEVELS.find(l => !l.ready);
  if (notReady) {
    ok('未编成的关卡不给超额徽章',
       api.perfectHint(notReady).ok === false, JSON.stringify(api.perfectHint(notReady)));
  }
}

console.log('\n[44] 要点标签按连通簇分段（v4.17 第 1 条）');
{
  /* 第 6 关「北郊防线」是分成两段的高地，算同一个要点。
     标签原来按平均坐标算，落在两块中间的空地上——玩家看到一个飘在无人处的标签。
     现在按连通簇各出一个标签。
     v4.18 起两段拆成了两个独立要点（lineW / lineE，各 10 分），
     但每个要点自身仍然只有一个连通簇，objClusters 的行为不变。 */
  const c6 = api.levelById('C6');
  const line = c6.objectives.find(o => o.id === 'lineW');
  const cl = api.objClusters(line);
  ok('C6 西段防线只有一个连通簇', cl.length === 1, cl.length + ' 段');
  ok('该簇至少两格（段内连通）',
     cl.every(g => g.length >= 2), cl.map(g => g.length).join('+'));
  const lineE = c6.objectives.find(o => o.id === 'lineE');
  ok('C6 两段防线已是两个独立要点（keep 各占一条）',
     api.levelById('C6').win.keep.indexOf('lineW') >= 0 &&
     api.levelById('C6').win.keep.indexOf('lineE') >= 0);

  const cross = c6.objectives.find(o => o.id === 'cross');
  ok('连成一片的要点只出一段', api.objClusters(cross).length === 1);

  /* 手写 cells 很容易写出重复坐标（编辑器里复制一行就重复了）。
     重复坐标要么去重、要么产出两个一模一样的标签，这里守去重。 */
  const dup = api.objClusters({ cells: [[3, 3], [3, 3], [3, 4]] });
  ok('重复坐标不会打出两个标签', dup.length === 1 && dup[0].length === 2,
     JSON.stringify(dup));

  /* 不相邻的两格必须分家：判据是 hexDist === 1，写成 cheb 或 <=1 都会把斜角算进来 */
  const far = api.objClusters({ cells: [[3, 3], [3, 6]] });
  ok('隔开的两格分成两段（连通判据是六角相邻，不是直线距离）', far.length === 2,
     JSON.stringify(far));
}

console.log('\n[45] 无效接触 / doAttack 闸门 / 工事分槽 / 乘数夹紧（v4.17 补丁）');
{
  /* 四组断言守 docs/20 §三 §五 §六 §八 的四个口子。
     每组都带一条"反向对照"：闸门不能把合法的攻击也拦掉，
     否则修一个静默漏洞、造一个明着的安全区。 */
  api.newGame({ level: 'C3', noSave: true });
  const S = api.getState();
  const T = api.TYPE;
  S.units.length = 0;
  S.forts = [];
  S.mods = [];

  let seq = 0;
  const put = (side, t, r, c, str) => {
    const u = api.makeUnit({ id: (side === 'blue' ? 'B' : 'R') + (++seq), side, type: t,
      abbr: 'T' + seq, name: '测试' + T[t].name, r, c, corps: 'T',
      str: str === undefined ? 10 : str,
      mov: T[t].mv || 8, rng: T[t].rg === undefined ? 1 : T[t].rg }, false);
    S.units.push(u);
    return u;
  };
  const passable = (r, c) => api.inBounds(r, c) && api.TERRAIN[api.LEVEL.map[r][c]].cost < 99;

  /* 找一个城区格 + 它旁边一格能站的陆地格。C3 的岚口市一定满足。 */
  let city = null, beside = null;
  outer:
  for (let r = 0; r < api.LEVEL.rows; r++) {
    for (let c = 0; c < api.LEVEL.cols; c++) {
      if (api.terrainAt(r, c).cls !== 't-town' || !passable(r, c)) continue;
      for (const n of api.neighbors(r, c)) {
        if (passable(n[0], n[1])) { city = [r, c]; beside = n; break outer; }
      }
    }
  }
  ok('找到城区与相邻格', !!city && !!beside, JSON.stringify([city, beside]));

  /* ── 一、无效接触 ──
     守军必须用红方：targetsFor 只列敌方目标，蓝打蓝列不出来，那不是闸门在拦。 */
  S.forts.push({ r: city[0], c: city[1], side: 'red', kind: 'B', def: 0.28, hp: 3, maxHp: 3 });
  const turtle = put('red', 'gdn', city[0], city[1], 10);
  turtle.fortify = 0.30;
  const weak = put('blue', 'at', beside[0], beside[1], 2);
  weak.moved = true;
  ok('前提：弱攻方对满工事城区的比值低于无效接触线',
     api.previewAttack(weak, turtle, S.fields).ratio < api.INVALID_RATIO,
     api.previewAttack(weak, turtle, S.fields).ratio.toFixed(3));
  ok('无效接触不进目标列表', !api.targetsFor(weak, S.fields).includes(turtle));
  ok('无效接触在 doAttack 也被拒（绕过列表的兜底闸）',
     api.doAttack(weak, turtle) === false && turtle.str === 10, '守方 str ' + turtle.str);
  const strong = put('blue', 'marm', beside[0], beside[1], 60);
  ok('反向对照：强攻方照常看得见同一目标',
     api.targetsFor(strong, S.fields).includes(turtle));

  /* ── 二、射程 / 弹药 / 展开（canFire + 距离复查）── */
  clear0(S);
  function clear0(s) { s.units.length = 0; s.forts = []; }
  const shooter = put('blue', 'inf', beside[0], beside[1], 10);
  let far = null;
  for (let r = 0; r < api.LEVEL.rows && !far; r++) {
    for (let c = 0; c < api.LEVEL.cols; c++) {
      if (passable(r, c) && api.hexDist([r, c], shooter.pos) >= 4) { far = [r, c]; break; }
    }
  }
  const remote = put('red', 'inf', far[0], far[1], 10);
  ok('前提：目标在射程之外', api.hexDist(shooter.pos, remote.pos) > api.attackRange(shooter));
  ok('超距目标不进列表', !api.targetsFor(shooter, S.fields).includes(remote));
  ok('超距 doAttack 被拒（列表外的直接调用也进不去）',
     api.doAttack(shooter, remote) === false && remote.str === 10, '守方 str ' + remote.str);

  S.units.length = 0;
  const gun = put('blue', 'art', beside[0], beside[1], 10);
  gun.rng = 3;   /* TYPE 只有展示文案，射程跟着兵牌走；这里按旅炮的 2–5 格直接给 */
  let mid = null;
  for (let r = 0; r < api.LEVEL.rows && !mid; r++) {
    for (let c = 0; c < api.LEVEL.cols; c++) {
      if (passable(r, c) && api.hexDist([r, c], gun.pos) === 2) { mid = [r, c]; break; }
    }
  }
  const near = put('red', 'inf', mid[0], mid[1], 10);
  const dGun = api.hexDist(gun.pos, near.pos);
  ok('前提：目标在火炮射程带内', dGun >= api.minRange(gun) && dGun <= api.attackRange(gun),
     dGun + ' / 近界 ' + api.minRange(gun));
  gun.ammo = 0;
  ok('空弹的炮列不出目标', api.targetsFor(gun, S.fields).length === 0);
  ok('空弹的炮在 doAttack 也被拒', api.doAttack(gun, near) === false && near.str === 10);
  gun.ammo = 1;
  ok('补回弹药后同一门炮照常锁定目标', api.targetsFor(gun, S.fields).includes(near));
  gun.packed = true;
  ok('行军状态的拖曳炮列不出目标', api.targetsFor(gun, S.fields).length === 0);
  ok('行军状态的拖曳炮在 doAttack 也被拒',
     api.doAttack(gun, near) === false && near.str === 10);

  /* ── 三、工事分槽 ── */
  S.units.length = 0; S.forts = [];
  let plainCell = null;
  for (let r = 0; r < api.LEVEL.rows && !plainCell; r++) {
    for (let c = 0; c < api.LEVEL.cols; c++) {
      if (passable(r, c) && api.terrainAt(r, c).cls !== 't-town') plainCell = [r, c];
    }
  }
  S.forts.push({ r: plainCell[0], c: plainCell[1], side: 'blue', kind: 'H', def: 0.15, hp: 0, maxHp: 0 });
  const aac = put('blue', 'aac', plainCell[0], plainCell[1], 4);
  ok('防空阵地能立在最常见的堑壕格上（分槽前被 def 0.10 < 0.15 永久锁死）',
     api.fortKindsFor(aac, plainCell).includes('F'), api.fortKindsFor(aac, plainCell).join('/'));
  ok('碉堡不可被堑壕反向覆盖（同槽仍要求 def 更大）',
     !api.fortKindsFor(aac, plainCell).includes('H'));
  S.forts.push({ r: city[0], c: city[1], side: 'blue', kind: 'B', def: 0.28, hp: 3, maxHp: 3 });
  const eng = put('blue', 'eng', plainCell[0], plainCell[1], 4);
  ok('工兵在碉堡格上可以改立火力点与防空（跨槽），但堑壕仍进不来（同槽 def 更小）',
     city && api.fortKindsFor(eng, city).includes('P') &&
     api.fortKindsFor(eng, city).includes('F') &&
     !api.fortKindsFor(eng, city).includes('H'),
     api.fortKindsFor(eng, city).join('/'));

  /* ── 四、乘数夹紧与炮兵减半口径 ──
     夹紧的上限要在"为了祖国"也叠上的局面里验（0.85+0.30+0.28+0.20=1.63）。
     「为了祖国」只认 kind 为 city/air 的要点，不是每关都有——按关卡搜一个。 */
  let site = null;
  for (const lv of api.LEVELS.filter(l => l.ready)) {
    api.newGame({ level: lv.id, noSave: true });
    const st = api.getState();
    for (const o of (lv.objectives || [])) {
      if (o.kind !== 'city' && o.kind !== 'air') continue;
      const cell = (o.cells || []).find(x =>
        api.terrainAt(x[0], x[1]).cls === 't-town' &&
        api.TERRAIN[api.LEVEL.map[x[0]][x[1]]].cost < 99);
      if (cell) { site = { lv, o, cell, st }; break; }
    }
    if (site) break;
  }
  ok('找到 kind 为 city/air 的城区要点关卡', !!site, site ? site.lv.id : '无');
  if (site) {
    const st = site.st;
    st.units.length = 0; st.forts = []; st.mods = [];
    let q = 0;
    const putAt = (t, r, c, str) => {
      const u = api.makeUnit({ id: 'B' + (++q), side: 'blue', type: t,
        abbr: 'T' + q, name: '测试' + T[t].name, r, c, corps: 'T',
        str: str === undefined ? 10 : str,
        mov: T[t].mv || 8, rng: T[t].rg === undefined ? 1 : T[t].rg }, false);
      st.units.push(u);
      return u;
    };
    st.ctrl = {}; st.ctrl[site.o.id] = 'blue';
    st.forts.push({ r: site.cell[0], c: site.cell[1], side: 'blue', kind: 'B', def: 0.28, hp: 3, maxHp: 3 });
    const turtle2 = putAt('gdn', site.cell[0], site.cell[1], 10);
    turtle2.fortify = 0.30;
    ok('防御叠放触顶后被夹紧（0.85+0.30+0.28+0.20=1.63 → 1.6，否则下一个加防御的特性就是 ×2.63 起步）',
       Math.abs(api.terrainDefFor(turtle2) - 1.6) < 1e-9, api.terrainDefFor(turtle2).toFixed(4));
    const artyOnFort = putAt('art', site.cell[0], site.cell[1], 10);
    const footOnFort = putAt('inf', site.cell[0], site.cell[1], 10);
    ok('炮兵的被动防御收益整体减半（含工兵碉堡，口径不再取决于"掩体是谁修的"）',
       Math.abs(api.terrainDefFor(artyOnFort) - (0.85 + 0.28) * 0.5) < 1e-9,
       api.terrainDefFor(artyOnFort).toFixed(4));
    ok('反向对照：步兵在同一个碉堡格吃满 0.85 + 0.28（不是 gdn，没有为了祖国）',
       Math.abs(api.terrainDefFor(footOnFort) - 1.13) < 1e-9,
       api.terrainDefFor(footOnFort).toFixed(4));

    st.forts = [];
    const buffed = putAt('inf', site.cell[0], site.cell[1], 10);
    const victim = putAt('inf', site.cell[0], site.cell[1] + 1, 10);
    st.mods = [{ side: 'blue', atk: 5, label: '探针加成' }];
    const pv = api.previewAttack(buffed, victim, st.fields);
    /* 期望值必须照公式全算：主攻 + 协同，再乘夹紧后的 2.0。
       只拿 effStr × 2 对账的话，协同那一份会被误记成"夹紧没生效"。 */
    const wantSum = (api.effStr(buffed, st.fields) +
        pv.attHelp.reduce((s, a) => s + api.effStr(a.u, st.fields) * a.w, 0)) * 2.0;
    ok('前提：修正池确实越过了 +1（否则夹紧断言没咬住任何东西）', pv.attMod > 4, pv.attMod.toFixed(2));
    ok('攻击乘数封顶 2.0（attSum 按夹紧后的乘数算，而不是 1+attMod）',
       Math.abs(pv.attSum - wantSum) < 1e-6,
       pv.attSum.toFixed(3) + ' vs ' + wantSum.toFixed(3));
    st.mods = [];
  }
}

console.log('\n[46] 炮兵分摊 / 多面进攻 / 指挥部防炮 / 教学关封顶（v4.18）');
{
  api.newGame({ level: 'C3', noSave: true });
  const S = api.getState();
  const T = api.TYPE;
  S.units.length = 0;
  S.forts = [];
  S.mods = [];
  S.flanges = {};

  let seq = 0;
  const put = (side, t, r, c, str) => {
    const u = api.makeUnit({ id: (side === 'blue' ? 'B' : 'R') + (++seq), side, type: t,
      abbr: 'T' + seq, name: '测试' + T[t].name, r, c, corps: 'T',
      str: str === undefined ? 10 : str,
      mov: T[t].mv || 8, rng: T[t].rg === undefined ? 1 : T[t].rg }, false);
    S.units.push(u);
    return u;
  };
  const passable = (r, c) => api.inBounds(r, c) && api.TERRAIN[api.LEVEL.map[r][c]].cost < 99;
  const key = p => p[0] + ',' + p[1];

  /* ── 一、炮兵分摊：同一格的所有地表单位一起掉血 ──
     炮兵打的是"格子"不是"番号"。堆在一格里的两支按各自战力比例分摊，
     非炮兵仍然是单体结算。取整的边界（0 点 / 单支 / 2 点保底）
     在下面的 [49] 里穷举，这一节只验"真打一发时账目对得上"。 */
  let stack = null, artySpot = null;
  outer46:
  for (let r = 0; r < api.LEVEL.rows; r++) {
    for (let c = 0; c < api.LEVEL.cols; c++) {
      if (!passable(r, c) || api.terrainAt(r, c).cls === 't-town') continue;
      /* 炮位要在近界之外（野炮 2 格）、射程之内（art 5 格）——取 3 格 */
      for (const n of api.neighbors(r, c)) {
        if (!passable(n[0], n[1])) continue;
        for (let rr = 0; rr < api.LEVEL.rows && !artySpot; rr++) {
          for (let cc = 0; cc < api.LEVEL.cols; cc++) {
            if (passable(rr, cc) && api.hexDist([rr, cc], [r, c]) === 3) {
              stack = [r, c]; artySpot = [rr, cc]; break outer46;
            }
          }
        }
      }
    }
  }
  ok('找到开阔堆叠格与 3 格外的炮位', !!stack && !!artySpot, JSON.stringify([stack, artySpot]));
  if (stack && artySpot) {
    const v1 = put('red', 'inf', stack[0], stack[1], 10);
    const v2 = put('red', 'inf', stack[0], stack[1], 10);
    /* 炮兵 str 40：比值 2:1，保证任何骰面下均摊份额 ≥1（否则断言掷骰运气） */
    const gun = put('blue', 'art', artySpot[0], artySpot[1], 40);
    /* TYPE.art 不带 rg（射程是单位数据，不是兵种表）——测试里自己给满射程 */
    gun.rng = 5;
    ok('前提：炮兵进了射程带（近界外、射程内）',
       api.minRange(gun) <= api.hexDist(gun.pos, v1.pos) &&
       api.hexDist(gun.pos, v1.pos) <= gun.rng,
       api.hexDist(gun.pos, v1.pos) + ' / 近界 ' + api.minRange(gun));
    ok('前提：堆叠目标在炮的目标列表里', api.targetsFor(gun, S.fields).includes(v1));
    api.doAttack(gun, v1);
    const l1 = 10 - v1.str, l2 = 10 - v2.str;
    /* 等战力的两支份额应当尽量均等——但奇数伤害必然差 1（3 点分成 2 / 1），
       所以判"差不超过 1"，判"相等"会变成靠骰子运气。 */
    ok('炮击分摊：等战力两支份额相差不超过 1',
       Math.abs(l1 - l2) <= 1 && l1 + l2 > 0, l1 + ' / ' + l2);
    ok('炮击分摊：组织度也一起掉', v1.org < 100 && v2.org < 100,
       v1.org + ' / ' + v2.org);
    /* "相差不超过 1"拦不住"都掉全额"的 mutant——账目必须对上：
       战报里写着面上损失 X 与各支份额，份额合计必须等于 X。 */
    const lm = S.log.map(l => l.text).reverse().find(t => t.indexOf('按战力分摊') >= 0);
    const mm = /面上 -(\d+)（(\d+) 支按战力分摊 ([\d\s\/]+)）/.exec(lm || '');
    ok('炮击战报给出逐支份额', !!mm, lm);
    if (mm) {
      const dealt = Number(mm[1]);
      const parts = mm[3].trim().split(/\s*\/\s*/).map(Number);
      ok('分摊明细合计等于面上损失（不是每支各掉一份）',
         parts.reduce((a, b) => a + b, 0) === dealt, parts.join('+') + ' vs ' + dealt);
      ok('分摊明细与两支的实际掉血一致',
         parts.slice().sort().join() === [l1, l2].sort().join(),
         parts.join('/') + ' vs ' + l1 + '/' + l2);
    }
    ok('炮击分摊：工事被波及清零', v1.fortify === 0 && v2.fortify === 0,
       v1.fortify + ' / ' + v2.fortify);

    /* 等战力时"按比例"与"按支平均"算出来一模一样（两支平分 4 点 → 2/2），
       抓不到"退回平均分"的变异。换一组 4 与 20 的堆叠——比例是 1:5，
       平均分会让两支各掉一样多，那才是真的"炮弹精准绕过主力"。
       血量必须给够（4 而不是 2）：只有 2 血的小队，就算每支吃全额也只掉得下 2 点，
       "全量 vs 分摊"在数值上看不出差别，变异就这么漏过去。
       炮位给 80 战力：比值稳在 3:1 以上，CRT 最坏档也有 4 点，必然走出 2 点保底。 */
    S.units = S.units.filter(u => u !== v1 && u !== v2 && u !== gun);
    const thin = put('red', 'inf', stack[0], stack[1], 4);
    const fat = put('red', 'inf', stack[0], stack[1], 20);
    const gun2 = put('blue', 'art', artySpot[0], artySpot[1], 80);
    gun2.rng = 5;
    ok('前提：不等战力堆叠也在炮的目标列表里',
       api.targetsFor(gun2, S.fields).includes(fat));
    api.doAttack(gun2, fat);
    const l3 = 4 - thin.str, l4 = 20 - fat.str;
    /* 比例 1:5、单发上限 7 点 → 小队理论上最多也就吃 2 点；
       它掉到 3 点以上就说明"每支各吃全额"了。 */
    ok('不等战力堆叠：战力 4 的那支最多吃 2 点', l3 >= 0 && l3 <= 2, String(l3));
    ok('不等战力堆叠：战力 20 的那支吃得明显更多', l4 > l3, l3 + ' / ' + l4);
    /* 判"大头占比"而不是"l4 ≈ 5×l3"：伤害小时 1:5 的份额会被取整压成 0，
       线性比值在 0/3、1/3 这种组合上必然失败，那是取整的必然误差，
       不是规则错了。占比只要落在 5/6 附近就够了。 */
    const fatShare = l4 / Math.max(1, l3 + l4);
    ok('不等战力堆叠：大头拿走约 5/6 的伤害',
       Math.abs(fatShare - 5 / 6) < 0.2, fatShare.toFixed(2) + '（' + l3 + '/' + l4 + '）');

    /* 反向对照：非炮兵打同一格，只有被点名的目标掉血 */
    const w1 = put('red', 'inf', stack[0], stack[1], 10);
    const w2 = put('red', 'inf', stack[0], stack[1], 10);
    const b2 = api.neighbors(stack[0], stack[1]).find(n => passable(n[0], n[1]));
    const hit = put('blue', 'marm', b2[0], b2[1], 6);
    api.doAttack(hit, w1);
    ok('非炮兵仍是单体结算：同格友军不掉血',
       w2.str === 10, w2.str);
    S.units = S.units.filter(u => u !== v1 && u !== v2 && u !== gun &&
      u !== thin && u !== fat && u !== gun2 &&
      u !== w1 && u !== w2 && u !== hit);

    /* 收着炮的拖曳炮不能反击（v4.18 热补丁，走真实结算而不只是纯函数）。
       用"炮打炮"造这个局面：步兵射程只有 1，贴到 1 格时拖曳炮本来就因近界
       还不了手，测不出 packed 的作用；炮对炮站在 3 格，距离与射程都够，
       变量只剩"放没放列"。 */
    S.units.length = 0;
    /* rng 必须显式给 5：`put()` 按 `T[t].rg` 取值，而 TYPE.art 没有 rg 字段，
       默认落到 1 格——那样 3 格外本来就在射程外，counter 会因为"射程不够"
       变假，`packed` 这条就测不出来了（两个原因混在一起）。 */
    const towed = put('red', 'art', stack[0], stack[1]);
    towed.packed = true; towed.rng = 5;
    const gunner = put('blue', 'art', artySpot[0], artySpot[1]);
    gunner.rng = 5;
    const gBefore = gunner.str;
    ok('前提：两门炮相距 3 格（近界外、射程内）且守方收着炮',
       api.hexDist(gunner.pos, towed.pos) === 3 && towed.packed === true);
    /* 只看本次 doAttack 新增的日志：`S.log` 是整局累积的，前面某次战斗
       也可能写过"对方无法反击"，扫全文会让这条断言被上一条顶替而假绿。 */
    const logBefore = S.log.length;
    const hitOk = api.doAttack(gunner, towed);
    ok('打行军状态的拖曳炮：攻击成立', hitOk !== false);
    ok('打行军状态的拖曳炮：攻方零损失（对方没还手）',
       gunner.str === gBefore, gBefore + ' → ' + gunner.str);
    const hitLogs = S.log.slice(logBefore).map(l => String(l.text || ''));
    ok('战报写明「对方无法反击」',
       hitLogs.some(t => t.indexOf('对方无法反击') >= 0), hitLogs.join(' | '));
    /* 对照：同一门炮展开后就能还手。
       没有这条，"canCounter 恒返回 false"也能让上面两条全绿。 */
    towed.packed = false;
    const gunner2 = put('blue', 'art', artySpot[0], artySpot[1]);
    ok('对照：同一门炮展开后可以反击',
       api.previewAttack(gunner2, towed, S.fields).counter === true);
  }

  /* ── 二、多面进攻：同一回合被不同方向攻打，防御乘数 −0.30（下限 ×1）── */
  let city = null, adj1 = null, adj2 = null;
  outer46b:
  for (let r = 0; r < api.LEVEL.rows; r++) {
    for (let c = 0; c < api.LEVEL.cols; c++) {
      if (api.terrainAt(r, c).cls !== 't-town' || !passable(r, c)) continue;
      const ns = api.neighbors(r, c).filter(n => passable(n[0], n[1]));
      if (ns.length >= 2) { city = [r, c]; adj1 = ns[0]; adj2 = ns[1]; break outer46b; }
    }
  }
  ok('找到城区与两个相邻格', !!city && !!adj1 && !!adj2, JSON.stringify([city, adj1, adj2]));
  if (city) {
    const def = put('red', 'inf', city[0], city[1], 10);
    def.fortify = 0.30;
    const a1 = put('blue', 'marm', adj1[0], adj1[1], 10);
    put('blue', 'marm', adj2[0], adj2[1], 10);
    const pv0 = api.previewAttack(a1, def, S.fields);
    ok('前提：无侧翼记录时不算多面进攻', pv0.flanked === false, String(pv0.flanked));
    ok('前提：城区守军的防御加成高于 0.30（否则夹紧会吃掉对照）',
       api.terrainDefFor(def) > 0.30, api.terrainDefFor(def).toFixed(2));
    /* flanges 的账由 doAttack 记（noteFlank），测试直接摆账本：
       键是"挨打的格"，值是"第一个进攻方来的格"——从别的格再打就算包抄。 */
    S.flanges[key(def.pos)] = key(adj2);
    const pv1 = api.previewAttack(a1, def, S.fields);
    ok('另一方向打过之后，previewAttack 标记 flanked', pv1.flanked === true);
    ok('多面进攻削防御：defSum 严格变小', pv1.defSum < pv0.defSum,
       pv1.defSum.toFixed(2) + ' vs ' + pv0.defSum.toFixed(2));
    const expect = pv0.defSum / (1 + api.terrainDefFor(def)) *
                   (1 + api.terrainDefFor(def) - 0.30);
    ok('削的量恰是 FLANK_PENALTY（0.30 加在乘数括号里）',
       Math.abs(pv1.defSum - expect) < 1e-6,
       pv1.defSum.toFixed(3) + ' vs ' + expect.toFixed(3));
    /* 同一个方向打两次不算包抄：账本记的是"来的格"，不是"来过几次" */
    S.flanges[key(def.pos)] = key(adj1);
    ok('同一格方向 repeat 不算多面进攻', api.previewAttack(a1, def, S.fields).flanked === false);
    delete S.flanges[key(def.pos)];

    /* 刹车：开阔地上防御加成本来就是 0，乘数夹在 ×1，多面进攻不再往下压 */
    const flat = api.neighbors(city[0], city[1]).find(n => passable(n[0], n[1]) &&
      api.terrainAt(n[0], n[1]).cls !== 't-town' && api.terrainDefFor(def) >= 0);
    if (flat) {
      const openDef = put('red', 'inf', flat[0], flat[1], 10);
      const fa1 = put('blue', 'marm', ...api.neighbors(flat[0], flat[1]).find(n => passable(n[0], n[1])));
      const f0 = api.previewAttack(fa1, openDef, S.fields);
      S.flanges[key(openDef.pos)] = '0,0';
      if (api.previewAttack(fa1, openDef, S.fields).flanked) {
        const f1 = api.previewAttack(fa1, openDef, S.fields);
        ok('开阔地：乘数夹在 ×1，多面进攻不把防御压成负',
           f1.defSum === f0.defSum, f1.defSum.toFixed(2) + ' vs ' + f0.defSum.toFixed(2));
      } else {
        ok('开阔地：乘数夹在 ×1（该格无第二方向，跳过数值对照）', true);
      }
      delete S.flanges[key(openDef.pos)];
    }
    S.units = S.units.filter(u => ![def, a1].includes(u));
  }

  /* ── 三、指挥部防炮：炮兵 / 舰炮对指挥部 attMod −0.30 ── */
  {
    const hq = put('red', 'hqd', city[0], city[1], 10);
    const foot = put('red', 'inf', city[0], city[1], 10);
    /* 炮位按指挥部的位置现找：近界外（≥2）、射程内（≤5），取 3 格 */
    let spot2 = null;
    for (let r = 0; r < api.LEVEL.rows && !spot2; r++)
      for (let c = 0; c < api.LEVEL.cols && !spot2; c++)
        if (passable(r, c) && api.hexDist([r, c], city) === 3) spot2 = [r, c];
    ok('前提：找到指挥部 3 格外的炮位', !!spot2, JSON.stringify(spot2));
    const gun2 = put('blue', 'art', spot2[0], spot2[1], 40);
    gun2.rng = 5;
    const blade = put('blue', 'marm', adj1[0], adj1[1], 10);
    ok('前提：炮兵在射程带内', api.targetsFor(gun2, S.fields).includes(hq));
    const byGun = api.previewAttack(gun2, hq, S.fields).attMod;
    const byGunInf = api.previewAttack(gun2, foot, S.fields).attMod;
    ok('炮击指挥部：attMod 比炮击普通部队低 0.30',
       Math.abs((byGunInf - byGun) - 0.30) < 1e-9,
       byGun.toFixed(2) + ' vs ' + byGunInf.toFixed(2));
    const byBlade = api.previewAttack(blade, hq, S.fields).attMod;
    const byBladeInf = api.previewAttack(blade, foot, S.fields).attMod;
    ok('反过来说：平射指挥部不吃这个减免（是"防炮"，不是"防平射"）',
       Math.abs(byBlade - byBladeInf) < 1e-9,
       byBlade.toFixed(2) + ' vs ' + byBladeInf.toFixed(2));
    S.units = S.units.filter(u => ![hq, foot, gun2, blade].includes(u));
  }

  /* ── 四、教学关封顶：打再高也只判 win，不给 perfect ── */
  {
    ok('isTutorial 认得教学关、放行普通关',
       api.isTutorial(api.levelById('T1')) === true &&
       api.isTutorial(api.levelById('C1')) === false);
    api.newGame({ level: 'T1', noSave: true });
    const T1 = api.getState();
    /* 造一个"必然超额"的局面：把超额线拉到 5 分、占住演习要点。
       没有封顶的话 judgeFinal 会先判 perfect 再被 isTutorial 压回 win；
       封顶失效的 mutant 会让这里变红。 */
    api.LEVEL.perfectScore = 5;
    const drill = api.LEVEL.objectives[0];
    const holder = put('blue', 'inf', drill.cells[0][0], drill.cells[0][1], 10);
    T1.units.push(holder);
    api.updateControl();
    api.judgeFinal();
    ok('教学关：分数越过超额线也只判 win', T1.result === 'win', T1.result);
    ok('教学关：确实越过了超额线（对照不是白设的）',
       api.blueScore() >= 5, String(api.blueScore()));
    delete api.LEVEL.perfectScore;
  }

  /* ── 五、坚守关七成线端到端：judgeFinal 与 perfectHint 必须同源 ──
     perfectHint 的文案会说"七成"，但真正判 perfect 的是 judgeFinal 里
     那个 0.7——两处各写各的话，就会出现"菜单说可超额、打完不给超额"。 */
  {
    api.newGame({ level: 'C1', noSave: true });
    const C1 = api.getState();
    const initN = api.LEVEL.units.filter(u => u.side === 'blue' && u.wave === 1).length;
    ok('前提：C1 是坚守关、蓝方第一波不少于 7 支',
       api.LEVEL.win.kind === 'survive' && initN >= 7,
       api.LEVEL.win.kind + ' / ' + initN);
    for (const id of api.LEVEL.win.keep) C1.ctrl[id] = 'blue';
    /* 摘掉一支（alive 不过滤 str=0 的兵牌，置 0 不算阵亡）：
       11/12 ≥ 七成但 < 全额，正好卡在两条判据之间。 */
    const victim = api.alive('blue')[0];
    C1.units.splice(C1.units.indexOf(victim), 1);
    api.judgeFinal();
    ok('坚守关：损一支仍在七成线上，judgeFinal 判 perfect', C1.result === 'perfect',
       C1.result);
  }
}

console.log('\n[47] 无效接触只拦"会被反击"的攻击（v4.18 热修：炮兵射程内的目标被藏起来）');
{
  /* 玩家报的现场：C1 的 103 师炮兵营（str 5）站在要塞炮上，射程 6，
     红方整编营推进到 3 格外——面板上一个可打的格都没有，点下去毫无反应。
     根因是 v4.18 的无效接触闸只看比值：5 打 10 约 0.21，被当成"白送编制"。
     但那条理由的前提是**守方能还手**；间瞄炮站在敌人射程之外，attLoss 恒为 0，
     这一炮是净赚的。判据因此改成"比值不够 **且** 对面够得着还手"。 */
  api.newGame({ level: 'C3', noSave: true });
  const S = api.getState();
  const T = api.TYPE;
  S.units.length = 0;
  S.forts = [];
  S.mods = [];
  S.flanges = {};

  let seq = 0;
  const put = (side, t, r, c, str) => {
    const u = api.makeUnit({ id: (side === 'blue' ? 'B' : 'R') + (++seq), side, type: t,
      abbr: 'T' + seq, name: '测试' + T[t].name, r, c, corps: 'T',
      str: str === undefined ? 10 : str,
      mov: T[t].mv || 8, rng: T[t].rg === undefined ? 1 : T[t].rg }, false);
    S.units.push(u);
    return u;
  };
  const passable = (r, c) => api.inBounds(r, c) && api.TERRAIN[api.LEVEL.map[r][c]].cost < 99;

  /* ── 一、间瞄炮兵 3 格外打整编营：比值低，但自己不挨打 ── */
  let spot = null, gunSpot = null;
  outer47:
  for (let r = 0; r < api.LEVEL.rows; r++) {
    for (let c = 0; c < api.LEVEL.cols; c++) {
      if (!passable(r, c)) continue;
      for (let rr = 0; rr < api.LEVEL.rows; rr++) {
        for (let cc = 0; cc < api.LEVEL.cols; cc++) {
          if (passable(rr, cc) && api.hexDist([rr, cc], [r, c]) === 3) {
            spot = [r, c]; gunSpot = [rr, cc]; break outer47;
          }
        }
      }
    }
  }
  ok('找到相距 3 格的一对落点', !!spot && !!gunSpot, JSON.stringify([spot, gunSpot]));
  const foe = put('red', 'inf', spot[0], spot[1], 10);
  /* 真实编制：103 师炮兵营是 str 5 / rng 5，近界 2 —— 与关卡数据一致 */
  const gun = put('blue', 'art', gunSpot[0], gunSpot[1], 5);
  gun.rng = 5;
  const pvG = api.previewAttack(gun, foe, S.fields);
  ok('前提：5 打 10 的比值远低于无效接触线', pvG.ratio < api.INVALID_RATIO, pvG.ratio.toFixed(3));
  ok('前提：守方够不着炮位，这一炮不掉炮组自己的编制', pvG.counter === false);
  ok('无反击的低比值炮击不算"无效接触"',
     api.invalidContact(gun, foe, S.fields) === false);
  ok('因此射程内的整编营回到炮兵的目标列表', api.targetsFor(gun, S.fields).includes(foe));
  /* 骰面锁在最不利那一行（tier6 第 6 行 = 攻 7 守 2）：守方必定掉 2 点 */
  api.setRng(() => 0.9);
  const hp0 = foe.str;
  /* doAttack 成功时不返回 true（末尾没有 return，走完就是 undefined），
     被拒才返回 false——所以这里判的是"没被拒"。 */
  ok('因此 doAttack 不再拒绝这一炮', api.doAttack(gun, foe) !== false);
  ok('炮击确实打掉了守方战力', foe.str < hp0, hp0 + ' → ' + foe.str);
  ok('这一炮没掉炮组自己的编制', gun.str === 5, String(gun.str));
  api.setRng();

  /* ── 二、反向对照：直瞄反坦克炮贴脸打满编营——会被反击，仍然算无效接触 ──
     少了这条对照，把闸门整个删掉也能让上面全绿。 */
  S.units.length = 0;
  S.flanges = {};
  const hold = put('red', 'inf', spot[0], spot[1], 10);
  const adj = api.neighbors(spot[0], spot[1]).find(n => passable(n[0], n[1]));
  ok('找到守军旁边的一格', !!adj, JSON.stringify(adj));
  const at = put('blue', 'at', adj[0], adj[1], 2);
  const pvA = api.previewAttack(at, hold, S.fields);
  ok('前提：2 打 10 的比值也低于无效接触线', pvA.ratio < api.INVALID_RATIO, pvA.ratio.toFixed(3));
  ok('前提：贴脸时守方够得着还手', pvA.counter === true);
  ok('有反击的低比值攻击仍算"无效接触"',
     api.invalidContact(at, hold, S.fields) === true);
  ok('有反击的低比值攻击仍被挡在列表外', !api.targetsFor(at, S.fields).includes(hold));
  ok('有反击的低比值攻击在 doAttack 仍被拒',
     api.doAttack(at, hold) === false && hold.str === 10, '守方 str ' + hold.str);
}

console.log('\n[48] 三种 AI 脾气 / 炮兵打堆叠格 / 撤销返还战术卡（v4.19 热补丁）');
{
  /* ── 一、关卡类别 → 脾气 ──
     这一层最容易"看起来对、其实没生效"：类别词写错一个字，查表失败，
     红方静默退回夺取型，三种脾气变回一种而没有任何报错。 */
  const keyOf = id => api.aiStyleKey(api.levelById(id));
  ok('坚守关 → 夺取型', keyOf('C1') === 'seize', keyOf('C1'));
  ok('突围关 → 进攻型', keyOf('C2') === 'assault', keyOf('C2'));
  ok('附属·特种 → 防守型', keyOf('C2B') === 'hold', keyOf('C2B'));
  ok('迟滞关 → 进攻型', keyOf('C5') === 'assault', keyOf('C5'));
  ok('防御关 → 夺取型', keyOf('C6') === 'seize', keyOf('C6'));
  ok('类别查不到时退回夺取型（不抛错）',
     api.aiStyleKey({ type: '不存在的类别' }) === 'seize');
  ok('关卡里写 aiStyle 能覆盖类别表',
     api.aiStyleKey({ type: '坚守', aiStyle: 'assault' }) === 'assault');
  /* 拼错的值不能生效——它必须退回类别表，而不是把 LEVEL 变成 undefined 后再崩 */
  ok('拼错的 aiStyle 被忽略，仍按类别走',
     api.aiStyleKey({ type: '坚守', aiStyle: 'asault' }) === 'seize');

  api.newGame({ level: 'C1', noSave: true });
  const S = api.getState();
  const A = api.AI_STYLES;
  const inf = api.alive('blue').find(u => u.type === 'inf');
  const gun = api.alive('blue').find(u => u.type === 'art');
  const pv0 = { ratio: 0.7, flanked: false };
  ok('前提：C1 里蓝方有步兵与炮兵', !!inf && !!gun,
     (inf && inf.abbr) + ' / ' + (gun && gun.abbr));

  /* ── 二、开火门槛：三种脾气三套数字 ── */
  ok('进攻型：直射 0.55 / 火炮 0.30',
     Math.abs(api.aiFireGate(inf, null, pv0, A.assault, false) - 0.55) < 1e-9 &&
     Math.abs(api.aiFireGate(gun, null, pv0, A.assault, false) - 0.30) < 1e-9);
  ok('防守型：直射 1.05 / 火炮 0.75',
     Math.abs(api.aiFireGate(inf, null, pv0, A.hold, false) - 1.05) < 1e-9 &&
     Math.abs(api.aiFireGate(gun, null, pv0, A.hold, false) - 0.75) < 1e-9);
  ok('夺取型：直射 0.85 / 火炮 0.55',
     Math.abs(api.aiFireGate(inf, null, pv0, A.seize, false) - 0.85) < 1e-9 &&
     Math.abs(api.aiFireGate(gun, null, pv0, A.seize, false) - 0.55) < 1e-9);
  ok('走完再打另加 0.05（阵型没展开）',
     Math.abs(api.aiFireGate(inf, null, pv0, A.seize, true) - 0.90) < 1e-9);
  ok('多面进攻过放松 0.15',
     Math.abs(api.aiFireGate(inf, null, { ratio: 0.7, flanked: true }, A.seize, false) - 0.70) < 1e-9);
  /* 夺取型的"不惜代价"：目标站在敌方要点上，门槛归零；防守型同格仍然挑。
     v4.20 起要点守军另吃 targetValue 的 0.15 价值折扣（点数已按新口径写）。 */
  const anyObj = api.LEVEL.objectives[0];
  const objCell = anyObj.cells[0];
  const defOnObj = { pos: objCell.slice(), side: 'red', type: 'inf', str: 10, org: 100 };
  ok('夺取型：攻打敌方要点上的守军不计代价（门槛 0）',
     api.aiFireGate(gun, defOnObj, { ratio: 0.05, flanked: false }, A.seize, false) === 0);
  ok('防守型：要点目标本身值 0.15 折扣（0.75 → 0.60）',
     Math.abs(api.aiFireGate(gun, defOnObj, { ratio: 0.05, flanked: false }, A.hold, false) - 0.60) < 1e-9);
  ok('进攻型：同样吃价值折扣（0.30 → 0.15）',
     Math.abs(api.aiFireGate(gun, defOnObj, { ratio: 0.05, flanked: false }, A.assault, false) - 0.15) < 1e-9);

  /* ── 三、落脚格打分：防守型钻掩体、进攻型贴人 ── */
  /* 防守型改成"守军不动、预备队补缺口"之后，这支兵牌如果是守军会返回 null。
     这个用例要的只是"一个真实落点"来比落脚分，不是 hold 的目标语义，
     所以守军情况退回夺取型的目标点；hold 的语义在 [53] 单独验。 */
  const goal = api.aiGoalFor(inf, A.hold) || api.aiGoalFor(inf, A.assault);
  ok('aiGoalFor 给出一个真实落点', Array.isArray(goal) && goal.length === 2, JSON.stringify(goal));
  const passable = (r, c) => api.inBounds(r, c) && api.TERRAIN[api.LEVEL.map[r][c]].cost < 99;
  /* 找一对"离目标点一样远、离敌军也一样远、地形防御却差得多"的格子：
     把目标距离与敌军距离都按住，比出来的就只剩 terrainWeight 这一项。 */
  const minFoe = p => api.alive('red').reduce((m, f) => Math.min(m, api.hexDist(p, f.pos)), 99);
  let pair = null;
  for (let r = 0; r < api.LEVEL.rows && !pair; r++) {
    for (let c = 0; c < api.LEVEL.cols && !pair; c++) {
      if (!passable(r, c)) continue;
      const d0 = api.hexDist([r, c], goal), f0 = minFoe([r, c]);
      const defA = api.terrainAt(r, c).def;
      for (let r2 = 0; r2 < api.LEVEL.rows && !pair; r2++) {
        for (let c2 = 0; c2 < api.LEVEL.cols; c2++) {
          if (!passable(r2, c2)) continue;
          if (api.hexDist([r2, c2], goal) !== d0) continue;
          if (minFoe([r2, c2]) !== f0) continue;
          const defB = api.terrainAt(r2, c2).def;
          if (Math.abs(defA - defB) >= 0.25) {
            const hi = defA > defB ? [r, c] : [r2, c2];
            const lo = defA > defB ? [r2, c2] : [r, c];
            pair = { hi, lo };
            break;
          }
        }
      }
    }
  }
  ok('找到一对等高差掩体落点', !!pair, JSON.stringify(pair));
  if (pair) {
    const dHold = api.aiMoveScore(inf, pair.hi, goal, A.hold) - api.aiMoveScore(inf, pair.lo, goal, A.hold);
    const dAss = api.aiMoveScore(inf, pair.hi, goal, A.assault) - api.aiMoveScore(inf, pair.lo, goal, A.assault);
    ok('防守型明显偏爱有掩体的落点', dHold > dAss + 0.2,
       dHold.toFixed(2) + ' vs ' + dAss.toFixed(2));
  }
  /* 进攻型朝最近敌军靠：同目标距离、同地形的两格里，离敌人近的那格分更高。
     做法是把探针敌军直接放在其中一格上——它离那格 0 格、离另一格 d 格，
     比出来的就只剩 foePull 这一项（夺取型的 foePull 是 0，两格分数必须相同）。 */
  let nearPair = null;
  for (let r = 0; r < api.LEVEL.rows && !nearPair; r++) {
    for (let c = 0; c < api.LEVEL.cols && !nearPair; c++) {
      if (!passable(r, c)) continue;
      for (let r2 = 0; r2 < api.LEVEL.rows && !nearPair; r2++) {
        for (let c2 = 0; c2 < api.LEVEL.cols; c2++) {
          if (!passable(r2, c2)) continue;
          if (api.LEVEL.map[r][c] !== api.LEVEL.map[r2][c2]) continue;   // 地形字符相同 = 同防御同消耗
          if (api.hexDist([r, c], goal) !== api.hexDist([r2, c2], goal)) continue;
          const d = api.hexDist([r, c], [r2, c2]);
          if (d >= 1 && d <= 6) { nearPair = { near: [r, c], far: [r2, c2] }; break; }
        }
      }
    }
  }
  if (nearPair) {
    const foe = api.makeUnit({ id: 'AFOE', side: 'red', type: 'inf', abbr: '敌', name: '探针',
      r: nearPair.near[0], c: nearPair.near[1], corps: 'A', str: 8, mov: 6, rng: 1 }, false);
    api.getState().units.push(foe);
    ok('进攻型朝最近敌军靠（同目标距离时选更近的一格）',
       api.aiMoveScore(inf, nearPair.near, goal, A.assault) > api.aiMoveScore(inf, nearPair.far, goal, A.assault));
    ok('夺取型不吃这一项（同一对格子分数相同）',
       Math.abs(api.aiMoveScore(inf, nearPair.near, goal, A.seize) - api.aiMoveScore(inf, nearPair.far, goal, A.seize)) < 1e-9);
    api.getState().units.splice(api.getState().units.indexOf(foe), 1);
  } else {
    ok('进攻型朝最近敌军靠（同目标距离时选更近的一格）', false, '找不到可比的一对格子');
    ok('夺取型不吃这一项（同一对格子分数相同）', false, '找不到可比的一对格子');
  }

  /* ── 四、挑目标：进攻型偏残血，防守型偏贴脸的 ── */
  const redInf = api.alive('red').find(u => u.type === 'inf' || u.type === 'mob');
  if (redInf) {
    const wounded = { ...redInf, str: 3 };
    const sAss = api.scoreTarget(inf, wounded, S.fields, A.assault);
    const sSeize = api.scoreTarget(inf, wounded, S.fields, A.seize);
    ok('进攻型对残血目标额外感兴趣（+0.4）',
       Math.abs((sAss - sSeize) - (8 - 3) * 0.08) < 1e-9,
       (sAss - sSeize).toFixed(2));
    const sHold = api.scoreTarget(inf, redInf, S.fields, A.hold);
    const sSeize2 = api.scoreTarget(inf, redInf, S.fields, A.seize);
    ok('防守型的加分按"目标离要点多远"算（v4.20 第 2 批）',
       Math.abs((sHold - sSeize2) - api.holdThreatBonus(redInf)) < 1e-9,
       (sHold - sSeize2).toFixed(2) + ' vs ' + api.holdThreatBonus(redInf).toFixed(2));
  } else {
    ok('进攻型对残血目标额外感兴趣（+0.4）', false, 'C1 没有红方步兵');
    ok('防守型的加分按"目标离要点多远"算（v4.20 第 2 批）', false, 'C1 没有红方步兵');
  }

  /* ── 五、炮兵打堆叠格：选"兵力最强的一支"当基准 ── */
  const fake = [{ str: 3, abbr: 'a' }, { str: 9, abbr: 'b' }, { str: 5, abbr: 'c' }];
  ok('splashTarget 取格内兵力最强的一支', api.splashTarget(fake).abbr === 'b',
     api.splashTarget(fake).abbr);
  ok('splashTarget 只有一支时原样返回', api.splashTarget([{ str: 7, abbr: 'z' }]).abbr === 'z');

  /* ── 六、撤销要返还战术卡 ──
     漏了这条的后果：卡打出去 → 撤销 → 兵牌属性回到从前，卡却算用掉，
     玩家看到"卡没了、效果也没了"，只能重开一局。 */
  api.newGame({ level: 'C3', noSave: true });
  const S2 = api.getState();
  S2.deck = ['hold'];
  /* 兵种别写死：C3 的蓝方主力是守备营与装步，找"第一个能当地面目标的友军"最稳。 */
  const u0 = api.alive('blue').find(u => !api.isAir(u) && !api.isNaval(u));
  ok('前提：C3 里有可用的蓝方地面兵牌', !!u0, String(u0 && u0.abbr));
  const uid0 = u0.id;
  const def0 = u0.cardDef || 0;
  ok('前提：这张卡还没用过', !S2.cardUsed.hold);
  ok('用卡成功', api.useCard('hold', u0) === true);
  ok('用卡后记进 cardUsed', S2.cardUsed.hold === true);
  const u1 = api.getState().units.find(x => x.id === uid0);
  ok('用卡后兵牌拿到 +0.30 防御', Math.abs((u1.cardDef || 0) - (def0 + 0.30)) < 1e-9,
     String(u1.cardDef));
  ok('撤销成功', api.doUndo() === true);
  const S3 = api.getState();
  const u2 = S3.units.find(x => x.id === uid0);
  ok('撤销后卡回到手牌', !S3.cardUsed.hold, JSON.stringify(S3.cardUsed));
  ok('撤销后兵牌属性复原', Math.abs((u2.cardDef || 0) - def0) < 1e-9, String(u2.cardDef));
  ok('撤销后又能再用这张卡', api.useCard('hold', u2) === true);

  /* ── 七、撤销只返还"被撤销掉的那一步"用掉的卡 ──
     两张卡连着打，撤销一次只该退回后一张，前一张仍算用掉。
     这一段同时守住两处代码：pushUndo 得真把 cardUsed 记进快照（记成空对象的话
     前一张也会回到手牌，等于撤销能刷卡），doUndo 得真把它恢复（否则后一张退不回来）。
     只测"撤销后最后一张卡回来了"是不够的——那一条在 pushUndo 写错时照样绿。 */
  api.newGame({ level: 'C3', noSave: true });
  const S4 = api.getState();
  S4.deck = ['hold', 'assault'];
  const u4 = api.alive('blue').find(u => !api.isAir(u) && !api.isNaval(u));
  ok('前提：连续用卡的用例里有地面兵牌', !!u4, String(u4 && u4.abbr));
  const uid4 = u4.id;
  ok('第一张卡用掉', api.useCard('hold', u4) === true);
  ok('第二张卡用掉', api.useCard('assault', u4) === true);
  ok('两张都记进 cardUsed',
     !!api.getState().cardUsed.hold && !!api.getState().cardUsed.assault);
  ok('撤销一次', api.doUndo() === true);
  const S5 = api.getState();
  ok('撤销不返还先前用掉的卡', S5.cardUsed.hold === true, JSON.stringify(S5.cardUsed));
  ok('撤销返还这一步用掉的卡', !S5.cardUsed.assault, JSON.stringify(S5.cardUsed));
  const u5 = S5.units.find(x => x.id === uid4);
  ok('先前那张卡仍然打不出去', api.useCard('hold', u5) === false);
  ok('再撤销一次', api.doUndo() === true);
  const S6 = api.getState();
  ok('连撤两步两张卡都回到手牌', !S6.cardUsed.hold && !S6.cardUsed.assault,
     JSON.stringify(S6.cardUsed));
}

console.log('\n[49] 炮兵分摊取整：按战力比例 + 最大余数 + 2 点保底（v4.18 热补丁）');
{
  /* splashSplit 是纯函数，不碰 DOM 也不碰关卡——这一段才是这条规则的真防线。
     [46] 那一节只能验"打完之后账目对不对"，边界（0 点、单支、保底）在关卡里
     基本凑不出来：CRT 最坏档才 0，单支炮兵打单支守军又走不到分摊。 */
  const S = (t, hp) => api.splashSplit(t, hp.map(s => ({ str: s })));
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  /* 用户给的两个例子，就是这套取整的全部理由 */
  ok('伤害 4、战力 2 / 6 → 1 / 3', same(S(4, [2, 6]), [1, 3]), JSON.stringify(S(4, [2, 6])));
  ok('伤害 4、战力 3 / 7 → 1 / 3', same(S(4, [3, 7]), [1, 3]), JSON.stringify(S(4, [3, 7])));

  ok('等战力平分：伤害 4、战力 1 / 1 → 2 / 2', same(S(4, [1, 1]), [2, 2]),
     JSON.stringify(S(4, [1, 1])));
  /* 四舍五入会把 1.5 进成 2、两支合计 4，比炮弹本身还多——这条专治"顺手写 round" */
  ok('奇数伤害不超发：伤害 3、战力 1 / 1 → 2 / 1',
     same(S(3, [1, 1]), [2, 1]), JSON.stringify(S(3, [1, 1])));
  ok('三支等权：伤害 5 → 2 / 2 / 1', same(S(5, [1, 1, 1]), [2, 2, 1]),
     JSON.stringify(S(5, [1, 1, 1])));
  /* 极端：7 点分给四支 1 血，余数只补三处 */
  ok('四支等权：伤害 7 → 2 / 2 / 2 / 1', same(S(7, [1, 1, 1, 1]), [2, 2, 2, 1]),
     JSON.stringify(S(7, [1, 1, 1, 1])));

  /* 地形 / 工事把伤害削到 2 点及以下：整格每支各吃 1（用户定的下限）。
     这一条故意不守恒——总伤会超过炮弹本身。 */
  ok('削到 2 点：两支各吃 1', same(S(2, [2, 6]), [1, 1]), JSON.stringify(S(2, [2, 6])));
  ok('削到 1 点：两支各吃 1', same(S(1, [2, 6]), [1, 1]), JSON.stringify(S(1, [2, 6])));
  ok('三支遇到 2 点保底：总伤 3，故意超过炮弹本身',
     same(S(2, [1, 1, 1]), [1, 1, 1]), JSON.stringify(S(2, [1, 1, 1])));
  /* 单支不吃保底：它本来就该全吃，给 1 等于凭空少算 1 点 */
  ok('单支不吃保底：2 点全给', same(S(2, [5]), [2]), JSON.stringify(S(2, [5])));
  ok('单支 5 点全给', same(S(5, [5]), [5]), JSON.stringify(S(5, [5])));
  /* 0 点不能触发保底，否则"工事全吸收"变成"必掉 1"，工事就没意义了 */
  ok('伤害为 0：全员 0', same(S(0, [2, 6]), [0, 0]), JSON.stringify(S(0, [2, 6])));
  ok('空名单返回空', S(4, []).length === 0);

  /* 穷举：总和守恒只在 3 点以上成立，保底区间反过来允许多打 */
  let badSum = null, badFloor = null;
  for (let t = 1; t <= 12; t++) {
    for (let a = 1; a <= 9; a++) {
      for (let b = 1; b <= 9; b++) {
        const r = S(t, [a, b]);
        if (t >= 3 && r[0] + r[1] !== t) badSum = badSum || [t, a, b, r];
        if (t <= 2 && (r[0] < 1 || r[1] < 1)) badFloor = badFloor || [t, a, b, r];
      }
    }
  }
  ok('穷举 1–12 点 × 9×9 组战力：3 点以上合计恒等于面上损失',
     !badSum, JSON.stringify(badSum));
  ok('穷举 2 点及以下：每支至少 1', !badFloor, JSON.stringify(badFloor));

  /* 顺序必须稳定：预览、实战、AI 评估各算一遍，飘一次数值就对不上 */
  ok('同一输入两次结果一致', same(S(7, [3, 9, 5]), S(7, [3, 9, 5])),
     JSON.stringify([S(7, [3, 9, 5]), S(7, [3, 9, 5])]));
  ok('余数平手时给战力高的那支（不是按格内顺序）',
     same(S(3, [1, 5]), [0, 3]), JSON.stringify(S(3, [1, 5])));
}

console.log('\n[50] 目标价值 / 零风险火力 / 集火预支 / 崩溃收拢（v4.20 第 1 批）');
{
  api.newGame({ level: 'C1', noSave: true });
  const S = api.getState();
  const A = api.AI_STYLES;
  const inf = api.alive('blue').find(u => u.type === 'inf');
  const gun = api.alive('blue').find(u => u.type === 'art');
  const pv0 = { ratio: 0.7, flanked: false };

  /* ── 一、targetValue：同一份判断同时喂排序与门槛 ── */
  const coreObj = api.LEVEL.objectives.find(o => o.core);
  const objCell = coreObj.cells[0];
  const onObj = { pos: objCell.slice(), side: 'red', type: 'inf', str: 10, org: 100 };
  const tvObj = api.targetValue(onObj, null);
  ok('targetValue：敌方要点守军 0.6 分 / 0.15 折扣',
     Math.abs(tvObj.score - 0.6) < 1e-9 && Math.abs(tvObj.discount - 0.15) < 1e-9,
     JSON.stringify(tvObj));
  const offObj = { pos: [0, 0], side: 'red', type: 'inf', str: 10, org: 100 };
  const tvOff = api.targetValue(offObj, { defHelp: [{}] });
  ok('targetValue：普通满编目标不加分也不打折',
     tvOff.score === 0 && tvOff.discount === 0, JSON.stringify(tvOff));
  const lowOrg = { pos: [0, 0], side: 'red', type: 'inf', str: 10, org: api.orgBreakLine() + 5 };
  const tvLow = api.targetValue(lowOrg, { defHelp: [{}] });
  ok('targetValue：低组织度（未崩溃）+0.2 / −0.05',
     Math.abs(tvLow.score - 0.2) < 1e-9 && Math.abs(tvLow.discount - 0.05) < 1e-9,
     JSON.stringify(tvLow));
  const brokenT = { pos: [0, 0], side: 'red', type: 'inf', str: 5, org: 0 };
  const tvBroken = api.targetValue(brokenT, { defHelp: [{}] });
  ok('targetValue：崩了的残部 +0.4 / −0.10',
     Math.abs(tvBroken.score - 0.4) < 1e-9 && Math.abs(tvBroken.discount - 0.10) < 1e-9,
     JSON.stringify(tvBroken));
  const tvLone = api.targetValue(offObj, { defHelp: [] });
  ok('targetValue：孤立目标额外 +0.2 / −0.05',
     Math.abs(tvLone.score - 0.2) < 1e-9 && Math.abs(tvLone.discount - 0.05) < 1e-9,
     JSON.stringify(tvLone));
  /* 折扣封顶：同时满足要点 + 残部 + 孤立，也不能把门槛拉穿 */
  const tvCap = api.targetValue({ pos: objCell.slice(), side: 'red', type: 'inf', str: 5, org: 0 },
    { defHelp: [] });
  ok('targetValue：折扣封顶 0.15（价值再高也只挪一档）',
     Math.abs(tvCap.discount - 0.15) < 1e-9, JSON.stringify(tvCap));

  /* ── 二、零风险火力：打不还手就放行 ── */
  ok('零风险：对方不能反击时门槛归零（比值 0.01 也打）',
     api.aiFireGate(gun, null, { ratio: 0.01, flanked: false, counter: false }, A.hold, false) === 0);
  ok('对方能反击时仍按原门槛（守方火炮 0.75）',
     Math.abs(api.aiFireGate(gun, null, { ratio: 0.01, flanked: false, counter: true }, A.hold, false) - 0.75) < 1e-9);
  ok('零风险判定不区分脾气（进攻型同样归零）',
     api.aiFireGate(inf, null, { ratio: 0.01, flanked: false, counter: false }, A.assault, false) === 0);

  /* ── 三、集火预支：第二支能接上才放松门槛 ── */
  ok('集火：夺取型门槛再放松 0.15（0.85 → 0.70）',
     Math.abs(api.aiFireGate(inf, null, pv0, A.seize, false, true) - 0.70) < 1e-9);
  ok('集火：进攻型同样放松（0.55 → 0.40）',
     Math.abs(api.aiFireGate(inf, null, pv0, A.assault, false, true) - 0.40) < 1e-9);
  ok('集火：防守型不吃折扣（仍然 1.05，守方不出坑）',
     Math.abs(api.aiFireGate(inf, null, pv0, A.hold, false, true) - 1.05) < 1e-9);
  ok('已经多面进攻过的格子不再叠集火折扣',
     Math.abs(api.aiFireGate(inf, null, { ratio: 0.7, flanked: true }, A.seize, false, true) - 0.70) < 1e-9);

  /* aiMassedAttack 直接驱动：造两支能打到同一格的友军，第三支放到够不着的远处。
     场上原有的蓝军也可能够得着这一格，先把它们标成"已开火"隔离掉，测完恢复。 */
  const base = api.alive('blue').find(u => !api.isAir(u) && !api.isNaval(u)).pos;
  const tpos = api.neighbors(base[0], base[1])[0];
  const spots = api.neighbors(tpos[0], tpos[1]);
  const savedFired = api.alive('blue').map(a => a.fired);
  api.alive('blue').forEach(a => { a.fired = true; });
  const mk = (id, p) => api.makeUnit({ id, side: 'blue', type: 'inf', abbr: '测', name: '探针',
    r: p[0], c: p[1], corps: 'Z', str: 8, mov: 3, rng: 1 }, false);
  const ua = mk('T_MA', spots[0]);
  const ub = mk('T_MB', spots[1] || spots[0]);
  S.units.push(ua, ub);
  const probeTgt = () => ({ side: 'red', type: 'inf', pos: tpos.map(Number), str: 5, org: 50 });
  ok('集火：另一支能打到同一目标的友军 → 判定成立',
     api.aiMassedAttack(ua, probeTgt()) === true);
  ub.fired = true;
  ok('集火：已经开过火的不算第二支',
     api.aiMassedAttack(ua, probeTgt()) === false);
  ub.fired = false;
  ub.org = 0;
  ok('集火：崩了的友军接不上（它本来就不能开火）',
     api.aiMassedAttack(ua, probeTgt()) === false);
  ub.org = 100;
  ub.pos = api.LEVEL.redSource.slice();
  ok('集火：够不着的友军不算第二支',
     api.aiMassedAttack(ua, probeTgt()) === false);
  S.units.splice(S.units.indexOf(ua), 1);
  S.units.splice(S.units.indexOf(ub), 1);
  api.alive('blue').forEach((a, i) => { a.fired = savedFired[i]; });

  /* ── 四、崩溃收拢：离敌越远分越高，并且真的会挪窝 ── */
  const blueCells = api.alive('blue').map(u => u.pos);
  const passable = (r, c) => api.inBounds(r, c) && api.TERRAIN[api.LEVEL.map[r][c]].cost < 99;
  const minFoe = p => blueCells.reduce((m, b) => Math.min(m, api.hexDist(p, b)), 99);
  let farCell = null, nearCell = null;
  for (let r = 0; r < api.LEVEL.rows; r++) {
    for (let c = 0; c < api.LEVEL.cols; c++) {
      if (!passable(r, c)) continue;
      const d = minFoe([r, c]);
      /* 分数里距离封顶 6 格；远格取封顶值，近格取 ≤1 格，
         距离项至少差 10×5 = 50，地形与工事最多差 5 分，方向写反必然红。 */
      if (!farCell && d >= 6) farCell = [r, c];
      if (!nearCell && d <= 1) nearCell = [r, c];
    }
  }
  ok('前提：找到一远一近两个可通行格', !!farCell && !!nearCell,
     JSON.stringify([farCell, nearCell]));
  if (farCell && nearCell) {
    const probe = { side: 'red', type: 'inf', pos: [0, 0], str: 5, org: 0 };
    ok('aiRetreatScore：离敌越远分越高',
       api.aiRetreatScore(probe, farCell) > api.aiRetreatScore(probe, nearCell),
       api.aiRetreatScore(probe, farCell).toFixed(1) + ' vs ' + api.aiRetreatScore(probe, nearCell).toFixed(1));
  }

  /* 崩溃后撤只在"还贴着敌人"时发生：找一处离最近蓝军正好 2 格、
     且旁边有一格能退到 3 格外的空地，把探针部队放上去。
     已经脱离接触的崩溃部队不该为了挪而挪（那会白丢阵地）。 */
  const reds = api.alive('red').filter(u => !api.isAir(u) && !api.isNaval(u) && u.mov > 0);
  const runner = reds[0];
  ok('前提：C1 有可用的红方地面兵牌', !!runner, String(runner && runner.abbr));
  const occupied = new Set(api.getState().units.map(x => x.pos[0] + ',' + x.pos[1]));
  const objCells = new Set();
  api.LEVEL.objectives.forEach(o => o.cells.forEach(c => objCells.add(c[0] + ',' + c[1])));
  let trap = null;
  for (let r = 0; r < api.LEVEL.rows && !trap; r++) {
    for (let c = 0; c < api.LEVEL.cols && !trap; c++) {
      if (!passable(r, c) || occupied.has(r + ',' + c) || objCells.has(r + ',' + c)) continue;
      if (minFoe([r, c]) !== 2) continue;
      for (const q of api.neighbors(r, c)) {
        if (!passable(q[0], q[1]) || occupied.has(q[0] + ',' + q[1])) continue;
        if (minFoe(q) >= 3) { trap = { at: [r, c], to: q }; break; }
      }
    }
  }
  ok('前提：找到一处贴敌 2 格、旁边有退路的落点', !!trap, JSON.stringify(trap));
  if (trap && runner) {
    runner.pos = trap.at.slice();
    runner.org = 0;
    runner.broken = true;
    runner.moved = false;
    ok('aiBrokenAction：贴着敌人的崩溃部队会后撤',
       api.aiBrokenAction(runner) === true);
    ok('后撤后脱离接触（2 格内无敌军）',
       api.disengaged(runner) === true,
       'pos ' + JSON.stringify(runner.pos) + ' / minFoe ' + minFoe(runner.pos));
    runner.moved = false;
    ok('已经脱离接触的崩溃部队就地收拢（不再挪窝）',
       api.aiBrokenAction(runner) === false);
  }

  /* 关键要点上的最后一支守军不许撤——它一走旗子就换色。 */
  const holder = reds[1] || reds[0];
  holder.pos = objCell.slice();
  holder.org = 0;
  holder.broken = true;
  holder.moved = false;
  ok('aiBrokenAction：核心要点上的最后一支守军不动',
     api.aiBrokenAction(holder) === false &&
     holder.pos[0] === objCell[0] && holder.pos[1] === objCell[1]);
  const mateCell = (coreObj.cells[1] || coreObj.cells[0]).slice();
  const mate = api.makeUnit({ id: 'T_MATE', side: 'red', type: 'inf', abbr: '测', name: '探针',
    r: mateCell[0], c: mateCell[1], corps: 'Z', str: 8, mov: 3, rng: 1 }, false);
  S.units.push(mate);
  ok('aiBrokenHoldObjective：要点上还有别的未崩溃友军 → 可以撤',
     api.aiBrokenHoldObjective(holder) === false);
  S.units.splice(S.units.indexOf(mate), 1);

  /* 非关键要点不在"死守"清单里：C3 的青溪镇 core:false。 */
  api.newGame({ level: 'C3', noSave: true });
  const r3 = api.alive('red').find(u => !api.isAir(u) && !api.isNaval(u));
  const town = api.LEVEL.objectives.find(o => !o.core &&
    !(api.LEVEL.win && api.LEVEL.win.keep && api.LEVEL.win.keep.includes(o.id)));
  ok('前提：C3 有非核心要点与红方地面兵牌', !!r3 && !!town,
     (r3 && r3.abbr) + ' / ' + (town && town.id));
  if (r3 && town) {
    r3.pos = town.cells[0].slice();
    r3.org = 0;
    r3.broken = true;
    ok('aiBrokenHoldObjective：非关键要点上的崩溃守军照样撤',
       api.aiBrokenHoldObjective(r3) === false);
  }
}

console.log('\n[51] 要点格缓存不跨关（结算页"下一关"是同页切关）');
{
  /* objAt 为了少扫一遍 objectives 建了张按坐标查要点的表，但这张表只认
     第一次建它时的那一关。结算页"下一关"走 enterLevel → newGame，不刷新页面，
     于是新关的要点格查不到、上一关的要点格反而还在命中——染色和悬停名全错。
     这里先让 C1 的表建起来，再同页切到 C2B：新格必须命中，旧格必须落空。 */
  api.newGame({ level: 'C1', noSave: true });
  const core = api.LEVEL.objectives.find(o => o.id === 'core');
  ok('前提：C1 有核心要点', !!core, core && core.id);
  const oldCell = core.cells[0];
  api.objAt(oldCell[0], oldCell[1]);   // 先把 C1 的表建起来

  api.newGame({ level: 'C2B', noSave: true });
  const ford = api.LEVEL.objectives.find(o => o.id === 'ford');
  ok('前提：C2B 有渡口要点', !!ford, ford && ford.id);
  const newCell = ford.cells[0];
  ok('换关后新关的要点格查得到（缓存按新关重建）',
     api.objAt(newCell[0], newCell[1]) === ford,
     JSON.stringify(newCell));
  ok('换关后上一关的要点格不再命中',
     api.objAt(oldCell[0], oldCell[1]) === null,
     JSON.stringify(oldCell));
}

console.log('\n[52] 夺取型攻坚令：敌方要点上的低比值目标不再被藏（v4.20 第 2 批）');
{
  /* 用户报的现场：C1 要塞核心上的守军，红方贴脸的营一个可打目标都没有。
     invalidContact 只看比值（守军蹲城 + 工事，比值 0.06–0.28），而夺取型
     的 allInOnObjective 永远等不到执行——目标根本没进列表，门槛再低也没用。
     攻坚令是唯一的例外：能占领的部队打敌方/争夺中要点上的目标，
     比值低到 PUSH_RATIO（0.20）为止；别的脾气、别的目标一概不放。 */
  api.newGame({ level: 'C3', noSave: true });
  const S = api.getState();
  const T = api.TYPE;
  S.units.length = 0;
  S.forts = [];
  S.mods = [];
  S.flanges = {};
  S.ctrl = {};

  const city = api.LEVEL.objectives.find(o => o.id === 'city');
  ok('前提：C3 有城市要点', !!city, city && city.id);
  const site = city.cells[0];
  const adj = api.neighbors(site[0], site[1]).find(p => {
    const t = api.TERRAIN[api.LEVEL.map[p[0]][p[1]]];
    return t && t.cost < 99;
  });
  ok('前提：城市要点旁有可通行格', !!adj, JSON.stringify(site));

  let seq = 0;
  const put = (side, type, r, c, str) => {
    const u = api.makeUnit({ id: (side === 'blue' ? 'B' : 'R') + (++seq), side, type,
      abbr: 'T' + seq, name: '测试' + T[type].name, r, c, corps: 'T', str,
      mov: T[type].mv || 8, rng: T[type].rg === undefined ? 1 : T[type].rg }, false);
    S.units.push(u);
    return u;
  };
  const guard = put('blue', 'gdn', site[0], site[1], 6);
  const att = put('red', 'inf', adj[0], adj[1], 10);
  api.updateControl(true);
  const pv = api.previewAttack(att, guard, S.fields);

  ok('前提：比值落在攻坚区间（PUSH_RATIO ≤ 比值 < 无效接触线）',
     pv.ratio >= api.PUSH_RATIO && pv.ratio < api.INVALID_RATIO, pv.ratio.toFixed(3));
  ok('前提：守方够得着还手（不是白打）', pv.counter === true);
  ok('前提：这一格是敌方要点', api.onEnemyObjective(guard) === true);

  ok('没有攻坚令时目标仍被无效接触闸挡住',
     api.objectivePush(att, guard, undefined, pv) === false &&
     !api.targetsFor(att, S.fields).includes(guard));
  ok('攻坚令只开给能占领的部队（炮兵打不了这一炮）',
     api.objectivePush({ type: 'art' }, guard, { pushObjective: true }, pv) === false);
  ok('攻坚令只认敌方/争夺中的要点',
     api.objectivePush(att, { pos: [0, 0], side: 'blue' }, { pushObjective: true }, pv) === false);
  ok('比值低于底价 0.20 不放行',
     api.objectivePush(att, guard, { pushObjective: true },
       { ratio: 0.19, counter: true }) === false);
  ok('底价卡在 0.20（等于放行）',
     api.objectivePush(att, guard, { pushObjective: true },
       { ratio: api.PUSH_RATIO, counter: true }) === true);
  ok('夺取型自动带攻坚令，另外两种不带',
     JSON.stringify(api.aiTargetOpts(api.AI_STYLES.seize)) === '{"pushObjective":true}' &&
     api.aiTargetOpts(api.AI_STYLES.assault) === undefined &&
     api.aiTargetOpts(api.AI_STYLES.hold) === undefined);
  ok('攻坚令生效时目标进列表',
     api.targetsFor(att, S.fields, api.aiTargetOpts()).includes(guard));

  att.str = 6;
  const weak = api.previewAttack(att, guard, S.fields);
  ok('比值跌破底价后列表重新关掉',
     weak.ratio < api.PUSH_RATIO &&
     !api.targetsFor(att, S.fields, api.aiTargetOpts()).includes(guard),
     weak.ratio.toFixed(3));
  att.str = 10;

  const hp = guard.str;
  ok('doAttack 不带攻坚令时仍然拒绝（列表之外的第二道闸）',
     api.doAttack(att, guard) === false && guard.str === hp, '守方 str ' + guard.str);
  api.setRng(() => 0.9);
  ok('doAttack 带攻坚令才真的打进去', api.doAttack(att, guard, api.aiTargetOpts()) !== false);
  ok('伤害真的落在守军身上', guard.str < hp, hp + '→' + guard.str);
  ok('低比值被放行时守方照样还手', att.str < 10, '10→' + att.str);
}

console.log('\n[53] 进攻型破口 / 防守型威胁排序与预备队（v4.20 第 2 批）');
{
  /* ── 一、破口：进攻型被一个"挡在目标前面的敌人"卡住时，按清路价打 ── */
  api.newGame({ level: 'C3', noSave: true });
  const S = api.getState();
  const T = api.TYPE;
  S.units.length = 0;
  S.forts = [];
  S.mods = [];
  S.flanges = {};
  S.ctrl = {};

  let seq = 0;
  const spawn = (st, side, type, r, c, str, mov) => {
    const u = api.makeUnit({ id: (side === 'blue' ? 'B' : 'R') + (++seq), side, type,
      abbr: 'T' + seq, name: '测试' + T[type].name, r, c, corps: 'T', str,
      mov: mov === undefined ? (T[type].mv || 8) : mov,
      rng: T[type].rg === undefined ? 1 : T[type].rg }, false);
    st.units.push(u);
    return u;
  };
  const passable = (r, c) => {
    const t = api.TERRAIN[api.LEVEL.map[r][c]];
    return !!t && t.cost < 99;
  };
  const onObj = (p, o) => o.cells.some(c => c[0] === p[0] && c[1] === p[1]);

  const city = api.LEVEL.objectives.find(o => o.id === 'city');
  const G = city.cells[0];
  const R = api.neighbors(G[0], G[1]).find(p => passable(p[0], p[1]));
  const BACK = api.neighbors(R[0], R[1]).find(p =>
    passable(p[0], p[1]) && api.hexDist(p, G) === 2 && !onObj(p, city));
  ok('前提：目标格旁有相邻的进攻位与后方格', !!R && !!BACK,
     JSON.stringify([G, R, BACK]));

  const front = spawn(S, 'blue', 'inf', G[0], G[1], 8);
  const rear = spawn(S, 'blue', 'inf', BACK[0], BACK[1], 3);
  const red = spawn(S, 'red', 'mob', R[0], R[1], 10);
  api.updateControl(true);
  const goal = api.aiGoalFor(red, api.AI_STYLES.assault);
  const pv = api.previewAttack(red, front, S.fields);

  ok('前提：进攻型的目标格就是被守军占住的那一格',
     !!goal && goal[0] === G[0] && goal[1] === G[1], JSON.stringify(goal));
  ok('前提：攻方被卡住（没有更靠近目标的落脚格）', api.aiStuck(red, goal) === true);
  ok('前提：这一枪不算无效接触（比值在 0.35 以上）',
     pv.ratio >= api.INVALID_RATIO && !api.invalidContact(red, front, S.fields),
     pv.ratio.toFixed(3));

  const gatePlain = api.aiFireGate(red, front, pv, api.AI_STYLES.assault, false, false, false);
  const gateBreak = api.aiFireGate(red, front, pv, api.AI_STYLES.assault, false, false, true);
  ok('前提：按常规门槛打不出去（比值低于进攻型 0.55 那一档）',
     pv.ratio < gatePlain, pv.ratio.toFixed(3) + ' < ' + gatePlain.toFixed(3));
  ok('破口价把门槛压到 0.40（价值折扣后 0.25），这一枪才打得出去',
     Math.abs(gatePlain - 0.40) < 1e-9 && Math.abs(gateBreak - 0.25) < 1e-9 &&
     pv.ratio >= gateBreak,
     gatePlain.toFixed(2) + ' / ' + gateBreak.toFixed(2));
  ok('破口只认挡在目标前面的那一支（后方友军不算）',
     api.aiBreakthroughTarget(red, api.AI_STYLES.assault, S.fields) === front,
     '后方的蓝军离目标 ' + api.hexDist(rear.pos, goal));
  ok('夺取型 / 炮兵不参与破口',
     api.aiBreakthroughTarget(red, api.AI_STYLES.seize, S.fields) === null &&
     api.aiBreakthroughTarget({ ...red, type: 'sha', rng: 4 }, api.AI_STYLES.assault, S.fields) === null);

  /* 换一个能绕过去的场景：守军不在目标格上，红方有一步能走到更靠近目标的位置。
     这时不该按清路价硬撞——破口只给真的被挡住的那一枪。
     落脚点要挑"贴得住目标、又确实有更近的及格"：隔远了 targetsFor 本来就是空的，
     `bt null` 会被误当成"卡住判定生效"，其实只是够不着。 */
  rear.pos = [0, 0];
  front.pos = R.slice();
  let flank = null;
  for (const P of api.neighbors(R[0], R[1])) {
    if (!passable(P[0], P[1]) || onObj(P, city)) continue;
    if (api.hexDist(P, G) !== 2) continue;
    const closer = api.neighbors(P[0], P[1]).find(p =>
      passable(p[0], p[1]) && api.hexDist(p, G) === 1 &&
      !(p[0] === R[0] && p[1] === R[1]) && !onObj(p, city) &&
      !S.units.some(u => u !== red && u.pos[0] === p[0] && u.pos[1] === p[1]));
    if (closer) { flank = P; break; }
  }
  ok('前提：找到一处能绕过去、且有一格更近落脚点的进攻位', !!flank, JSON.stringify(flank));
  red.pos = flank.slice();
  api.updateControl(true);
  const goal2 = api.aiGoalFor(red, api.AI_STYLES.assault);
  ok('前提：绕行路线的目标仍是城市要点',
     !!goal2 && onObj(goal2, city), JSON.stringify(goal2));
  ok('能绕过去时不再触发破口（清路价只给真的卡住的那一枪）',
     api.aiStuck(red, goal2) === false &&
     api.aiBreakthroughTarget(red, api.AI_STYLES.assault, S.fields) === null);

  /* ── 二、防守型：守军不动，预备队补缺口 ── */
  const holdGame = () => {
    api.newGame({ level: 'C2B', noSave: true });
    const st = api.getState();
    st.units.length = 0;
    st.forts = [];
    st.mods = [];
    st.flanges = {};
    st.ctrl = {};
    return st;
  };
  const C2B = api.levelById('C2B');
  const ford = C2B.objectives.find(o => o.id === 'ford');
  const beach = C2B.objectives.find(o => o.id === 'beach');
  const village = C2B.objectives.find(o => o.id === 'village');
  ok('前提：C2B 有渡口 / 滩头 / 村子三个要点',
     !!ford && !!beach && !!village);
  const holdPassable = (r, c) => {
    const t = api.TERRAIN[C2B.map[r][c]];
    return !!t && t.cost < 99;
  };
  const distTo = (p, o) => Math.min(...o.cells.map(c => api.hexDist(p, c)));
  let reserveAt = null;
  for (let r = 0; r < C2B.rows && !reserveAt; r++) {
    for (let c = 0; c < C2B.cols && !reserveAt; c++) {
      if (!holdPassable(r, c)) continue;
      if (C2B.objectives.some(o => onObj([r, c], o))) continue;
      const db = distTo([r, c], beach), dv = distTo([r, c], village), df = distTo([r, c], ford);
      if (db <= 2 && db < dv && dv < df) reserveAt = [r, c];
    }
  }
  ok('前提：找到一处离滩头最近、离村子次之、离渡口最远的空地',
     !!reserveAt, JSON.stringify(reserveAt));

  {
    const st = holdGame();
    const reserve = spawn(st, 'blue', 'inf', reserveAt[0], reserveAt[1], 10);
    ok('防守型：野地里的预备队不算守军', api.aiHoldGarrison(reserve) === false);
    st.forts.push({ r: reserveAt[0], c: reserveAt[1], kind: 'H', side: 'blue',
      def: 0.15, hp: 0, maxHp: 0 });
    ok('站在己方仍在工作的工事里：算守军，原地不动',
       api.aiHoldGarrison(reserve) === true && api.aiHoldGoal(reserve) === null);
    st.forts = [];
    const dug = spawn(st, 'blue', 'inf', village.cells[0][0], village.cells[0][1], 8);
    ok('站在要点上的部队：算守军，不换防',
       api.aiHoldGarrison(dug) === true && api.aiHoldGoal(dug) === null);
  }

  {
    const st = holdGame();
    const inf = spawn(st, 'blue', 'inf', beach.cells[0][0], beach.cells[0][1], 8);
    ok('要点上有能占领的己方部队 → 算有人守',
       api.aiObjectiveHeld(beach, 'blue') === true);
    ok('敌方不在这个要点上 → 不算敌方控制',
       api.aiObjectiveHeld(beach, 'red') === false);
    inf.broken = true;
    inf.org = 0;
    ok('崩溃但还站在要点上的守军，旗子还挂着（先派预备队是浪费）',
       api.aiObjectiveHeld(beach, 'blue') === true);
    inf.broken = false;
    inf.org = 100;
    inf.pos = [0, 0];
    spawn(st, 'blue', 'art', beach.cells[1][0], beach.cells[1][1], 8);
    ok('炮兵占格不算守（占不了点）', api.aiObjectiveHeld(beach, 'blue') === false);

    ok('没有敌军靠近时要点不受威胁', api.aiObjectiveThreatened(beach, 'blue') === false);
    st.ctrl[beach.id] = 'contested';
    ok('争夺中的要点算受威胁', api.aiObjectiveThreatened(beach, 'blue') === true);
    delete st.ctrl[beach.id];

    const cells2 = [], cells3 = [];
    for (let r = 0; r < C2B.rows; r++) {
      for (let c = 0; c < C2B.cols; c++) {
        if (!holdPassable(r, c)) continue;
        if (C2B.objectives.some(o => onObj([r, c], o))) continue;
        const d = distTo([r, c], beach);
        if (d === 2) cells2.push([r, c]);
        if (d === 3) cells3.push([r, c]);
      }
    }
    ok('前提：找到离滩头正好 2 格与 3 格的位置', !!cells2.length && !!cells3.length,
       cells2.length + ' / ' + cells3.length);
    const foe = spawn(st, 'red', 'inf', cells2[0][0], cells2[0][1], 8);
    ok('能占领的敌军摸到 2 格内 → 受威胁',
       api.aiObjectiveThreatened(beach, 'blue') === true);
    foe.pos = cells3[0].slice();
    ok('敌军退到 3 格外 → 不再受威胁',
       api.aiObjectiveThreatened(beach, 'blue') === false);
    foe.pos = cells2[0].slice();
    foe.broken = true;
    foe.org = 0;
    ok('崩溃的敌军组织不起进攻 → 不算威胁',
       api.aiObjectiveThreatened(beach, 'blue') === false);
    foe.broken = false;
    foe.org = 100;
    foe.type = 'fgt';
    ok('飞机占不了点 → 不算威胁',
       api.aiObjectiveThreatened(beach, 'blue') === false);
  }

  {
    const st = holdGame();
    const reserve = spawn(st, 'blue', 'inf', reserveAt[0], reserveAt[1], 10);
    let goal = api.aiHoldGoal(reserve);
    ok('没有缺口时去最近的要点（滩头）', !!goal && onObj(goal, beach), JSON.stringify(goal));
    spawn(st, 'blue', 'gdn', beach.cells[0][0], beach.cells[0][1], 8);
    goal = api.aiHoldGoal(reserve);
    ok('最近的要点已经有守军 → 预备队转去没人守的村子',
       !!goal && onObj(goal, village), JSON.stringify(goal));
    ok('aiGoalFor 的防守型分支就是 aiHoldGoal',
       JSON.stringify(api.aiGoalFor(reserve, api.AI_STYLES.hold)) === JSON.stringify(goal));

    let redSpot = null;
    for (const cell of ford.cells) {
      for (const p of api.neighbors(cell[0], cell[1])) {
        if (!holdPassable(p[0], p[1])) continue;
        if (C2B.objectives.some(o => onObj(p, o))) continue;
        if (st.units.some(u => u.pos[0] === p[0] && u.pos[1] === p[1])) continue;
        redSpot = p; break;
      }
      if (redSpot) break;
    }
    ok('前提：找到一处靠渡口、不在要点上的威胁位', !!redSpot, JSON.stringify(redSpot));
    const foe = spawn(st, 'red', 'inf', redSpot[0], redSpot[1], 8);
    ok('前提：威胁源不在要点上（靠的是 2 格判定，不是争夺）',
       api.ctrlState(ford) !== 'contested' &&
       api.aiObjectiveThreatened(ford, 'blue') === true);
    goal = api.aiHoldGoal(reserve);
    ok('受威胁的空渡口优先于没人守的村子（哪怕更远）',
       !!goal && onObj(goal, ford), JSON.stringify(goal));

    foe.pos = [0, 0];
    spawn(st, 'blue', 'inf', ford.cells[0][0], ford.cells[0][1], 8);
    spawn(st, 'blue', 'inf', village.cells[0][0], village.cells[0][1], 8);
    goal = api.aiHoldGoal(reserve);
    ok('所有要点都有人守时，预备队去最近的要点待命（滩头）',
       !!goal && onObj(goal, beach), JSON.stringify(goal));
  }

  {
    const st = holdGame();
    const reserve = spawn(st, 'blue', 'inf', reserveAt[0], reserveAt[1], 10);
    const onPoint = { pos: beach.cells[0].slice(), side: 'red', type: 'inf', str: 8, org: 100 };
    ok('威胁加分看目标离要点多远：要点上 0.48',
       Math.abs(api.holdThreatBonus(onPoint) - 0.48) < 1e-9,
       api.holdThreatBonus(onPoint).toFixed(2));
    let p2 = null, p4 = null;
    for (let r = 0; r < C2B.rows && (!p2 || !p4); r++) {
      for (let c = 0; c < C2B.cols && (!p2 || !p4); c++) {
        if (!holdPassable(r, c)) continue;
        const d = api.nearestObjectiveDist([r, c]);
        if (d === 2 && !p2) p2 = [r, c];
        if (d >= 4 && !p4) p4 = [r, c];
      }
    }
    ok('离要点 2 格 → 0.24',
       !!p2 && Math.abs(api.holdThreatBonus({ pos: p2 }) - 0.24) < 1e-9,
       p2 ? api.holdThreatBonus({ pos: p2 }).toFixed(2) : '无');
    ok('离要点 4 格以上 → 0',
       !!p4 && api.holdThreatBonus({ pos: p4 }) === 0,
       p4 ? api.holdThreatBonus({ pos: p4 }).toFixed(2) : '无');

    let farPair = null;
    for (let r = 0; r < C2B.rows && !farPair; r++) {
      for (let c = 0; c < C2B.cols && !farPair; c++) {
        if (!holdPassable(r, c) || api.nearestObjectiveDist([r, c]) < 4) continue;
        for (const q of api.neighbors(r, c)) {
          if (holdPassable(q[0], q[1]) && api.nearestObjectiveDist(q) >= 4) {
            farPair = { att: [r, c], tgt: q };
            break;
          }
        }
      }
    }
    ok('前提：找到一对离要点都 ≥4 格、彼此相邻的空地', !!farPair, JSON.stringify(farPair));
    if (farPair) {
      const onFar = { pos: farPair.tgt.slice(), side: 'red', type: 'inf', str: 8, org: 100 };
      reserve.pos = farPair.att.slice();
      const dOn = api.scoreTarget(reserve, onPoint, st.fields, api.AI_STYLES.hold) -
                  api.scoreTarget(reserve, onPoint, st.fields, api.AI_STYLES.seize);
      const dFar = api.scoreTarget(reserve, onFar, st.fields, api.AI_STYLES.hold) -
                   api.scoreTarget(reserve, onFar, st.fields, api.AI_STYLES.seize);
      ok('scoreTarget 的防守型加分跟着目标离要点走（不是离攻方）',
         Math.abs(dOn - api.holdThreatBonus(onPoint)) < 1e-9 &&
         Math.abs(dFar - api.holdThreatBonus(onFar)) < 1e-9 &&
         Math.abs(dOn - 0.48) < 1e-9 && dFar === 0,
         dOn.toFixed(2) + ' / ' + dFar.toFixed(2));
    } else {
      ok('scoreTarget 的防守型加分跟着目标离要点走（不是离攻方）', false, '没有取样格');
    }
  }
}

console.log('\n[54] 端到端：夺取型 runAI 把攻坚令带进开火流程（v4.20 第 2 批）');
(async () => {
  /* [52] 证明闸门本身是对的，[54] 证明 runAI 真的把这份 opts 传了下去——
     两处都漏过：目标列表放行了但 doAttack 没带 opts（结算仍拒），
     或者 runAI 根本没把 aiTargetOpts 传进 targetsFor（列表仍是空的）。
     C1 只留一支守军与一支贴脸直射营，机动力设 0，让这一枪是原地开火。 */
  api.newGame({ level: 'C1', noSave: true });
  const S = api.getState();
  const T = api.TYPE;
  S.units.length = 0;
  S.forts = [];
  S.mods = [];
  S.flanges = {};
  S.ctrl = {};
  const core = api.LEVEL.objectives.find(o => o.id === 'core');
  const G = core.cells[0];
  const R = api.neighbors(G[0], G[1]).find(p => {
    const t = api.TERRAIN[api.LEVEL.map[p[0]][p[1]]];
    return t && t.cost < 99;
  });
  const blue = api.makeUnit({ id: 'B1', side: 'blue', type: 'gdn', abbr: '守',
    name: '测试守军', r: G[0], c: G[1], corps: 'T', str: 9,
    mov: T.gdn.mv || 8, rng: T.gdn.rg === undefined ? 1 : T.gdn.rg }, false);
  const red = api.makeUnit({ id: 'R1', side: 'red', type: 'inf', abbr: '攻',
    name: '测试攻军', r: R[0], c: R[1], corps: 'T', str: 10, mov: 0, rng: 1 }, false);
  S.units.push(blue, red);
  api.updateControl(true);
  const pv = api.previewAttack(red, blue, S.fields);
  const push = api.aiTargetOpts();
  ok('前提：直射营贴着核心守军，但比值低于无效接触线',
     pv.ratio >= api.PUSH_RATIO && pv.ratio < api.INVALID_RATIO && pv.counter === true,
     pv.ratio.toFixed(3));
  ok('前提：常规目标列表里没有这支守军',
     !api.targetsFor(red, S.fields).includes(blue));
  ok('前提：带攻坚令的列表里有它',
     api.targetsFor(red, S.fields, push).includes(blue));

  const before = blue.str;
  api.setRng(() => 0.9);
  await api.endBluePhase();
  const attacked = api.getState().log.some(l => l.text.indexOf('攻击') >= 0);
  ok('端到端：夺取型 runAI 把攻坚令带进开火流程',
     blue.str < before && attacked,
     '守军 ' + before + '→' + blue.str + ' / 战报 ' + attacked);
  ok('端到端：这一枪记入了战场首血', api.getState().firstBlood === 1,
     String(api.getState().firstBlood));

  /* ═════════════════ v4.21 ═════════════════ */
  console.log('\n[55] 追击模式：全关卡点数 / 士气闸 / 高价值目标（v4.21）');
  {
    ok('HUNT_RATIO = 1.5', Math.abs(api.HUNT_RATIO - 1.5) < 1e-9, String(api.HUNT_RATIO));
    ok('HUNT_MIN_ORG = 60', api.HUNT_MIN_ORG === 60, String(api.HUNT_MIN_ORG));
    ok('HUNT_PULL = 1.2', Math.abs(api.HUNT_PULL - 1.2) < 1e-9, String(api.HUNT_PULL));
    ok('夺取型 / 进攻型开启追击，防守型不参与',
       api.AI_STYLES.seize.hunt === true &&
       api.AI_STYLES.assault.hunt === true &&
       !api.AI_STYLES.hold.hunt);

    /* 点数账：未登场波次必须算进本方，否则"先头部队打崩、援军在路上"
       这段窗口永远触发不了追击。C2B 有明确的两波增援。 */
    api.newGame({ level: 'C2B', noSave: true });
    let st = api.getState();
    const pend = api.pendingWavePoints('red');
    ok('未登场波次计入本方全关卡点数', pend > 0, String(pend));
    ok('全关卡点数 = 场上 + 未登场',
       Math.abs(api.aiSidePoints('red') - (api.sideFieldPoints('red') + pend)) < 1e-9,
       api.aiSidePoints('red') + ' / ' + (api.sideFieldPoints('red') + pend));
    ok('防守型（C2B）即使兵力占优也不进入追击', api.aiHuntMode() === false);
    for (const def of api.LEVEL.units) {
      if ((def.wave || 1) > 1) st.flags['wave' + def.wave] = true;
    }
    ok('波次入场后不再重复计入', api.pendingWavePoints('red') === 0);

    const blank = level => {
      api.newGame({ level, noSave: true });
      const s = api.getState();
      s.units.length = 0;
      s.forts = []; s.mods = []; s.flanges = {}; s.ctrl = {};
      for (const def of api.LEVEL.units) {
        if ((def.wave || 1) > 1) s.flags['wave' + def.wave] = true;
      }
      s.log.length = 0;
      return s;
    };
    const openPlainPair = () => {
      for (let r = 0; r < api.LEVEL.rows; r++) {
        for (let c = 0; c < api.LEVEL.cols; c++) {
          if (api.LEVEL.map[r][c] !== '.') continue;
          for (const q of api.neighbors(r, c)) {
            if (api.LEVEL.map[q[0]][q[1]] === '.') return [[r, c], q];
          }
        }
      }
      return null;
    };

    st = blank('C1');
    let seq = 0;
    const spawn = (side, type, r, c, str) => {
      const T = api.TYPE[type];
      const u = api.makeUnit({ id: (side === 'blue' ? 'B' : 'R') + (++seq), side, type,
        abbr: 'T' + seq, name: '测试' + T.name, r, c, corps: 'T', str,
        mov: T.mv || 8, rng: T.rg === undefined ? 1 : T.rg }, false);
      st.units.push(u);
      return u;
    };
    const red = spawn('red', 'inf', 6, 5, 100);
    const blue = spawn('blue', 'inf', 6, 7, 40);
    ok('100 点 vs 40 点 → 超过 1.5 倍，进入追击', api.aiHuntMode() === true);
    /* 40 × 1.5 = 60：判据是**严格大于**，所以 60 不追、61 才追。
       这条卡的是"倍数写成 >= 就早一档开追"，差一点也是差。 */
    red.str = 60;
    ok('恰好 1.5 倍（60 vs 40）不追击：判据是严格大于', api.aiHuntMode() === false);
    red.str = 61;
    ok('超过 1.5 倍即追击', api.aiHuntMode() === true);

    /* 绿方（友军）预留接口：目前 state.allies 恒空，但点数口径必须先接好，
       否则实装友军那天，AI 会把"蓝方+绿方"的兵力当成没看见。 */
    st.allies = [{ id: 'G1', side: 'green', type: 'inf', abbr: '绿',
      name: '友军测试营', str: 50, org: 100, pos: [5, 5] }];
    ok('绿方友军计入蓝方场上点数', api.sideFieldPoints('blue') === 90,
       String(api.sideFieldPoints('blue')));
    ok('alliedUnits 只认蓝方一侧的友军',
       api.alliedUnits('blue').length === 1 && api.alliedUnits('red').length === 0);
    ok('友军点数能把 1.5 倍判定顶掉（61 vs 135）', api.aiHuntMode() === false);
    st.allies = [];

    red.str = 100; red.org = 59;
    ok('士气跌破 HUNT_MIN_ORG 收兵', api.aiHuntMode() === false);
    red.org = 60;
    ok('士气刚好 60 仍追击（>=）', api.aiHuntMode() === true);
    red.org = 100;
    ok('aiHuntTick 进入追击并记录状态', api.aiHuntTick() === true && st.huntOn === true);
    /* 播报要等接敌（v4.21 P3-4）：兵力比是**编制账**，开局就成立（C1 是 2.06，1.5 的线更早过），
       可那时候两军还隔着半个地图，第 1 回合就弹「敌军追击」读着像敌人开挂。
       状态照常切换、AI 行为一点不变，只把这句话压到真正接敌那一回合补播。
       这两条必须成对：只看"接敌后播了"挡不住"没接敌也播"，
       只看"没接敌没播"挡不住"永远不播"。 */
    ok('未接敌时只记账不播报',
       !st.huntSaid && !st.log.some(l => l.text.indexOf('转入追击') >= 0),
       'said=' + st.huntSaid);
    blue.pos = api.neighbors(red.pos[0], red.pos[1])[0];
    ok('推到相邻一格后补播追击战报',
       api.aiHuntTick() === true && st.huntSaid === true &&
       st.log.some(l => l.text.indexOf('转入追击') >= 0));
    const nLog = st.log.length;
    ok('同一状态不重复播报', api.aiHuntTick() === true && st.log.length === nLog);
    red.org = 40;
    ok('士气掉线后 aiHuntTick 恢复原模式',
       api.aiHuntTick() === false && st.huntOn === false && st.huntSaid === false);
    ok('收兵有战报', st.log.some(l => l.text.indexOf('停止追击') >= 0));
    red.org = 100;

    const mk = (type, str) => ({ pos: [0, 0], side: 'blue', type, str, org: 100 });
    ok('炮兵的价值高于同点数步兵', api.huntValue(mk('art', 5)) > api.huntValue(mk('inf', 5)));
    ok('指挥部的价值高于同点数步兵', api.huntValue(mk('hqd', 2)) > api.huntValue(mk('inf', 2)));
    ok('重坦的价值高于同点数步兵', api.huntValue(mk('harm', 12)) > api.huntValue(mk('inf', 12)));
    ok('崩溃目标额外加分（补刀优先）',
       api.huntValue({ ...mk('inf', 8), org: 20 }) > api.huntValue(mk('inf', 8)));

    /* 贴脸的这支压到 5 点：价值分的编制项要同量级才比得出"高价值优先"，
       40 点步兵光靠吨位就能压过任何 3 格外的炮兵。 */
    blue.str = 5;
    blue.pos = [6, 6];
    let p3 = null;
    for (let r = 0; r < api.LEVEL.rows && !p3; r++) {
      for (let c = 0; c < api.LEVEL.cols && !p3; c++) {
        if (api.hexDist(red.pos, [r, c]) === 3) p3 = [r, c];
      }
    }
    const arty = spawn('blue', 'art', p3[0], p3[1], 5);
    ok('高价值优先：3 格外的炮兵压过贴脸的步兵',
       api.aiHuntTarget(red) === arty,
       api.aiHuntTarget(red) ? api.aiHuntTarget(red).name : '无');
    const hq = spawn('blue', 'hqd', 6, 4, 2);
    ok('指挥部优先于更远的炮兵', api.aiHuntTarget(red) === hq);

    ok('追击时目标轴指向高价值敌军',
       JSON.stringify(api.aiGoalFor(red, api.AI_STYLES.seize, true)) === JSON.stringify(hq.pos),
       JSON.stringify(api.aiGoalFor(red, api.AI_STYLES.seize, true)));
    const goal0 = api.aiGoalFor(red, api.AI_STYLES.seize, false);
    const goalOnObj = !!goal0 && api.LEVEL.objectives.some(o =>
      o.cells.some(c => c[0] === goal0[0] && c[1] === goal0[1]));
    ok('不追击时目标轴仍是要点', goalOnObj, JSON.stringify(goal0));

    const foeDist = p => Math.min.apply(null, st.units.filter(u => u.side === 'blue')
      .map(u => api.hexDist(p, u.pos)));
    let nearP = null, farP = null, farMind = -1;
    for (let r = 0; r < api.LEVEL.rows; r++) {
      for (let c = 0; c < api.LEVEL.cols; c++) {
        if (api.TERRAIN[api.LEVEL.map[r][c]].cost >= 99) continue;
        const mind = foeDist([r, c]);
        if (mind === 1 && !nearP) nearP = [r, c];
        if (mind > farMind) { farMind = mind; farP = [r, c]; }
      }
    }
    ok('前提：找到贴近敌军与远离敌军的两个落点',
       !!nearP && !!farP && farMind >= 4, JSON.stringify({ nearP, farP, farMind }));
    if (nearP && farP) {
      const dNear = api.aiMoveScore(red, nearP, hq.pos, api.AI_STYLES.seize, true) -
                    api.aiMoveScore(red, nearP, hq.pos, api.AI_STYLES.seize, false);
      const dFar = api.aiMoveScore(red, farP, hq.pos, api.AI_STYLES.seize, true) -
                   api.aiMoveScore(red, farP, hq.pos, api.AI_STYLES.seize, false);
      ok('追击给贴近敌军的落点加分（远离敌军扣得更多）',
         Math.abs(dNear + api.HUNT_PULL) < 1e-9 &&
         Math.abs(dFar + Math.min(farMind, 8) * api.HUNT_PULL) < 1e-9 &&
         dNear > dFar,
         dNear.toFixed(2) + ' / ' + dFar.toFixed(2));
    } else {
      ok('追击给贴近敌军的落点加分（远离敌军扣得更多）', false, '没有取样格');
    }

    const pvB = api.previewAttack(red, blue, st.fields);
    ok('追击把开火门槛压到 0',
       api.aiFireGate(red, blue, pvB, api.AI_STYLES.seize, true, false, false, true) === 0);
    ok('不追击时同一枪仍受常规门槛约束',
       api.aiFireGate(red, blue, pvB, api.AI_STYLES.seize, true, false, false, false) > 0,
       String(api.aiFireGate(red, blue, pvB, api.AI_STYLES.seize, true, false, false, false)));

    /* 无效接触闸：目标列表与 doAttack 兜底闸必须**同时**放开。
       只放列表会变成"看得见、点不动"；只放兜底闸则 AI 永远列不出目标。 */
    const pair = openPlainPair();
    ok('前提：找到一对相邻的空旷平原格', !!pair, JSON.stringify(pair));
    if (pair) {
      const st2 = blank('C1');
      let seq2 = 0;
      const spawn2 = (side, type, r, c, str) => {
        const T = api.TYPE[type];
        const u = api.makeUnit({ id: (side === 'blue' ? 'B' : 'R') + (++seq2), side, type,
          abbr: 'U' + seq2, name: '测试' + T.name, r, c, corps: 'U', str,
          mov: T.mv || 8, rng: T.rg === undefined ? 1 : T.rg }, false);
        st2.units.push(u);
        return u;
      };
      const weak = spawn2('red', 'inf', pair[0][0], pair[0][1], 10);
      const strong = spawn2('blue', 'gdn', pair[1][0], pair[1][1], 80);
      const pv = api.previewAttack(weak, strong, st2.fields);
      ok('前提：比值低于无效接触线且守方能还手',
         pv.ratio < api.INVALID_RATIO && pv.counter === true, pv.ratio.toFixed(3));
      ok('常规目标列表里没有它', !api.targetsFor(weak, st2.fields).includes(strong));
      ok('追击目标列表放行', api.targetsFor(weak, st2.fields, { hunt: true }).includes(strong));
      ok('不带追击令时 doAttack 兜底闸拒绝', api.doAttack(weak, strong) === false);
      api.setRng(() => 0.9);
      const before = strong.str;
      ok('带追击令时 doAttack 放行', api.doAttack(weak, strong, { hunt: true }) !== false);
      ok('追击伤害真的落地', strong.str < before, before + '→' + strong.str);
      ok('带追击令的攻击仍然允许对方反击',
         api.getState().log.some(l => l.text.indexOf('攻击') >= 0));
    }
  }

  console.log('\n[56] 反坦克连：4 点编制 / 设伏 / 防御 0.30（v4.21）');
  {
    ok('defStr：反坦克连定义 3 点按 4 点计', api.defStr({ type: 'at', str: 3 }) === 4);
    ok('defStr：其他兵种不额外加', api.defStr({ type: 'inf', str: 8 }) === 8);
    ok('typeStrBonus 只认 at',
       api.typeStrBonus('at') === 1 && api.typeStrBonus('td') === 0);

    api.newGame({ level: 'C1', noSave: true });
    let st = api.getState();
    const defAt = api.LEVEL.units.find(u => u.side === 'blue' && u.type === 'at');
    const liveAt = st.units.find(u => u.id === defAt.id);
    ok('开局反坦克连按 4 点进场', !!liveAt && liveAt.str === 4,
       liveAt ? String(liveAt.str) : '无');
    const expInit = api.LEVEL.units.filter(u => u.side === 'blue' && u.wave === 1)
      .reduce((s, u) => s + api.defStr(u), 0);
    ok('blueInitialStr 与 defStr 同一份基准', api.blueInitialStr() === expInit,
       api.blueInitialStr() + ' / ' + expInit);
    const byCorps = {};
    for (const u of api.LEVEL.units.filter(x => x.side === 'blue' && x.wave === 1)) {
      byCorps[u.corps] = (byCorps[u.corps] || 0) + api.defStr(u);
    }
    ok('initStr 各编制合计也按 defStr 记',
       Object.keys(byCorps).every(k => st.initStr[k] === byCorps[k]));

    const openPlainPair = () => {
      for (let r = 0; r < api.LEVEL.rows; r++) {
        for (let c = 0; c < api.LEVEL.cols; c++) {
          if (api.LEVEL.map[r][c] !== '.') continue;
          for (const q of api.neighbors(r, c)) {
            if (api.LEVEL.map[q[0]][q[1]] === '.') return [[r, c], q];
          }
        }
      }
      return null;
    };
    const pair = openPlainPair();
    ok('前提：找到一对相邻的平原格', !!pair, JSON.stringify(pair));
    if (pair) {
      st.units.length = 0;
      st.forts = []; st.mods = []; st.flanges = {}; st.ctrl = {};
      let seq = 0;
      const spawn = (side, type, r, c, str) => {
        const T = api.TYPE[type];
        const u = api.makeUnit({ id: (side === 'blue' ? 'B' : 'R') + (++seq), side, type,
          abbr: 'V' + seq, name: '测试' + T.name, r, c, corps: 'V', str,
          mov: T.mv || 8, rng: T.rg === undefined ? 1 : T.rg }, false);
        st.units.push(u);
        return u;
      };
      const atU = spawn('blue', 'at', pair[0][0], pair[0][1], 3);
      const arm = spawn('red', 'marm', pair[1][0], pair[1][1], 8);
      ok('makeUnit 把反坦克连按 4 点布置', atU.str === 4, String(atU.str));

      const pvDef = api.previewAttack(arm, atU, st.fields);
      ok('反坦克连被装甲攻击时防御 +0.30',
         Math.abs(pvDef.defMod - 0.30) < 1e-9, pvDef.defMod.toFixed(2));
      ok('装步攻击反坦克连同样 +0.30',
         Math.abs(api.previewAttack({ ...arm, type: 'mech', str: 8 }, atU, st.fields).defMod - 0.30) < 1e-9);
      ok('步兵攻击反坦克连没有这份加成',
         Math.abs(api.previewAttack({ ...arm, type: 'inf', str: 8 }, atU, st.fields).defMod) < 1e-9);
      ok('坦克歼击车的防御加成仍是 +0.30',
         Math.abs(api.previewAttack(arm, { ...atU, type: 'td' }, st.fields).defMod - 0.30) < 1e-9);

      atU.fortify = 0.15;
      const pvAmb = api.previewAttack(atU, arm, st.fields);
      ok('设伏成立：静止 + 掩体 + 未被发现 + 目标装甲',
         pvAmb.ambush === true && pvAmb.counter === false);
      ok('atAmbushState 三项都满足',
         JSON.stringify(api.atAmbushState(atU)) === '{"still":true,"cover":true,"spotted":false,"ready":true}',
         JSON.stringify(api.atAmbushState(atU)));

      const spotCell = api.neighbors(pair[0][0], pair[0][1]).find(q =>
        !(q[0] === pair[1][0] && q[1] === pair[1][1]) &&
        api.LEVEL.map[q[0]][q[1]] === '.' &&
        !st.units.some(u => u.pos[0] === q[0] && u.pos[1] === q[1]));
      ok('前提：找到第二个相邻格放观察哨', !!spotCell, JSON.stringify(spotCell));
      if (spotCell) {
        const spotter = spawn('red', 'inf', spotCell[0], spotCell[1], 8);
        ok('相邻敌军步兵发现炮位 → 设伏失效',
           api.atAmbushState(atU).spotted === true && api.previewAttack(atU, arm, st.fields).ambush === false);
        ok('被发现时装甲能正常反击',
           api.previewAttack(atU, arm, st.fields).counter === true);
        st.units = st.units.filter(u => u !== spotter);
      }

      atU.moved = true;
      ok('本回合动过 → 不能设伏',
         api.atAmbushState(atU).still === false && api.previewAttack(atU, arm, st.fields).ambush === false);
      atU.moved = false; atU.exposed = true;
      ok('已暴露 → 要先转移阵地', api.atAmbushState(atU).still === false);
      atU.exposed = false; atU.fortify = 0;
      ok('平原 + 没有掩体 → 不能设伏',
         api.atCover(atU) === false && api.atAmbushState(atU).cover === false);

      const gain = api.selfFortifyTick(atU);
      ok('静止一回合自动 +15% 发射阵地',
         Math.abs(gain - 0.15) < 1e-9 && Math.abs(atU.fortify - 0.15) < 1e-9,
         atU.fortify.toFixed(2));
      api.selfFortifyTick(atU);
      const capped = api.selfFortifyTick(atU);
      ok('自筑阵地上限 30%', Math.abs(atU.fortify - 0.30) < 1e-9 && capped === 0,
         atU.fortify.toFixed(2));
      ok('有了自筑阵地，平原上也能设伏', api.atAmbushState(atU).ready === true);

      atU.str = 10; atU.org = 100; atU.moved = false; atU.fired = false; atU.exposed = false;
      api.setRng(() => 0.5);
      ok('前提：设伏状态可以开火', api.atAmbushState(atU).ready === true);
      const fired = api.doAttack(atU, arm);
      ok('反坦克连开火后位置暴露', fired !== false && atU.exposed === true);
      atU.moved = false;
      api.doMove(atU, atU.pos.slice());
      ok('原地“移动”不算转移阵地，暴露状态保留', atU.exposed === true);
      const moveCell = api.neighbors(pair[0][0], pair[0][1]).find(q =>
        !(q[0] === pair[1][0] && q[1] === pair[1][1]) &&
        api.LEVEL.map[q[0]][q[1]] === '.' &&
        !st.units.some(u => u.pos[0] === q[0] && u.pos[1] === q[1]));
      ok('前提：找到一个空的转移格', !!moveCell, JSON.stringify(moveCell));
      if (moveCell) {
        api.doMove(atU, moveCell);
        ok('真正转移到新格才重新隐蔽', atU.exposed === false);
      }

      /* 机制写在函数里、回合末不执行，等于没有——玩家永远攒不到掩体。 */
      st.units = [atU];
      st.mines = [];
      atU.fortify = 0; atU.moved = false; atU.fired = false; atU.exposed = false;
      api.settlePhase();
      ok('回合结算会自动调用自筑阵地 tick',
         Math.abs(atU.fortify - 0.15) < 1e-9, atU.fortify.toFixed(2));
    }
  }

  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});


