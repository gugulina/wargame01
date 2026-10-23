const path = require('path');
const { loadGame } = require('./load');

const file = process.argv[2] && !process.argv[2].startsWith('-')
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'game', 'campaign.html');
const ROUNDS = Number(process.argv[3] || 200);
const VERBOSE = process.argv.includes('--verbose');

const { api } = loadGame(file);
const L = api.LEVEL;

const INIT_BLUE = L.units.filter(u => u.side === 'blue' && u.wave === 1).reduce((s, u) => s + u.str, 0);
const INIT_RED = L.units.filter(u => u.side === 'red' && u.wave !== 0).reduce((s, u) => s + u.str, 0);

function inCore(pos) {
  return L.objectives.some(o => o.core &&
    o.cells.some(c => c[0] === pos[0] && c[1] === pos[1]));
}
function isCoreCell(pos) {
  return L.objectives.some(o => o.core && o.cells.some(c => c[0] === pos[0] && c[1] === pos[1]));
}
function passable(pos) {
  return pos[0] >= 0 && pos[0] < L.rows && pos[1] >= 0 && pos[1] < L.cols &&
         api.TERRAIN[L.map[pos[0]][pos[1]]].cost < 99;
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

/* 蓝方：守备营与反坦克连据守要点，装甲旅作机动预备队，炮兵原地支援 */
async function blueTurn() {
  const st = api.getState();
  /* 工兵先动：同一格只能留一处工事，碉堡/要塞炮不能被堑壕占位 */
  const order = api.alive('blue').slice().sort((a, b) => {
    const ea = (a.type === 'eng' || a.type === 'engc') ? 0 : 1;
    const eb = (b.type === 'eng' || b.type === 'engc') ? 0 : 1;
    return ea - eb;
  });
  for (const u of order) {
    if (!api.alive('blue').includes(u)) continue;
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
    if (!u.fired && u.rng > 0) {
      const tg = api.targetsFor(u, st.fields);
      if (tg.length) {
        const evals = tg.map(t => ({ t, pv: api.previewAttack(u, t, st.fields) }))
                        .sort((a, b) => b.pv.ratio - a.pv.ratio);
        if (evals[0].pv.ratio >= 0.70) { api.doAttack(u, evals[0].t); continue; }
      }
    }

    /* 2. 炮兵没有目标就留在原地，不冒险前出 */
    if (api.isArty(u)) continue;
    if (u.moved) continue;

    /* 2b. 步兵挖堑壕：先把自筑工事顶满（+30%）、组织度也满，才拿这一回合换永久 +15%，
          否则等于拿「这一回合的组织度恢复 + 自筑工事成长」去换一个更差的工事。 */
    const engNear = api.alive('blue').some(e => e.type === 'eng' && api.cheb(e.pos, u.pos) <= 2);
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

    /* 4. 装甲旅：敌人未逼近要点就不动，保存实力做反冲击 */
    if (u.type === 'arm' || u.type === 'mech') {
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
      if (u.type === 'arm' || u.type === 'mech') {
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
        const held = api.alive('blue').some(x =>
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

async function playOne(idx) {
  api.newGame();
  const st = api.getState();
  let guard = 0;
  /* 每回合采样：蓝方有多少单位真在工事里、有多少在要点里。
     只看终局快照会被"人都死了"干扰，逐回合累计才能反映守备质量。 */
  let fortAcc = 0, coreAcc = 0, aliveAcc = 0, samples = 0;
  while (!st.result && guard < 60) {
    guard++;
    if (st.phase !== 'blue') break;
    await blueTurn();
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
    blueLoss: 1 - blueNow / INIT_BLUE,
    redLoss: 1 - redNow / INIT_RED,
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
  const kindSum = {};
  const ctrlTally = {};
  let blueAliveSum = 0, gdnSum = 0;
  let fortAccSum = 0, coreAccSum = 0, aliveAccSum = 0, sampleSum = 0;

  for (let i = 0; i < ROUNDS; i++) {
    const r = await playOne(i);
    tally[r.result] = (tally[r.result] || 0) + 1;
    for (const e of r.events) evtTally[e] = (evtTally[e] || 0) + 1;
    scoreSum += r.score; turnSum += r.turn;
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

  console.log('');
  console.log(L.name + ' · 自战 ' + ROUNDS + ' 局');
  console.log('────────────────────────────────');
  console.log('失败        ' + String(tally.fail).padStart(4) + '   ' + pct(tally.fail));
  console.log('达成        ' + String(tally.win).padStart(4) + '   ' + pct(tally.win));
  console.log('超额        ' + String(tally.perfect).padStart(4) + '   ' + pct(tally.perfect));
  if (tally.stuck) console.log('异常卡死    ' + String(tally.stuck).padStart(4) + '   ' + pct(tally.stuck));
  console.log('────────────────────────────────');
  console.log('达成率      ' + achieve.toFixed(1) + '%   （目标区间 45–60%）');
  console.log('平均得分    ' + (scoreSum / ROUNDS).toFixed(1) + ' / ' + L.winScore);
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
  if (process.argv.includes('--diag')) {
    console.log('────────────────────────────────');
    const names = { city: '岚口市', air: '机场', town: '青溪镇', fordW: '西渡口', fordE: '东渡口' };
    for (const k in names) {
      const row = ['blue', 'red', 'contested', 'none']
        .map(c => c + ' ' + (ctrlTally[k + ':' + c] || 0)).join('  ');
      console.log(('终局 ' + names[k]).padEnd(12, ' ') + row);
    }
    console.log('终局 我方兵牌 ' + (blueAliveSum / ROUNDS).toFixed(1) +
                ' 个（守备营 ' + (gdnSum / ROUNDS).toFixed(1) + ' 个）');
  }
  if (L.events && L.events.length) {
    console.log('────────────────────────────────');
    for (const ev of L.events) {
      const n = evtTally[ev.id] || 0;
      console.log(('事件 · ' + ev.desc).padEnd(24, ' ') + String(n).padStart(4) + '   ' + pct(n));
    }
  }
  console.log('');

  if (achieve > 70) console.log('判定：太简单，红方需要加强');
  else if (achieve < 35) console.log('判定：太难，蓝方需要加强');
  else console.log('判定：达成率在可接受区间');
})();
