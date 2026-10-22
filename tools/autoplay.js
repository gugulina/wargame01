const path = require('path');
const { loadGame } = require('./load');

const file = path.join(__dirname, '..', 'game', 'index.html');
const { api } = loadGame(file);

const ROUNDS = Number(process.argv[2] || 200);
const VERBOSE = process.argv.includes('--verbose');

const INIT_RED = api.LEVEL.units.filter(u => u.side === 'red').reduce((s, u) => s + u.str, 0);
const INIT_BLUE = api.LEVEL.units.filter(u => u.side === 'blue').reduce((s, u) => s + u.str, 0);

function blueGoal(u) {
  const enemies = api.alive('red');
  if (u.type === 'eng') {
    let best = null, bd = Infinity;
    for (const cell of api.runwayCells()) {
      const d = api.cheb(u.pos, cell);
      if (d < bd) { bd = d; best = cell; }
    }
    return best || u.pos;
  }
  if (!enemies.length) return u.pos;
  let best = enemies[0], bd = Infinity;
  for (const e of enemies) {
    const d = api.cheb(u.pos, e.pos);
    if (d < bd) { bd = d; best = e; }
  }
  return best.pos;
}

async function blueTurn() {
  const units = api.alive('blue').slice();
  for (const u of units) {
    if (!api.alive('blue').includes(u)) continue;
    if (u.fired) continue;

    let tg = api.targetsFor(u);

    if (tg.length === 0 && !u.moved && u.mov > 0 && u.type !== 'fac') {
      const enemies = api.alive('red');
      const near = enemies.some(e => api.cheb(u.pos, e.pos) <= 6);
      if (near) {
        const goal = blueGoal(u);
        const reach = api.computeReach(u);
        const curT = api.TERRAIN[api.LEVEL.map[u.pos[0]][u.pos[1]]];
        let best = null, bestScore = curT.def * 4;
        for (const key in reach) {
          const p = key.split(',').map(Number);
          const t = api.TERRAIN[api.LEVEL.map[p[0]][p[1]]];
          const score = t.def * 4 - api.cheb(p, goal) * 0.6;
          if (score > bestScore) { bestScore = score; best = p; }
        }
        if (best) api.doMove(u, best);
        tg = api.targetsFor(u);
      }
    }

    if (tg.length) {
      const evals = tg.map(t => ({ t, r: api.previewAttack(u, t).ratio }))
                      .sort((a, b) => b.r - a.r);
      if (evals[0].r >= 0.45) api.doAttack(u, evals[0].t);
    }
  }
}

async function playOne(idx) {
  api.newGame();
  const st = api.getState();
  let guard = 0;
  while (!st.result && guard < 80) {
    guard++;
    if (st.phase !== 'blue') break;
    await blueTurn();
    if (st.result) break;
    await api.endBluePhase();
  }

  const redNow = st.units.filter(u => u.side === 'red').reduce((s, u) => s + u.str, 0);
  const blueNow = st.units.filter(u => u.side === 'blue').reduce((s, u) => s + u.str, 0);

  if (VERBOSE && idx === 0) {
    console.log('--- 单局战报 ---');
    for (const l of st.log) console.log(l.text);
    console.log('---');
  }

  return {
    result: st.result || 'stuck',
    turn: st.turn,
    radarLost: st.flags.radarLost,
    redLoss: 1 - redNow / INIT_RED,
    blueLoss: 1 - blueNow / INIT_BLUE
  };
}

(async () => {
  const tally = { fail: 0, ok: 0, excellent: 0, stuck: 0 };
  let turnSum = 0, radarLost = 0, redLossSum = 0, blueLossSum = 0;

  for (let i = 0; i < ROUNDS; i++) {
    const r = await playOne(i);
    tally[r.result] = (tally[r.result] || 0) + 1;
    turnSum += r.turn;
    radarLost += r.radarLost ? 1 : 0;
    redLossSum += r.redLoss;
    blueLossSum += r.blueLoss;
  }

  const pct = n => (n / ROUNDS * 100).toFixed(1) + '%';
  const achieve = (tally.ok + tally.excellent) / ROUNDS * 100;

  console.log('');
  console.log('岚口机场保卫战 · 自战 ' + ROUNDS + ' 局');
  console.log('────────────────────────────────');
  console.log('失败        ' + String(tally.fail).padStart(4) + '   ' + pct(tally.fail));
  console.log('达成        ' + String(tally.ok).padStart(4) + '   ' + pct(tally.ok));
  console.log('超额        ' + String(tally.excellent).padStart(4) + '   ' + pct(tally.excellent));
  if (tally.stuck) console.log('异常卡死    ' + String(tally.stuck).padStart(4) + '   ' + pct(tally.stuck));
  console.log('────────────────────────────────');
  console.log('达成率      ' + achieve.toFixed(1) + '%   （目标区间 45–60%）');
  console.log('平均回合    ' + (turnSum / ROUNDS).toFixed(2) + ' / ' + api.LEVEL.maxTurns);
  console.log('雷达站被毁  ' + (radarLost / ROUNDS * 100).toFixed(1) + '%');
  console.log('敌方平均损失 ' + (redLossSum / ROUNDS * 100).toFixed(1) + '%');
  console.log('我方平均损失 ' + (blueLossSum / ROUNDS * 100).toFixed(1) + '%');
  console.log('');

  if (achieve > 75) console.log('判定：太简单，红方需要加强（增援提前或战力上调）');
  else if (achieve < 35) console.log('判定：太难，蓝方需要加强或失守阈值放宽');
  else console.log('判定：达成率在可接受区间，进入人工试玩验证手感');
})();
