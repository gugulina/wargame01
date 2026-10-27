/* 战役级自战跑局：评估达成率与守备质量。

   跑法：
     node tools/autoplay-campaign.js                      默认为当前 LEVEL（最后一关）
     node tools/autoplay-campaign.js game/campaign.html 200 --level=C1
     加 --verbose 打印首局战报，--diag 打印终局要点归属

   v4.1 起支持三种胜负条件，蓝方策略按 LEVEL.win.kind 分三套：
     score    守要点（原来那套，岚口）
     survive  守核心 + 保存兵力（北岭要塞）
     reach    向撤离区推进（青溪渡口）

   一条纪律写在前面：**这套脚本永远比真人弱。**
   v3.7 那次"36% 达成率"的复盘结论就是这个——关卡数值一直没问题，
   是代打脚本不会打仗（守备营扔下机场跑去钻碉堡之类）。
   所以脚本给出 45–60% 才算达标，而不是 50% 上下。 */

const path = require('path');
const { loadGame } = require('./load');

const args = process.argv.slice(2);
const levelArg = (args.find(a => a.startsWith('--level=')) || '').split('=')[1] || '';
const roundsArg = args.find(a => /^\d+$/.test(a));
const file = args.find(a => !a.startsWith('-') && !/^\d+$/.test(a))
  ? path.resolve(args.find(a => !a.startsWith('-') && !/^\d+$/.test(a)))
  : path.join(__dirname, '..', 'game', 'campaign.html');
const ROUNDS = Number(roundsArg || 200);
const VERBOSE = args.includes('--verbose');
/* --seed=N：固定骰子，同一份代码 + 同一个种子 = 同一串结果。
   平衡对比时先跑两遍确认真复现（数字必须一模一样），再改数值，
   才知道差的那 10 个点是改动带来的还是采样噪声。
   不给这个参数时完全走原来的 Math.random。 */
const SEED_ARG = args.find(a => a.startsWith('--seed='));
const SEED = SEED_ARG ? Number(SEED_ARG.slice(7)) : null;
if (SEED_ARG && !Number.isFinite(SEED)) {
  console.error('--seed 后面要跟一个数字，例如 --seed=1234');
  process.exit(1);
}
/* mulberry32：32 位状态，够快够均匀，不需要引依赖。
   返回 [0,1)，和 Math.random 同签名，直接塞给 api.setRng。 */
function lcg(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { api } = loadGame(file);

/* LEVEL 会随 newGame 变，所以这里必须是 let，而且每局开头重取一次 */
let L = levelArg ? (api.levelById(levelArg) || api.LEVEL) : api.LEVEL;
if (levelArg && !api.levelById(levelArg)) {
  console.error('没有这一关：' + levelArg);
  process.exit(1);
}

const winKind = () => (L.win || { kind: 'score' }).kind;
const initStr = side => L.units
  .filter(u => u.side === side && (side === 'blue' ? u.wave === 1 : u.wave !== 0))
  .reduce((s, u) => s + u.str, 0);

function passable(pos) {
  return pos[0] >= 0 && pos[0] < L.rows && pos[1] >= 0 && pos[1] < L.cols &&
         api.TERRAIN[L.map[pos[0]][pos[1]]].cost < 99;
}
function inCore(pos) {
  return L.objectives.some(o => o.core &&
    o.cells.some(c => c[0] === pos[0] && c[1] === pos[1]));
}
function isCoreCell(pos) {
  return L.objectives.some(o => o.core && o.cells.some(c => c[0] === pos[0] && c[1] === pos[1]));
}
function nearestCoreCell(pos) {
  let best = null, bd = Infinity;
  for (const o of L.objectives.filter(o => o.core)) {
    for (const cell of o.cells) {
      const d = api.cheb(pos, cell);
      if (d < bd) { bd = d; best = cell; }
    }
  }
  return best;
}
/* 这一格属于哪个要点。用于禁止"跨要点搬家"——
   守备营为了钻城区的碉堡把机场让空，人活着但要点没了，比不钻工事更糟。 */
function objOf(pos) {
  return L.objectives.find(o => o.cells.some(c => c[0] === pos[0] && c[1] === pos[1])) || null;
}
function nearestEscape(pos) {
  const zc = api.escapeCells();
  let best = null, bd = Infinity;
  for (const c of zc) {
    const d = api.cheb(pos, c);
    if (d < bd) { bd = d; best = c; }
  }
  return { cell: best, d: bd };
}

function stepToward(u, goal) {
  const reach = api.computeReach(u);
  let best = null, bd = Infinity;
  for (const key in reach.stop) {
    const p = key.split(',').map(Number);
    const d = api.cheb(p, goal);
    if (d < bd) { bd = d; best = p; }
  }
  const cur = api.cheb(u.pos, goal);
  if (best && bd < cur) api.doMove(u, best);
}

/* 选工事：城区给要塞炮，其余给碉堡，工兵连只能挖堑壕 */
function pickFortKind(u, cell) {
  const kinds = api.fortKindsFor(u, cell);
  if (!kinds.length) return null;
  const cls = api.TERRAIN[L.map[cell[0]][cell[1]]].cls;
  if (kinds.includes('P') && cls === 't-town') return 'P';
  if (kinds.includes('B')) return 'B';
  return kinds[0];
}

/* 通用：先开火。返回 true 表示这一动已经用掉了 */
function tryShoot(u, minRatio) {
  const st = api.getState();
  if (u.fired || u.rng <= 0) return false;
  const tg = api.targetsFor(u, st.fields);
  if (!tg.length) return false;
  const evals = tg.map(t => ({ t, pv: api.previewAttack(u, t, st.fields) }))
                  .sort((a, b) => b.pv.ratio - a.pv.ratio);
  if (evals[0].pv.ratio < minRatio) return false;
  api.doAttack(u, evals[0].t);
  return true;
}

/* ───────── 蓝方策略 A：守要点（score / survive） ───────── */
async function blueTurnHold() {
  const st = api.getState();
  const aliveBlue = () => api.alive('blue');
  /* 工兵先动：同一格只能留一处工事，碉堡/要塞炮不能被堑壕占位 */
  const order = aliveBlue().slice().sort((a, b) => {
    const ea = (a.type === 'eng' || a.type === 'engc') ? 0 : 1;
    const eb = (b.type === 'eng' || b.type === 'engc') ? 0 : 1;
    return ea - eb;
  });
  for (const u of order) {
    if (!aliveBlue().includes(u)) continue;
    /* 0. 工兵：优先给核心要点加固，没有可加固格就靠近要点 */
    if (u.type === 'eng' || u.type === 'engc') {
      if (!u.fired) {
        const ring = [u.pos].concat(api.neighbors(u.pos[0], u.pos[1]))
          .filter(p => passable(p) && !api.fortAt(p[0], p[1]));
        const onCore = ring.filter(p => isCoreCell(p));
        if (onCore.length) {
          for (const cell of onCore) {
            const k = pickFortKind(u, cell);
            if (k && api.doFort(u, cell, k) !== false) break;
          }
          if (u.fired) continue;
        }
      }
      if (!u.moved) {
        const missing = [];
        for (const o of L.objectives.filter(o => o.core)) {
          for (const cell of o.cells) if (!api.fortAt(cell[0], cell[1])) missing.push(cell);
        }
        if (missing.length) {
          let best = null, bd = Infinity;
          for (const cell of missing) {
            const d = api.cheb(u.pos, cell);
            if (d < bd) { bd = d; best = cell; }
          }
          if (best && bd > 1) stepToward(u, best);
        }
      }
      continue;
    }

    const passive = api.isHQ(u) || u.type === 'sup' ||
                    u.type === 'aac' || u.type === 'aab';
    if (passive) continue;

    /* 1. 有目标先打 */
    if (tryShoot(u, 0.70)) continue;

    /* 2. 炮兵没有目标就留在原地，不冒险前出 */
    if (api.isArty(u)) continue;
    /* 2a. 舰艇同样不挪窝，而且更要紧——**舰船的收益全在"停在泊位"上**：
           ① 只有没动过才补得进弹（settlePhase）
           ② 行进间射击 −0.10，舰炮本来就靠一次命中的分量，掉不起这个
           ③ 走出码头 3 格以外补给就掉到「紧张」，补弹直接断
           上一版没这一条，脚本每回合把战列舰往岸上蹭一格，
           20 回合下来弹打光、命中打折，等于让脚本自己去把舰队废掉。
           真人不会开着战列舰追步兵，脚本也不该——这不是"削弱脚本"，
           而是把脚本从"明显不会玩的走法"修回"最省事的走法"。 */
    if (api.isNaval(u)) continue;
    if (u.moved) continue;

    /* 2b. 步兵挖堑壕：先把自筑工事顶满（+30%）、组织度也满，才拿这一回合换永久 +15%，
          否则等于拿「这一回合的组织度恢复 + 自筑工事成长」去换一个更差的工事。 */
    const engNear = aliveBlue().some(e => e.type === 'eng' && api.cheb(e.pos, u.pos) <= 2);
    if (!u.fired && !engNear && u.org >= 95 && u.fortify >= 0.30 &&
        inCore(u.pos) && !api.fortAt(u.pos[0], u.pos[1]) &&
        api.fortKindsFor(u, u.pos).includes('H')) {
      if (api.doFort(u, u.pos, 'H') !== false) continue;
    }

    /* 3. 守备营、反坦克连已在要地内则死守（吃「为了祖国」）。
          但脚下没工事、旁边就有己方碉堡时该挪一格——真人一定会挪，
          因为碉堡对炮击的减免（shell 0.65）比多一回合组织度回复值钱得多。 */
    if ((u.type === 'gdn' || u.type === 'at') && inCore(u.pos)) {
      const here = api.fortAt(u.pos[0], u.pos[1]);
      if (here && here.side === 'blue') continue;
      const home = objOf(u.pos);
      const nest = api.neighbors(u.pos[0], u.pos[1])
        .filter(p => {
          if (!passable(p)) return false;
          const o = objOf(p);
          return o && home && o.id === home.id;   // 只在本要点内换位
        })
        .map(p => ({ p, f: api.fortAt(p[0], p[1]) }))
        .filter(o => o.f && o.f.side === 'blue' && (o.f.kind === 'B' || o.f.kind === 'P'))
        .sort((a, b) => (b.f.kind === 'P') - (a.f.kind === 'P'));
      if (nest.length && !u.moved) { api.doMove(u, nest[0].p); continue; }
      continue;
    }

    /* 4. 装甲 / 装步：敌人未逼近要点就不动，保存实力做反冲击。
          **这里必须用 api.isArmor，不能写 u.type === 'arm'。**
          坦克分成轻/中/重三型之后，'arm' 这个代号已经不存在了，
          写死 'arm' 的分支永远不成立，整段"装甲做机动预备队"的逻辑变成死代码，
          中坦于是跟着步兵一起挪，达成率被严重低估。 */
    if (api.isArmor(u) || u.type === 'mech') {
      const core0 = nearestCoreCell(u.pos);
      if (core0) {
        let threat = Infinity;
        for (const f of api.alive('red')) threat = Math.min(threat, api.cheb(f.pos, core0));
        if (api.cheb(u.pos, core0) <= 3 && threat > 3) continue;
      }
    }

    /* 5. 机动 */
    const reach = api.computeReach(u);
    let best = null, bs = -Infinity;
    for (const key in reach.stop) {
      const p = key.split(',').map(Number);
      const t = api.TERRAIN[L.map[p[0]][p[1]]];
      let s;
      if (api.isArmor(u) || u.type === 'mech') {
        const core = nearestCoreCell(p);
        const dc = core ? api.cheb(p, core) : 0;
        let td = Infinity;
        for (const f of api.alive('red')) td = Math.min(td, api.cheb(p, f.pos));
        const onMinorObj = L.objectives.some(o => !o.core &&
          o.cells.some(c => c[0] === p[0] && c[1] === p[1]));
        s = (td <= 2 ? 5 : 0) - Math.abs(dc - 2) * 1.5 + t.def * 3;
        if (onMinorObj) s -= 6;                  // 装甲对非核心要点兴趣低，但不禁止
      } else {
        const goal = nearestCoreCell(p);
        /* 工事加成必须限定在「本要点内」。
           上一版只按有没有碉堡算分，结果守备营扔下机场跑去城区钻碉堡——
           存活数从 16.8 涨到 20.1，达成率反而从 36.0% 掉到 28.0%。
           工事是手段，占住要点才是目的，权重顺序不能反。 */
        const home = objOf(u.pos);
        const pObj = objOf(p);
        const sameObj = !home || (pObj && pObj.id === home.id);
        const f = api.fortAt(p[0], p[1]);
        const fk = (f && f.side === 'blue') ? f.kind : null;
        const fortBonus = !sameObj ? 0
          : fk === 'P' ? 7 : fk === 'B' ? 6 : fk === 'A' ? 4 : fk === 'H' ? 3 : 0;
        /* 覆盖优先于加固：核心要点只有 6 格（城区 3 + 机场 3），堆叠上限 2，
           所以「铺满」比「叠厚」值钱得多。两支都挤进同一个碉堡，等于白送一格。
           空格给 +8，压过碉堡的 +6 —— 先把格子占住，再谈工事。 */
        const held = aliveBlue().some(x =>
          x.pos[0] === p[0] && x.pos[1] === p[1]);
        const uncovered = (sameObj && pObj && !held) ? 8 : 0;
        s = ((inCore(p) && sameObj) ? 6 : 0) + uncovered + fortBonus + t.def * 3 -
            (goal ? api.cheb(p, goal) * 0.4 : 0);
      }
      if (s > bs) { bs = s; best = p; }
    }
    if (best) api.doMove(u, best);
  }
}

/* ───────── 蓝方策略 B：向撤离区推进（reach） ─────────
   目标只有一个：把足够多的兵牌送进撤离区。
   优先级按"跑得快不快"排——轻坦先冲，步兵跟上，炮兵和指挥部留下殿后。

   这一套刻意写得很"莽"：它不会组织火力准备，也不会等炮兵展开再冲。
   真人有战术卡、会集火打掉拦路的那一支，所以脚本的达成率应当偏低，
   留 15–25 个点的余量给真人。 */
async function blueTurnBreakout() {
  const st = api.getState();
  const aliveBlue = () => api.alive('blue');

  const speedRank = u => {
    if (api.isArmor(u)) return 0;                     // 坦克开路
    if (u.type === 'inf' || u.type === 'mob' || u.type === 'mech') return 1;
    if (api.isArty(u)) return 3;
    if (api.isHQ(u) || u.type === 'sup') return 4;    // 最后走
    return 2;
  };
  const order = aliveBlue().slice().sort((a, b) => speedRank(a) - speedRank(b));

  for (const u of order) {
    if (!aliveBlue().includes(u)) continue;

    /* 1. 这一步就能踏进撤离区 —— 立刻走，别管别的 */
    if (!u.moved) {
      const reach = api.computeReach(u);
      let esc = null;
      for (const key in reach.stop) {
        const p = key.split(',').map(Number);
        if (api.inEscapeZone(p)) { esc = p; break; }
      }
      if (esc) { api.doMove(u, esc); continue; }
    }

    /* 2. 有便宜就开火（清路）。炮兵门槛低一些——它就是干这个的 */
    if (tryShoot(u, api.isArty(u) ? 0.65 : 0.85)) continue;

    if (api.isArty(u) || api.isHQ(u) || u.type === 'sup') {
      /* 殿后组：站着不动，敌人贴上来才走开一格 */
      if (u.moved) continue;
      const reach = api.computeReach(u);
      let best = null, bs = -Infinity;
      for (const key in reach.stop) {
        const p = key.split(',').map(Number);
        let md = Infinity;
        for (const f of api.alive('red')) md = Math.min(md, api.cheb(p, f.pos));
        const s = Math.min(md, 5) * 2 + api.TERRAIN[L.map[p[0]][p[1]]].def * 3;
        if (s > bs) { bs = s; best = p; }
      }
      const here = (() => {
        let md = Infinity;
        for (const f of api.alive('red')) md = Math.min(md, api.cheb(u.pos, f.pos));
        return md;
      })();
      if (here <= 2 && best) api.doMove(u, best);
      continue;
    }

    if (u.moved) continue;

    /* 3. 朝撤离区推进 */
    const reach = api.computeReach(u);
    let best = null, bs = -Infinity;
    for (const key in reach.stop) {
      const p = key.split(',').map(Number);
      const t = api.TERRAIN[L.map[p[0]][p[1]]];
      const esc = nearestEscape(p);
      let md = Infinity;
      for (const f of api.alive('red')) md = Math.min(md, api.cheb(p, f.pos));
      /* 距离是主要项；地形防御与"别贴着敌人"是修正项。
         贴脸惩罚不能太重——缺口只有一个，就是要硬挤过去的。 */
      let s = -esc.d * 1.5 + t.def * 2.5 + Math.min(md, 3) * 0.8;
      if (api.inEscapeZone(p)) s += 50;
      if (s > bs) { bs = s; best = p; }
    }
    if (best) api.doMove(u, best);
  }
}

async function playOne(idx) {
  /* 可复现的骰子。--seed 给了值就按 (种子 + 局号) 派生每局的流，
     没给就保持原来的 Math.random——默认行为一点不变，
     免得以前记下的历史数字全部失去可比性。 */
  if (SEED !== null) api.setRng(lcg(SEED * 100003 + idx * 7919 + 1));
  api.newGame(levelArg ? { level: levelArg, noSave: true } : { noSave: true });
  const st = api.getState();
  L = api.LEVEL;
  const kind = winKind();
  let guard = 0;
  /* 每回合采样：蓝方有多少单位真在工事里、有多少在要点里。
     只看终局快照会被"人都死了"干扰，逐回合累计才能反映守备质量。 */
  let fortAcc = 0, coreAcc = 0, aliveAcc = 0, samples = 0;
  while (!st.result && guard < 60) {
    guard++;
    if (st.phase !== 'blue') break;
    if (kind === 'reach') await blueTurnBreakout();
    else await blueTurnHold();
    if (st.result) break;
    const bs = st.units.filter(u => u.side === 'blue');
    fortAcc += bs.filter(u => {
      const f = api.fortAt(u.pos[0], u.pos[1]);
      return f && f.side === 'blue';
    }).length;
    coreAcc += bs.filter(u => inCore(u.pos)).length;
    aliveAcc += bs.length;
    samples++;
    await api.endBluePhase();
  }

  if (VERBOSE && idx === 0) {
    console.log('--- 单局战报 ---');
    for (const l of st.log) console.log(l.text);
    console.log('---');
  }

  const blueNow = st.units.filter(u => u.side === 'blue').reduce((s, u) => s + u.str, 0);
  const redNow = st.units.filter(u => u.side === 'red').reduce((s, u) => s + u.str, 0);
  const starved = st.units.filter(u => u.side === 'blue' && api.supplyOf(u, st.fields).label === '断绝').length;
  const avgOrg = st.units.filter(u => u.side === 'blue').reduce((s, u) => s + u.org, 0) /
                 Math.max(1, st.units.filter(u => u.side === 'blue').length);

  return {
    events: Object.keys(st.eventsDone),
    result: st.result || 'stuck',
    score: api.blueScore(),
    turn: st.turn,
    escaped: api.escapedCount(),
    goal: api.escapeGoal(),
    /* 返回"保住了几个 keep 要点"的数字，**不能返回 "1/1" 这种字符串**。
       上一版返回的是 '0/1'，而 '0/1' 在 JS 里是 truthy——
       汇总处的 `if (!r.keepHeld) keepNone++` 于是永远不成立，
       报表上于是永远显示"核心保有 200/200 局"，把一次 0% 达成率掩盖成了"全守住了"。
       这条统计一旦失真，survive 类关卡的所有平衡结论都不作数。 */
    keepHeld: (() => {
      const keep = (api.winSpec().keep || []);
      if (!keep.length) return null;
      return keep.filter(id => {
        const o = L.objectives.find(x => x.id === id);
        return !!o && api.objectiveControl(o) === 'blue';
      }).length;
    })(),
    blueLoss: 1 - blueNow / initStr('blue'),
    redLoss: 1 - redNow / initStr('red'),
    starved, avgOrg,
    fortAcc, coreAcc, aliveAcc, samples,
    ctrl: Object.assign({}, st.ctrl),
    blueAlive: st.units.filter(u => u.side === 'blue').length,
    gdnAlive: st.units.filter(u => u.side === 'blue' && u.type === 'gdn').length,
    forts: (st.forts || []).length,
    fortKinds: (st.forts || []).reduce((m, f) => {
      m[f.kind] = (m[f.kind] || 0) + 1; return m;
    }, {})
  };
}

(async () => {
  const tally = { fail: 0, win: 0, perfect: 0, stuck: 0 };
  const evtTally = {};
  let scoreSum = 0, turnSum = 0, bLoss = 0, rLoss = 0, starveSum = 0, orgSum = 0, fortSum = 0;
  let escapeSum = 0, keepNone = 0;
  const kindSum = {};
  const ctrlTally = {};
  let blueAliveSum = 0, gdnSum = 0;
  let fortAccSum = 0, coreAccSum = 0, aliveAccSum = 0, sampleSum = 0;

  for (let i = 0; i < ROUNDS; i++) {
    const r = await playOne(i);
    tally[r.result] = (tally[r.result] || 0) + 1;
    for (const e of r.events) evtTally[e] = (evtTally[e] || 0) + 1;
    scoreSum += r.score; turnSum += r.turn;
    escapeSum += r.escaped; if (!r.keepHeld) keepNone++;
    bLoss += r.blueLoss; rLoss += r.redLoss;
    blueAliveSum += r.blueAlive; gdnSum += r.gdnAlive;
    fortAccSum += r.fortAcc; coreAccSum += r.coreAcc;
    aliveAccSum += r.aliveAcc; sampleSum += r.samples;
    starveSum += r.starved; orgSum += r.avgOrg; fortSum += r.forts;
    for (const k in r.fortKinds) kindSum[k] = (kindSum[k] || 0) + r.fortKinds[k];
    for (const k in r.ctrl) {
      const key = k + ':' + r.ctrl[k];
      ctrlTally[key] = (ctrlTally[key] || 0) + 1;
    }
  }

  const pct = n => (n / ROUNDS * 100).toFixed(1) + '%';
  const achieve = (tally.win + tally.perfect) / ROUNDS * 100;
  const kind = winKind();

  console.log('');
  console.log(L.name + ' · 自战 ' + ROUNDS + ' 局 · 目标 ' + kind +
              (SEED !== null ? ' · 种子 ' + SEED : ' · 无种子（不可复现）'));
  console.log('────────────────────────────────');
  console.log('失败        ' + String(tally.fail).padStart(4) + '   ' + pct(tally.fail));
  console.log('达成        ' + String(tally.win).padStart(4) + '   ' + pct(tally.win));
  console.log('超额        ' + String(tally.perfect).padStart(4) + '   ' + pct(tally.perfect));
  if (tally.stuck) console.log('异常卡死    ' + String(tally.stuck).padStart(4) + '   ' + pct(tally.stuck));
  console.log('────────────────────────────────');
  /* 区间文案跟着 pace 走。上一版这里写死"45–60%"，于是一份 85% 的爽局报表
     会同时出现「达成率 85%（目标区间 45–60%）」和「判定：达标」——
     读者根本不知道该信哪个。区间和判定必须是同一套标准。 */
  const rangeText = (L.pace === '爽局') ? '（爽局区间 65–90%）'
    : (String(L.type || '').includes('教学') || L.no === 0) ? '（教学关：目标就是能过）'
    : '（目标区间 45–60%）';
  console.log('达成率      ' + achieve.toFixed(1) + '%   ' + rangeText);
  if (kind === 'score') {
    console.log('平均得分    ' + (scoreSum / ROUNDS).toFixed(1) + ' / ' + L.winScore);
  } else if (kind === 'reach') {
    console.log('平均撤出    ' + (escapeSum / ROUNDS).toFixed(2) + ' / ' + api.escapeGoal() + ' 支');
  } else if (kind === 'survive') {
    console.log('核心保有    ' + (ROUNDS - keepNone) + ' / ' + ROUNDS + ' 局');
  }
  console.log('平均回合    ' + (turnSum / ROUNDS).toFixed(2) + ' / ' + L.maxTurns);
  console.log('我方损失    ' + (bLoss / ROUNDS * 100).toFixed(1) + '%');
  console.log('敌方损失    ' + (rLoss / ROUNDS * 100).toFixed(1) + '%');
  console.log('补给断绝单位 ' + (starveSum / ROUNDS).toFixed(1) + ' 个/局');
  console.log('我方平均组织度 ' + (orgSum / ROUNDS).toFixed(1));
  console.log('工事        ' + (fortSum / ROUNDS).toFixed(1) + ' 处/局  ' +
    ['H', 'B', 'P', 'A', 'F'].map(k =>
      k + (kindSum[k] ? (kindSum[k] / ROUNDS).toFixed(1) : '0')).join(' / '));
  /* 守备质量：工事利用率低说明"人不在工事里挨炮"，达成率会被严重低估 */
  const aliveAvg = aliveAccSum / Math.max(1, sampleSum);
  console.log('工事利用率  ' + (fortAccSum / Math.max(1, aliveAccSum) * 100).toFixed(1) +
    '%   （要点内 ' + (coreAccSum / Math.max(1, aliveAccSum) * 100).toFixed(1) +
    '%，平均存活 ' + aliveAvg.toFixed(1) + ' 个）');
  if (args.includes('--diag')) {
    console.log('────────────────────────────────');
    for (const o of L.objectives) {
      const row = ['blue', 'red', 'contested', 'none']
        .map(c => c + ' ' + (ctrlTally[o.id + ':' + c] || 0)).join('  ');
      console.log(('终局 ' + o.name).padEnd(14, ' ') + row);
    }
    console.log('终局 我方兵牌 ' + (blueAliveSum / ROUNDS).toFixed(1) +
                ' 个（守备营 ' + (gdnSum / ROUNDS).toFixed(1) + ' 个）' +
                (kind === 'reach' ? ' · 已撤出 ' + (escapeSum / ROUNDS).toFixed(2) : ''));
  }
  if (L.events && L.events.length) {
    console.log('────────────────────────────────');
    for (const ev of L.events) {
      const n = evtTally[ev.id] || 0;
      console.log(('事件 · ' + ev.desc).padEnd(24, ' ') + String(n).padStart(4) + '   ' + pct(n));
    }
    /* 0% 触发的事件基本等于死代码。要么触发条件写错了（id / 编制对不上），
       要么条件苛刻到玩家永远碰不到——两种情况都该有人看一眼，
       而不是让它在数据里躺半年（"205 装甲旅伤亡过半"就是这么躺过来的）。

       ev.rare === true 是作者的**主动声明**："这条是稀有分支，本来就不该每局都响"。
       有这个标记就放过，没这个标记就一律算死事件——约定写在数据里，
       不靠人每次盯着报表看。 */
    const dead = (L.events || []).filter(ev => !(evtTally[ev.id] || 0) && !ev.rare);
    const rareMiss = (L.events || []).filter(ev => !(evtTally[ev.id] || 0) && ev.rare);
    if (rareMiss.length) {
      console.log('稀有分支（声明 rare，0% 可接受）：' + rareMiss.map(e => e.desc).join('、'));
    }
    if (dead.length) {
      console.log('⚠ 从未触发：' + dead.map(e => e.desc).join('、') +
                  ' —— 查触发条件是否写死了不存在的兵牌 / 要点 / 编制');
    }
    /* 门禁。这条约定（"每个事件都必须真的会触发"）原来只靠自觉，
       现在有退出码兜着：死事件会让脚本非 0 退出，接进任何自动化都会红。
       --no-gate 留给"我知道它在查、先跑个数"的场合。 */
    if (dead.length && !args.includes('--no-gate')) {
      console.log('✗ 有 ' + dead.length + ' 条事件整局未触发，退出码置 1（--no-gate 可跳过此检查）');
      process.exitCode = 1;
    }
  }
  console.log('');

  /* 教学关不按达成率判定。
     新手引导的目标是"让所有人都能过"，100% 达成是**设计目标**，不是失衡。
     用正关的 45–60% 去卡它，只会把教学关一路往"难"的方向调，
     那正好和引导的目的相反。 */
  const isTutorial = String(L.type || '').includes('教学') || L.no === 0;
  /* 节奏定位（LEVEL.pace）比"关卡类型"更贴近设计意图。
     第 4 关波尔瓦萨港是**爽局**：七条军舰在港内持续火力支援，
     目标就是让玩家赢得痛快。用 45–60% 去卡它，只会把它越调越硬，
     最后变成"守着不动挨 20 回合"——那不是这一关要卖的东西。
     所以爽局单独一个区间。v4.12 从 75–95% 调成 **65–90%**：那个 75% 复现
     不出来（40 局 70.0 / 120 局固定种子 71.7 / 改动前引擎 67.5），而脚本本来
     就比真人弱一档，70% 已经意味着真人更高。再往上推数值会把这一关推向
     "守着不动挨 20 回合"，跟设计意图相反。 */
  const pace = L.pace || '';
  if (isTutorial) {
    console.log('判定：教学关，不以达成率为指标（目标就是能过）');
    if (achieve < 90) console.log('⚠ 教学关达成率 ' + achieve.toFixed(1) + '% 偏低——引导关不该卡人');
  } else if (pace === '爽局') {
    if (achieve > 90) console.log('判定：爽局，但几乎没有失败可能（' + achieve.toFixed(1) + '%）——可以收一点');
    else if (achieve >= 65) console.log('判定：达标（爽局区间 65–90%）');
    else if (achieve >= 55) console.log('判定：爽局还不够爽（目标 65–90%）——玩家该赢得更干脆');
    else console.log('判定：太难，爽局不该打成这样（目标 65–90%）');
  } else if (achieve > 70) console.log('判定：偏简单，红方需要加强');
  else if (achieve > 60) console.log('判定：略简单（目标区间 45–60%）');
  else if (achieve >= 45) console.log('判定：达标（目标区间 45–60%）');
  else if (achieve >= 35) console.log('判定：略难（目标区间 45–60%）');
  else console.log('判定：太难，蓝方需要加强');
})();
