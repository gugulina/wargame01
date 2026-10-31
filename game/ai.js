/* ═══════════════ 红方 AI（独立文件，v4.21 抽出）═══════════════

   为什么单独一个文件：这段有 848 行，原来是 campaign.html 里从
   「红方 AI」到 runAI 结束的一整段。改敌方脾气要在一万两千行里翻，
   翻完还得担心改错行——抽出来之后这里就是一个能整段读的文件。

   怎么加载：campaign.html 在引擎脚本**之前**放一行 script 标签指向本文件
   （src="ai.js?v=4.21"）。这里故意不写完整的标签形式——
   **HTML 解析器在脚本内容里看到闭合标签的字面量就会当场截断**，
   后半段全部代码变成非法 token。selftest 走纯文本拼接不会暴露，
   briefcheck 走 jsdom 会报 "Invalid or unexpected token"，踩过两次。
   顺序不能反。引擎顶层的 window.__WAR__ 导出表直接引用了 runAI / huntContact 等
   38 个符号，那些是 function 声明（有提升但只在本脚本内），AI 后加载就会
   在导出那一刻报 ReferenceError。反过来 AI 引用引擎的 state / LEVEL / TYPE /
   rng / sleep / FX 全在函数体内，调用时才解析，所以先加载没关系。

   依赖引擎的 41 个函数（都在调用期才解析，按类别）：
     查询类  hexDist neighbors alive other isAir isArmor isArty isHQ isTowed
             isDirectArty isBroken isGround attackRange minRange inRangeTargets
             targetsFor canTarget canFire canCapture terrainAt fortAt ctrlState
             objectiveControl objectivePush levelTypeText defStr hqRadius aaPenalty
             coordName disengaged
     计算类  computeReach previewAttack
     执行类  doMove doAttack doPack doUnpack doBridge fortSelf fortWorking
             updateControl log
     门面    aaPenalty → 见 aaPenalty/aaSuppressed 那三个各管一件事

   ⚠ 改这里的规则：三种脾气只在**四处**分岔——
     aiGoalFor()    往哪走
     aiMoveScore()  落脚在哪
     aiFireGate()   打不打
     scoreTarget()  打谁
   其余函数三种脾气共用。新增第五条分岔之前先想清楚：玩家要靠规律学，
   分岔越多越学不到。

   历史教训（别重犯）：v4.17 试过没有要抢的要点时向最近敌军推进，
   C2 突围关达成率从 45% 掉到 0%——红方离开封锁线去追人，逃生部队被逐个咬死。
   v4.21 的追击是**有条件的例外**：总点数压过对手 1.5 倍且士气在线才允许离开要点轴。

   测试：selftest 经 tools/load.js 按 HTML 里的 <script src> 顺序拼接后加载，
   briefcheck 把外链内联进 jsdom；变异改这个文件（tools/mutcheck.js 会自动
   判断锚点落在哪个文件）。改完跑 npm test 与 node tools/mutcheck.js。
   ═══════════════════════════════════════════════════════════ */

/* ───────────────────────── 红方 AI ───────────────────────── */
/* 三种脾气（v4.19 热补丁，不计版本号）。**按关卡类别配**，不逐关手写：

     关卡类别（LEVEL.type）          红方在干什么              AI
     坚守 / 防御 / 附属·防御          来抢要点                 夺取型 seize
     突围 / 迟滞 / 附属·撤离·护送·搜救 封堵、追击、歼灭         进攻型 assault
     附属·特种 / 破袭 / 夜战 / 防空    守着要点等你去撞          防守型 hold

   为什么按类别配而不是逐关写：类别本身就是"这一关谁在攻谁在守"的答案，
   逐关写会出现"同一类关卡两种脾气"，玩家学不到规律。
   关卡里仍可写 `aiStyle: 'assault'` 硬改（少数关需要例外时用），
   但那是例外，不是常规入口——`check.js` 会把写了但拼错的值报出来。

   三种性格只在**五处**分岔，全部收在下面这几个函数里，别散进 runAI：
     aiGoalFor()  往哪走 · aiMoveScore() 落脚在哪 · aiFireGate() 打不打 · scoreTarget() 打谁
     AI_STYLES[].contact  贴到一格还要不要问交换比（v4.23 接触交火，见 campaign.html
     里的 contactFire——判据在引擎侧，这里只放底价）

   ⚠ 一条历史教训写在这里：v4.17 试过"没有要抢的要点时向最近敌军推进"，
   C2 突围关的达成率从 45% 掉到 **0%**——红方离开封锁线去追人，逃生部队被逐个咬死。
   所以三种脾气平时都**共用同一个推进轴（要点）**，"进攻型"改的是
   "贴多近、打多狠、挑谁打"，不是"要不要守自己的阵地"。
   v4.21 的追击是这条教训的**有条件的例外**：只有总点数压过对手 1.5 倍、
   且全军士气还在线时才允许离开要点轴（见 aiHuntMode），
   不是"AI 更凶了"，而是"胜负已分时不该再演排队枪毙"。 */
const AI_STYLES = {
  /* 进攻型：优先消灭有生力量，高进攻欲望。
     开火门槛压到 0.55 / 0.30，挑目标偏"好打的"（残血、低战力），
     走位对掩体几乎不挑，且主动往最近敌军靠（但仍沿要点推进）。 */
  assault: {
    name: '进攻型',
    fireOther: 0.55, fireArty: 0.30,
    objPull: 1.2, foePull: 1.0, terrainWeight: 0.5,
    guard: false, allInOnObjective: false,
    preferKill: true, defensive: false,
    /* 破口（v4.20 第 2 批）：被比自己更靠近目标的敌人卡住时，
       这一枪是清路，门槛降到无效接触线以上最低的一档。 */
    breakthrough: true, breakGate: 0.40,
    /* 追击（v4.21）：总点数压过对手 1.5 倍且士气还在时，暂时离开要点轴，
       见 aiHuntMode / aiHuntTarget。 */
    hunt: true,
    /* v4.22 三条决策机制（docs/22）：
       stopLoss    M5 止损线（ratio 口径）：比这更亏的一枪不打
       pickSoft    M1 挑软要点的力度，0 = 不挑（谁近打谁）
       schwerpunkt M2 有没有"主攻方向"这个概念
       v4.23 contact M9 接触交火底价：步兵贴到一格就不再问交换比（见 contactFire） */
    stopLoss: 0.75, pickSoft: 0.6, schwerpunkt: true, contact: 0.20
  },
  /* 防守型：依托要点与工事据守，低进攻欲望。
     目标要点**包括已经在我手里的**（守方要待在自己阵地上），
     走位对地形防御与工事权重最高，已经在坑里又没敌人贴脸就不挪窝；
     只有比值 1.05 / 0.75 以上才开火，挑目标偏"离我最近的"。 */
  hold: {
    name: '防守型',
    fireOther: 1.05, fireArty: 0.75,
    objPull: 1.2, foePull: 0.0, terrainWeight: 3.0,
    guard: true, allInOnObjective: false,
    preferKill: false, defensive: true,
    digIn: true,
    /* v4.22：止损线等于它现在的开火门槛（1.05）——守方本来就只在划得来时打，
       M5 对 hold 基本是恒等变换，写出来只是让三条脾气在同一张表里可读。
       挑软 / 重心对 hold 没有意义：它不选目标，只补缺口（见 aiHoldGoal），
       aiGoalFor 在 hold 分支就返回了，走不到 M1 / M2 的判据。 */
    stopLoss: 1.05, pickSoft: 0, schwerpunkt: false
  },
  /* 夺取型：抢关键点。要点被蓝方据守时**不惜代价**（开火门槛归零），
     这是它与前两种最本质的区别——为了那 20 分，赔掉编制也认。 */
  seize: {
    name: '夺取型',
    fireOther: 0.85, fireArty: 0.55,
    objPull: 1.2, foePull: 0.0, terrainWeight: 2.0,
    guard: true, allInOnObjective: true,
    preferKill: false, defensive: false,
    /* v4.22：夺取型的止损线最高（0.90）——它是"为了要点赔编制"的那种脾气，
       再往上压就成了现在的样子：站在城下的营一个接一个往 1:3 里填。
       0.90 的含义是"至少打到 1:1 才值得上"，两个营凑一发就够得着（见文档）。 */
    stopLoss: 0.90, pickSoft: 1, schwerpunkt: true,
    /* v4.23 接触交火：夺取型是围城的一方，步兵贴上去就必须开火。
       底价 0.20 与攻坚令同档——低于这条线的单次交火在 CRT 上与 0.20 是
       同一档（1:3），底价只决定"几个营一起上"，不改变单次交换比。 */
    contact: 0.20,
    /* 追击（v4.21）：与进攻型同一套判定。防守型没有这一条——
       hold 的职责是钉在阵地上，离开要点去追人正是它最不该做的事。 */
    hunt: true
  },
};

/* 类别 → 脾气。键是 levelTypeText() 之后的样子（附属前缀已经剥掉）。
   读法：**玩家在干什么**决定红方在干什么——
     · 玩家守（坚守 / 防御 / 争夺 / 会战 / 巷战 / 登陆…）→ 红方来抢 → seize
     · 玩家跑（突围 / 撤离 / 追击）或抢时间（迟滞 / 阻击 / 歼灭）→ 红方追着打 → assault
     · 玩家去攻（进攻 / 特种 / 破袭 / 夜战 / 防空 / 清剿 / 斩首 / 突袭 / 空降）→ 红方是守备队 → hold
   表里没有的类别会让红方静默退回夺取型，所以 `check.js` 逐个关卡对表点名。 */
/* ───────────────── v4.22 三条决策机制（docs/22）─────────────────
   M5 不打的仗不打 / M1 攻其必救 / M2 重心转移。
   三条都绕开同一条硬闸，而且这条闸是**用户明确要求的**：

     **核心要点（core）必须打。**
     要塞、机场、防线枢纽是这一关的分；绕开它等于不打这一关。
     第一关"北岭要塞"的全部压力就来自这里——玩家把兵全堆在要塞上，
     敌人也必须压上来，而不是绕去啃后面的空要点、或者因为伤亡比不划算就不打了。

   于是三条机制都在"能不能省这一仗"上做了区分：
     · 打边角要点：可以挑软的、可以不打（省下来去打别处）
     · 打核心要点：一定要打，只是**不在 1:3 上填人**（M5 的核心闸仍比平时松）

   历史上这三条都是有出处的，见 docs/22 第二节；这里只留判定与数值。
   ───────────────────────────────────────────────────────────── */

/* M5 的止损线口径是 `previewAttack().ratio`（attSum/defSum），
   换算成战损比大约是这样（CRT 七档的期望值）：
     ratio 1.4 → 1.5:1 档 → 守方掉 4 / 攻方掉 2 ≈ 2.0
     ratio 0.9 → 1:1   档 → 3 / 3        ≈ 1.0
     ratio 0.65→ 1:1.5 档 → 2.3 / 4      ≈ 0.58
     ratio 0.4 → 1:2   档 → 1.8 / 5      ≈ 0.37
   **不能用"战损比"直接当门槛**：doAttack 里 defLoss/attLoss 要等骰子落定才知道，
   拿期望值当门槛会与实战错位一档。用 ratio 是因为它和开火门槛本来就是同一把尺子，
   两条判据能直接比大小。 */
const CORE_STOP = 0.55;     // 目标站在核心要点上：还是要压，但不打 1:2 以下的仗
/* 关于"要不要给核心要点额外引力"——**试过，撤了**（v4.22 实测记录见 docs/22 §7.3）。
   曾经加过 `CORE_PULL = 3`：核心要点额外值 3 格，理由是"等距的空边角会把整支军队引走"。
   结果 C3 从 49% 掉到 32%（红方全挤到城市和机场两个核心上，蓝方拿不下来），
   而 C1 一点没变——那一关只有一个要点，谁去都是去。
   所以这条引力只买到"多要点关卡更僵"，没买到"要塞更受重视"。
   核心要点的三条保障改由别处承担，各有一条断言盯着：
     ① aiObjPull 对 core 直接返回 0 —— 不吃"挑软的"的倒扣（要塞不会被绕过）；
     ② aiSchwerpunkt 的候选段只保留含核心的那些 —— 主攻方向必然是核心；
     ③ aiFireGate 对核心目标把止损线下调到 CORE_STOP —— 打要塞的门槛比打野外低。
   三条合起来已经覆盖"重点一定要打"，再叠引力的边际收益是负的。 */
/* M1：守备强度的两个刻度。空要点最多值 4 格，守备达到"我全场兵力"的 100%
   就倒扣 3 格——不是永远不去，而是"等条件成熟"（十大军事原则第八条）。 */
const SOFT_MAX = 4;
const SOFT_HARD = 1.0;
const SOFT_HARD_PENALTY = 3;
/* M2：重心的引力。文档写的是 ×1.35 / ×0.85 的倍率，这里换成**格数**加减，
   两个原因：① 引擎里所有"往哪走"的判据都是加法的（core 加权就是 −2 格），
   倍率混进来会让"距离为负时把核心反罚一遍"；② 格数可以直接写进断言。
   10 格处 ×1.35 ≈ −2.6 格，与 SP_BONUS 同量级。 */
const SP_BONUS = 2.5;
const SP_PENALTY = 1.5;
const SP_PERIOD = 2;        // 每两回合重算一次

/* 目标是不是站在「我还没拿下的核心要点」上。M1 / M5 的共同豁免口。 */
function onCoreObjective(t) {
  if (!t || !t.pos) return false;
  return (LEVEL.objectives || []).some(o => o.core &&
    o.cells.some(c => c[0] === t.pos[0] && c[1] === t.pos[1]) &&
    objectiveControl(o) !== 'red');
}
/* 我这一格是不是要点（不论归谁、不论核心）。站在要点上就得守，不吃 M5。 */
function onAnyObjective(u) {
  if (!u || !u.pos) return false;
  return (LEVEL.objectives || []).some(o =>
    o.cells.some(c => c[0] === u.pos[0] && c[1] === u.pos[1]));
}
/* 止损线：这一仗值不值得打。脾气没写就按夺取型的口径（宁可保守）。 */
function stopLossOf(st) {
  return (st && typeof st.stopLoss === 'number') ? st.stopLoss : 0.90;
}
/* M9 接触交火的"这一支脾气开不开这个口子"。
   contactFire 的第四个参数不给时会退到 CONTACT_RATIO，那是给断言用的默认值；
   AI 这边必须显式读 AI_STYLES[].contact —— 少这一层，防守型也会跟着出坑对射。 */
function aiContactFire(u, def, pv, st) {
  if (!st || typeof st.contact !== 'number') return false;
  return contactFire(u, def, pv, st.contact);
}

/* M1 的守备强度：要点格内与相邻一格内的敌军战力，按地形加成放大。
   相邻格只算 0.45 —— 贴着要点站的部队能补位，但不是"在阵地上"。
   飞机不算（占不了点，也拦不住步兵）。 */
function objectiveGarrison(o, side) {
  if (!o || !o.cells) return 0;
  let s = 0;
  for (const u of alive(side)) {
    if (isAir(u) || !(u.str > 0)) continue;
    let d = Infinity;
    for (const c of o.cells) d = Math.min(d, hexDist(u.pos, c));
    if (d > 1) continue;
    const t = terrainAt(u.pos[0], u.pos[1]);
    s += u.str * (d === 0 ? 1 : 0.45) * (1 + (t.def || 0));
  }
  return s;
}
/* M1 攻其必救：这个要点"软"到什么程度。返回相当于少走几格（负数=绕着走）。
   **核心要点直接返回 0**：不吃软硬判据——要塞必须打，见文件头那段。 */
function aiObjPull(o, u, st) {
  if (!o || o.core) return 0;
  if (!st || !st.pickSoft) return 0;
  const g = objectiveGarrison(o, other(u.side));
  const mine = Math.max(1, sideFieldPoints(u.side));
  const r = g / mine;
  if (r >= SOFT_HARD) return -SOFT_HARD_PENALTY * st.pickSoft;
  return SOFT_MAX * st.pickSoft * (1 - r / SOFT_HARD);
}
/* 要点的"列号"（重心分段用）。多格要点取平均，单格就是它自己。 */
function objCol(o) {
  if (!o || !o.cells || !o.cells.length) return 0;
  let s = 0;
  for (const c of o.cells) s += c[1];
  return s / o.cells.length;
}
/* 一段防线的有效防御值：段内各要点 2 格内的敌军，按组织度与地形折算后
   除以要点数。除以要点数是**故意的**——三个要点只有一支营守着，这一段
   就是虚的，重心该往这里压（这是"集中优势兵力"的判据，不是算术游戏）。 */
function bandDefense(objs, side) {
  let s = 0;
  for (const u of alive(side)) {
    if (isAir(u) || !(u.str > 0)) continue;
    let hit = false;
    for (const o of objs) {
      if (o.cells.some(c => hexDist(u.pos, c) <= 2)) { hit = true; break; }
    }
    if (!hit) continue;
    s += u.str * (Math.max(0, Math.min(100, u.org)) / 100) *
         (1 + (terrainAt(u.pos[0], u.pos[1]).def || 0));
  }
  return s / Math.max(1, objs.length);
}
/* M2 重心转移：每两回合在候选要点里挑一段最薄弱的当主攻方向。
   返回 { lo, hi, turn }：列号落在 [lo, hi] 的要点吃 SP_BONUS，其余吃 SP_PENALTY。

   两处与 docs/22 原文不同的收紧，都是为了让"要塞"这件事不被 M2 冲掉：
     ① 候选段只保留**含核心要点**的那些（有核心未拿下时）。否则重心一转，
        全军跑去打边角，要塞前面空了——玩家看到的不是"敌人在试探"，是"敌人走了"。
     ② 段数不够 2 就返回 null（不加权）。只有一段时"选重心"没有意义，
        硬加权会让同一批部队互相抵消。
   与 docs 的第二处不同：原文写"夺取型要已控制 ≥2 个要点才开重心"。这里不这么判——
   十关里六个是 seize，等它站稳才开等于这条机制永远不生效。 */
function aiSchwerpunkt(st, force) {
  if (!st || !st.schwerpunkt) return null;
  if (typeof state === 'undefined' || !state) return null;
  const cand = (LEVEL.objectives || []).filter(o => objectiveControl(o) !== 'red');
  if (!cand.length) { state.schwerpunkt = null; return null; }
  const turn = state.turn || 0;
  const cur = state.schwerpunkt;
  if (!force && cur && cur.turn <= turn && (turn - cur.turn) < SP_PERIOD) return cur;
  let lo = Infinity, hi = -Infinity;
  for (const o of cand) { const c = objCol(o); if (c < lo) lo = c; if (c > hi) hi = c; }
  const span = Math.max(1, hi - lo);
  const bands = [[], [], []];
  for (const o of cand) {
    const k = Math.min(2, Math.max(0, Math.floor((objCol(o) - lo) / span * 3)));
    bands[k].push(o);
  }
  let use = bands.filter(b => b.length);
  const cores = cand.filter(o => o.core);
  if (cores.length) use = use.filter(b => b.some(o => o.core));
  /* 只剩一段就返回 null：没有第二个选择，"重心"这个词就没有意义，
     硬加权只会让同一批部队互相抵消。单要点关卡（C1）走的就是这一条，
     注：这里不再单独判 `cand.length < 2` —— 一个要点只落一段，
     同一个 `use.length < 2` 已经覆盖了，多一道闸就多一处可能不同步的口径。 */
  if (use.length < 2) { state.schwerpunkt = null; return null; }
  let pick = null, best = Infinity;
  for (const b of use) {
    const d = bandDefense(b, other('red'));
    if (d < best) { best = d; pick = b; }
  }
  const cols = pick.map(objCol);
  const sp = { lo: Math.min(...cols), hi: Math.max(...cols), turn };
  state.schwerpunkt = sp;
  return sp;
}

const AI_STYLE_BY_TYPE = {
  /* 夺取型：来抢要点 */
  '防御': 'seize', '坚守': 'seize', '争夺': 'seize', '会战': 'seize', '巷战': 'seize',
  '突破': 'seize', '压缩': 'seize', '相持': 'seize', '对峙': 'seize', '威慑': 'seize',
  '终局': 'seize', '登陆': 'seize', '海战': 'seize',
  /* 进攻型：追歼、抢时间 */
  '突围': 'assault', '迟滞': 'assault', '阻击': 'assault', '歼灭': 'assault',
  '撤离': 'assault', '追击': 'assault', '渗透': 'assault', '搜救': 'assault',
  '护送': 'assault', '护航': 'assault', '机动': 'assault',
  /* 防守型：守备队，等你来撞 */
  '进攻': 'hold', '特种': 'hold', '破袭': 'hold', '夜战': 'hold', '防空': 'hold',
  '清剿': 'hold', '斩首': 'hold', '突袭': 'hold', '空降': 'hold', '侦察': 'hold',
  '教学': 'hold'
};
/* 这一关用哪种脾气：显式 aiStyle 优先，否则按类别查表，查不到才落默认。
   **查不到不静默**：check.js 会把"关卡类别不在表里"报出来——
   新关卡用了新类别词，AI 会一声不响退回夺取型，那种 bug 查起来极费劲。 */
function aiStyleKey(lv) {
  const L = lv || LEVEL;
  if (L && L.aiStyle && AI_STYLES[L.aiStyle]) return L.aiStyle;
  const t = levelTypeText(L);
  return AI_STYLE_BY_TYPE[t] || 'seize';
}
function aiStyle(lv) { return AI_STYLES[aiStyleKey(lv)]; }
/* 夺取型才带攻坚令：目标列表保留"敌方要点上的低比值目标"，
   doAttack 也放行同一批。别的脾气没有这个口子。
   追击期间再叠一层 hunt：目标列表与兜底闸都放开无效接触限制。
   v4.23 再加一层 contact：步兵贴到一格就交火（底价写在 AI_STYLES 里）。
   三层口子都走同一个 opts，所以 targetsFor 与 doAttack 不可能分家。 */
function aiTargetOpts(style, hunt) {
  const st = style || aiStyle();
  const o = {};
  if (st && st.allInOnObjective) o.pushObjective = true;
  if (hunt) { o.pushObjective = true; o.hunt = true; }
  if (st && typeof st.contact === 'number') o.contact = st.contact;
  return Object.keys(o).length ? o : undefined;
}

/* ───────────────── 追击（v4.21）─────────────────
   兵力占优时，夺取型 / 进攻型不再只盯着要点：沿途遇到的敌人都可以是目标，
   优先高价值单位，并且主动往敌人身上压。三条同时成立才进入：
     · 比例：本方全关卡点数 > 1.5 × 对方场上点数
     · 士气：本方在场部队的加权平均组织度 ≥ HUNT_MIN_ORG
     · 脾气：AI_STYLES.hunt（防守型永远不追）
   **全关卡点数包含未登场的波次**。这不是战力评估，是编制账：后续梯队
   写在关卡数据里，敌方指挥官知道自己手里还有多少牌；先头部队把人打崩、
   增援还在路上时，正是追击的窗口。已被歼灭的兵牌不计，未登场的计满编。

   士气是第二条闸，而且必须独立于兵力比：一支点数占优但组织度已经打散的
   部队追出去只会被反杀。掉到 HUNT_MIN_ORG 以下就立刻收兵，
   恢复原来的"目标轴"打法（state.huntOn 记录当前状态，只负责播报切换）。

   绿方（友军）是预留接口：alliedUnits('blue') 目前恒为空。
   实装时把友军兵牌放进 state.allies（结构与 state.units 相同，side 写 'green'），
   点数比较会自动把绿方算进蓝方一侧；不要在别处硬写 state.allies。 */
/* 追击的纸面倍率（v4.21 是 2，v4.22 下调到 1.5）。
   **口径是不对称的，这是设计，不是漏洞**：
     · 本方 = 场上存活 + **未登场的波次**（`aiSidePoints`）——指挥官知道自己
       手里还有几个团在路上；
     · 对方 = **只算场上**（`sideFieldPoints`）——他不知道你后面还藏着什么。
   所以 1.5 倍不等于"他比你多一半兵力"，而是"他**自己算下来**比你多一半"。
   这个不对称正是追击窗口的来源：先头部队把你打崩、增援还在路上时，
   在他看来是 3 倍、在真实棋盘上可能只是平手——那一仗本来就该打。

   为什么从 2 降：2 倍在十关里只有 C1 开局够得上（2.06），追击等于一个
   摆设机制。1.5 让"我在赢"更早被感知到，同时士气闸（≥60）仍然拦着
   "打散了还追"的那种蠢事。 */
const HUNT_RATIO = 1.5;
const HUNT_MIN_ORG = 60;
const HUNT_PULL = 1.2;

function alliedUnits(side) {
  if (side !== 'blue') return [];
  const list = (state && Array.isArray(state.allies)) ? state.allies : [];
  return list.filter(u => u && u.side === 'green' && !(u.str <= 0));
}
/* 场上点数：活着的部队。友军按蓝方一侧合计。 */
function sideFieldPoints(side) {
  let s = 0;
  for (const u of alive(side)) if (u.str > 0) s += Math.max(0, Number(u.str) || 0);
  for (const u of alliedUnits(side)) s += Math.max(0, Number(u.str) || 0);
  return s;
}
/* 还没入场的波次点数。以 LEVEL.waves 的登场标记为准，
   没有声明的 wave>1 兵牌不会入场，也不该被算成"我手里的牌"。 */
function pendingWavePoints(side) {
  let s = 0;
  for (const def of (LEVEL.units || [])) {
    if (def.side !== side) continue;
    const w = def.wave || 1;
    if (w > 1 && !(state.flags && state.flags['wave' + w])) s += defStr(def);
  }
  return s;
}
function aiSidePoints(side) { return sideFieldPoints(side) + pendingWavePoints(side); }
/* 全军士气：按战力加权。一支残编小队崩了不该把主力的士气一起拉下水。 */
function aiAvgOrg(side) {
  let sum = 0, w = 0;
  for (const u of alive(side)) {
    if (!(u.str > 0)) continue;
    const k = Math.max(1, Number(u.str) || 0);
    sum += (Number(u.org) || 0) * k;
    w += k;
  }
  return w > 0 ? sum / w : 0;
}
function aiHuntMode() {
  const st = aiStyle();
  if (!st || !st.hunt || st.defensive) return false;
  if (!(aiSidePoints('red') > HUNT_RATIO * sideFieldPoints('blue'))) return false;
  return aiAvgOrg('red') >= HUNT_MIN_ORG;
}
/* 每回合红方阶段开始调一次：算当前该不该追，状态变了才播报。
   返回这一回合的实际状态，runAI 直接用它，避免读到一个过期的 state.huntOn。 */
/* 两军有没有真的照面：任意一对红蓝地面单位距离 ≤ 1。
   追击播报要等这个条件——兵力比是**编制账**，开局就成立（C1 红 140 vs 蓝 68 = 2.06），
   可那时候双方还隔着半个地图。第 1 回合就弹「敌军追击」，读着像敌人开挂。 */
function huntContacted() {
  const live = s => state.units.filter(u => u.side === s && u.str > 0 && !isAir(u));
  const blue = live('blue'), red = live('red');
  for (const b of blue) for (const r of red) {
    if (hexDist(b.pos, r.pos) <= 1) return true;
  }
  return false;
}
function aiHuntTick() {
  if (!state) return false;
  const on = aiHuntMode();
  const changed = !!state.huntOn !== on;
  state.huntOn = on;
  if (on) {
    /* 状态照常切换（AI 行为一点不变），只把播报压到接敌那一回合补播。
       `huntSaid` 和 `huntOn` 一样是纯播报记账，不进存档——读档后最多多播一次，
       比"整局看不到追击提示"好。 */
    if (!state.huntSaid && huntContacted()) {
      state.huntSaid = true;
      log('◆ 敌军判定兵力占优，转入追击：沿途遭遇即打，优先高价值目标。', 'r');
      if (typeof FX !== 'undefined' && FX.banner) FX.banner('敌 军 追 击', 'r', 2400);
    }
  } else if (changed) {
    state.huntSaid = false;
    log('敌军停止追击，收拢队形，恢复既定作战节奏。', 'sys');
    if (typeof FX !== 'undefined' && FX.banner) FX.banner('敌 军 收 拢', 'sys', 2200);
  }
  return on;
}
/* 追击时"这个目标值多少分"。编制越大越值钱，指挥、炮兵、辎重、
   装甲、工兵与侦察这些"打掉就瘫一片"的单位再额外加权。 */
function huntValue(t) {
  if (!t) return 0;
  let v = Math.max(0, Number(t.str) || 0) * 0.12;
  if (isHQ(t)) v += 1.0;
  if (isArty(t)) v += 0.7;
  if (t.type === 'sup') v += 0.5;
  if (isArmor(t)) v += 0.35;
  if (t.type === 'eng' || t.type === 'engc' || t.type === 'rec') v += 0.3;
  if (isBroken(t)) v += 0.2;
  return v;
}
/* 往谁身上追。价值优先、距离只做轻罚：1.5 倍兵力下，
   绕两格去摘炮比就近咬一个步兵营值。 */
function aiHuntTarget(u) {
  if (!u || !u.pos) return null;
  let best = null, bs = -Infinity;
  for (const t of alive(other(u.side))) {
    if (!t || !t.pos || !(t.str > 0)) continue;
    const s = huntValue(t) - hexDist(u.pos, t.pos) * 0.12;
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}
/* 追击期间放开"无效接触"闸：比值再难看也允许开火。
   与 objectivePush 分开写，因为它们回答的是两个问题——
   那条是"要点必须抢"，这条是"胜负已分，该收割了"。 */
function huntContact(att, def, opts) {
  return !!(opts && opts.hunt && att && def && !isBroken(att));
}

/* 目标价值（v4.20 第 1 批）：排序与开火门槛共用同一份判断。
   以前 scoreTarget 给要点、工事、残部各加各的分，aiFireGate 却只看一个常数——
   排在前面的目标可能因为比值差 0.01 被门槛拦下，AI 于是"看到好目标但不打"。
   现在两边都读 targetValue：分值决定"先打谁"，折扣决定"值不值得为它冒险"。
   discount 封顶 0.15：价值再高也只是把门槛挪一档，不能变成无条件进攻。 */
function targetValue(t, pv) {
  if (!t) return { score: 0, discount: 0 };
  let score = 0, discount = 0;
  /* 站在敌方/争夺中要点上的目标：打掉它就可能翻转控制权。 */
  if (onEnemyObjective(t)) { score += 0.6; discount += 0.15; }
  /* 工事快破：这一炮可能把掩体掀掉，后续每一炮都跟着变便宜。 */
  const f = fortSelf(t);
  if (f && fortWorking(f) && f.maxHp) {
    if (f.hp <= 1) { score += 0.3; discount += 0.05; }
    else if (f.hp <= 2) { score += 0.1; }
  }
  /* 残部：组织度越低越该补刀——它下回合能恢复，放过就是放虎归山。 */
  if (isBroken(t)) { score += 0.4; discount += 0.10; }
  else if (t.org < 40) { score += 0.2; discount += 0.05; }
  /* 孤立：没有相邻友军分摊防御，打它不会替别人做嫁衣。 */
  if (pv && pv.defHelp && pv.defHelp.length === 0) {
    score += 0.2; discount += 0.05;
  }
  return { score, discount: Math.min(0.15, discount) };
}

/* 目标离最近的要点多远（v4.20 第 2 批）。
   防守型要判"谁在威胁我守的阵地"，而不是"谁离我这个兵牌最近"——
   守军站在哪是次要的，敌人往哪块阵地压才是主要的。 */
function nearestObjectiveDist(pos) {
  let d = Infinity;
  for (const o of LEVEL.objectives || []) {
    for (const c of o.cells) {
      const x = hexDist(pos, c);
      if (x < d) d = x;
    }
  }
  return d;
}
function holdThreatBonus(t) {
  if (!t || !t.pos) return 0;
  return Math.max(0, 4 - nearestObjectiveDist(t.pos)) * 0.12;
}

function scoreTarget(att, t, fields, style, hunt) {
  const pv = previewAttack(att, t, fields);
  let s = pv.ratio;
  /* 多面进攻过的格子值更多分：防御已经被第一波攻击拉开，
     第二炮是真正的破防炮——AI 该知道把火力砸向同一个伤口。 */
  if (pv.flanked) s += 0.3;
  if (isHQ(t)) s += 0.8;
  if (isArty(t)) s += 0.6;
  if (t.type === 'sup') s += 0.4;
  if (!pv.counter) s += 0.35;
  s += targetValue(t, pv).score;
  /* 进攻型：先吃掉好打的。挑"最硬的"会把主力磨在工事上，
     而歼灭战看的是"这一轮谁先归零"——残血与低战力优先。 */
  if (style && style.preferKill) s += Math.max(0, 8 - t.str) * 0.08;
  /* 防守型：谁离要点最近谁最危险。守方要守的是这块地，不是杀敌数；
     旧口径看"离我多近"，守军往哪站哪里就成了威胁榜，换防一次排序全乱。 */
  if (style && style.defensive) s += holdThreatBonus(t);
  /* 追击：高价值单位排序整体上浮。分值不按"好打"算，按"打掉最疼"算——
     指挥部、炮兵、辎重、装甲、工兵和侦察是优先收割对象。 */
  if (hunt) s += huntValue(t);
  return s;
}

/* ── 防守型的守军 / 预备队（v4.20 第 2 批）──
   旧行为：所有守军每回合都朝"离自己最近的要点"挪，于是两个问题——
   ① 已经站在要点或工事里的部队也跟着挪，坑里的人换来换去；
   ② 全体被吸到最近的一个点，别的要点没人管。
   新口径：站在要点或己方仍在工作的工事里的算守军，原地不动；
   其余算预备队，只去"更需要的要点"。 */
function aiHoldGarrison(u) {
  if (!u || !u.pos) return false;
  if (LEVEL.objectives.some(o =>
    o.cells.some(c => c[0] === u.pos[0] && c[1] === u.pos[1]))) return true;
  const f = fortSelf(u);
  return !!(f && fortWorking(f));
}
/* 要点是不是正被威胁：争夺中，或者有能占领、未崩溃的敌军摸到 2 格内。
   飞机占不了点，崩溃的部队组织不起进攻，两者都不算。 */
function aiObjectiveThreatened(o, side) {
  if (!o) return false;
  if (ctrlState(o) === 'contested') return true;
  const foe = side === 'blue' ? 'red' : 'blue';
  return alive(foe).some(f => canCapture(f) && !isBroken(f) &&
    o.cells.some(c => hexDist(f.pos, c) <= 2));
}
/* 要点上有没有己方部队。按 updateControl 的口径只看 canCapture：
   旗子还挂着，预备队就该先过去，不能因为守军"快崩了"就当成没人。 */
function aiObjectiveHeld(o, side) {
  return alive(side).some(u => canCapture(u) &&
    o.cells.some(c => c[0] === u.pos[0] && c[1] === u.pos[1]));
}
/* 预备队去哪。守军不动；预备队按"受威胁且没人守 > 没人守 > 受威胁"排序，
   同档取离自己近的。没有缺口时去最近的要紧阵地待命，不留在野地里。 */
function aiHoldGoal(u) {
  if (!u || !u.pos) return null;
  if (aiHoldGarrison(u)) return null;
  const objs = LEVEL.objectives || [];
  if (!objs.length) return null;
  let pick = null, best = -Infinity;
  for (const o of objs) {
    const held = aiObjectiveHeld(o, u.side);
    const threat = aiObjectiveThreatened(o, u.side);
    let s = 0;
    if (threat && !held) s = 3;
    else if (!held) s = 2;
    else if (threat) s = 1;
    let d = Infinity;
    for (const c of o.cells) d = Math.min(d, hexDist(u.pos, c));
    s -= d * 0.01;
    if (s > best) { best = s; pick = o; }
  }
  if (!pick) return null;
  let cell = null, cd = Infinity;
  for (const c of pick.cells) {
    const d = hexDist(u.pos, c);
    if (d < cd) { cd = d; cell = c; }
  }
  return cell;
}

/* 往哪走。三种脾气共用同一条推进轴（要点），差别只在"要不要顺手吃人"：
   目标点的取法分两类——
     · 夺取型：**还没归我**的要点，核心要点另有 2 格加权
     · 防守型：守军留在原地，预备队补受威胁的空缺口（见 aiHoldGoal）
   进攻型沿用夺取型的目标点：它靠 foePull 把走位往敌人身上拽，而不是换目标。 */
function aiGoalFor(u, style, hunt) {
  const st = style || aiStyle();
  if (st === AI_STYLES.hold) return aiHoldGoal(u);
  /* 追击：暂时离开要点轴。目标是敌军里最值钱的那一支，
     没有敌人时才落回原来的要点推进。 */
  if (hunt) {
    const ht = aiHuntTarget(u);
    if (ht) return ht.pos.slice();
  }
  let list = LEVEL.objectives.filter(o => objectiveControl(o) !== 'red');
  if (!list.length) list = LEVEL.objectives.slice();
  if (!list.length) return null;
  /* M2 重心：列号落在主攻段上的要点少走几格，其余多走几格。
     只算一次、缓存在 state.schwerpunkt（每两回合重算），
     否则每支兵牌每次调用都重新聚一遍类，一回合几十次纯浪费。 */
  const sp = aiSchwerpunkt(st, false);
  let best = null, bd = Infinity;
  for (const o of list) {
    /* M1 挑软：空要点 / 守备薄弱的少走几格；硬壳倒扣几格。
       核心要点在 aiObjPull 里直接返回 0，所以要塞不吃这一条。 */
    const soft = aiObjPull(o, u, st);
    const inSp = sp && objCol(o) >= sp.lo && objCol(o) <= sp.hi;
    const spAdj = sp ? (inSp ? -SP_BONUS : SP_PENALTY) : 0;
    for (const cell of o.cells) {
      /* 夺取型：核心要点优先（那 20 分比边角值钱）。
         v4.22 起这条对**所有**脾气生效（原来只有夺取型有）——
         核心要点是这一关的分，进攻型也不该绕开它。
         注意这里**没有**额外的 CORE_PULL：试过，C3 因此掉 17 个点，
         原因写在 CORE_STOP 上面那段注释里。 */
      const d = hexDist(u.pos, cell)
        - (st.allInOnObjective && o.core ? 2 : 0)
        - soft + spAdj;
      if (d < bd) { bd = d; best = cell; }
    }
  }
  return best;
}

/* 落脚格打分。三种脾气的唯一差别都在这几个系数里（见 AI_STYLES）：
   地形防御权重（防守型 3.0 vs 进攻型 0.5）、朝最近敌军的吸引（进攻型 1.0）。 */
function aiMoveScore(u, p, goal, style, hunt) {
  const st = style || aiStyle();
  const t = terrainAt(p[0], p[1]);
  let s = -hexDist(p, goal) * st.objPull + t.def * st.terrainWeight;
  if (st.foePull) {
    let mind = Infinity;
    for (const f of alive(other(u.side))) mind = Math.min(mind, hexDist(p, f.pos));
    if (mind < Infinity) s -= Math.min(mind, 6) * st.foePull;
  }
  /* 追击：夺取型平时 foePull=0（只认要点），追击期间额外往最近敌军压。
     目标轴已经指向高价值单位，这一项保证"沿途遇到谁都贴上去"，
     而不是眼里只有那一个目标、路过残部不闻不问。 */
  if (hunt) {
    let mind = Infinity;
    for (const f of alive(other(u.side))) mind = Math.min(mind, hexDist(p, f.pos));
    if (mind < Infinity) s -= Math.min(mind, 8) * HUNT_PULL;
  }
  /* 防守型把己方工事当成家：一格碉堡/要塞炮比多两格的空地值钱。 */
  if (st.digIn) {
    const f = fortAt(p[0], p[1]);
    if (f && f.side === u.side) s += 2.5;
  }
  /* 炮兵怕贴脸——这条与脾气无关，谁的炮被贴住都打不出东西。 */
  if (isArty(u)) {
    let mind = Infinity;
    for (const f of alive(other(u.side))) mind = Math.min(mind, hexDist(p, f.pos));
    if (mind < 2) s -= isDirectArty(u) ? 25 : 40;
    /* v4.17：提前一回合起身。原来的分界只有"2 格内"和"3 格内加分"，
       敌人在 2 格时它才想起要跑，这一回合已经来不及。 */
    else if (mind < 3) s -= isDirectArty(u) ? 10 : 18;
    else if (mind <= 4) s += 1.5;
  }
  return s;
}

/* 打不打。门槛是"这一仗值不值得"，三种脾气三套数字；
   多面进攻过的格子放松 0.15（第一波已经把防御拉开），
   移动之后再打另加 0.05（阵型没展开），集火再放松 0.15（下一炮有人接）。
   目标价值也往下拉（targetValue.discount，封顶 0.15）。
   breakthrough 为真时按破口价（st.breakGate，进攻型 0.40）封顶。
   两条硬规则：打不还手的一律放行；任何门槛都不低于 0。 */
function aiFireGate(u, def, pv, style, afterMove, massed, breakthrough, hunt) {
  const st = style || aiStyle();
  /* 零风险火力（v4.20）：对方没有还手之力时，这一炮的本钱是白赚的。
     以前这里只看比值，炮兵于是经常放过"贴着残部打"的白打机会——
     玩家看到的就是"敌人不补刀"。 */
  if (pv && pv.counter === false) return 0;
  /* M9 接触交火（v4.23）：步兵已经贴到一格，这一枪不再按性价比打折。
     三层闸（目标列表 / 这里 / doAttack 兜底）必须放同一个判据——
     列表放行了、这里再卡一次，屏幕上还是"敌人贴着我站着不动"。 */
  if (aiContactFire(u, def, pv, st)) return 0;
  /* 追击（v4.21）：不再"挑肥拣瘦"——不按这一关的脾气打折，门槛基线取 0。
     **但止损线照旧**（见下面的 floor）。v4.21 这里原本是 `return 0`，
     等于"追击期间连生死都不挑"：C1 从第 1 回合就满足追击条件（兵力比 2.06），
     红方于是在要塞城下一个营一个营往 1:3 里填——打掉对方 2 点、自己掉 7 点，
     8 个回合把自己磨光。玩家看到的不是"被围强攻"，是"敌人排队送死"。 */
  let g = hunt ? 0 : (isArty(u) ? st.fireArty : st.fireOther) - (pv.flanked ? 0.15 : 0);
  if (!hunt && afterMove) g += 0.05;
  /* 集火预支：本回合还有第二支能打到同一目标的部队没开火，
     这一炮是在替它拆防御，亏一点也值。
     防守型不参与——出坑反击不是守方该干的事（v4.17 已证明守方离坑会丢要点）。 */
  if (massed && !st.defensive && !pv.flanked && !hunt) g -= 0.15;
  /* ── M5 不打的仗不打（v4.22，docs/22 §三·M5）──
     史：十大军事原则第五条"不打无准备无把握之仗"；十六字诀"敌进我退"。
     判的是"这一仗该不该打"，与上面那些"这一枪值不值"是两把尺子，
     所以它是**保底**：把门槛往上抬，抬到"打得动"为止。

     **与 allInOnObjective 的关系改了**：那条原来把门槛压到 0
     （"为了要点赔本也认"），结果就是红方站在城下，一个营一个营往 1:3 里填——
     C1 实测打掉对方 2 点、自己掉 7 点，8 个回合双方各损失 76%，
     全靠"蓝方先手守核心"才没输。现在 allIn 只能把线压到 CORE_STOP（0.55），
     压不到 0：**要塞必须打，但不在 1:2 以下填人**。
     压上去的时机应该是"炮火准备完、两个营凑齐"，这也是历史上攻城的样子。

     三条豁免，缺一条就会把该打的仗也拦掉：
       · 自己在要点格上 → 完全不吃 M5。站在要点上就得守，为了省编制把旗子
         让出去是另一种输法（`floor` 保持 −1 就是这个意思）。
       · 目标是核心要点 / 站在敌方要点上 → 线降到 CORE_STOP。
       · 破口那一枪（breakthrough）→ 不吃 M5。它是"路被堵住"的清路价，
         明码写在 AI_STYLES.breakGate 里，比这条线更有针对性。 */
  let floor = -1;
  if (def && !onAnyObjective(u)) {
    floor = onCoreObjective(def) ? CORE_STOP : stopLossOf(st);
  }
  if (floor >= 0 && st.allInOnObjective && def && onEnemyObjective(def)) {
    floor = Math.min(floor, CORE_STOP);
  }
  if (floor >= 0 && !breakthrough) g = Math.max(g, floor);
  /* 进攻型的破口：被卡在路上的那一枪按清路价打（见 aiBreakthroughTarget）。 */
  if (breakthrough && st.breakGate) g = Math.min(g, st.breakGate);
  /* 夺取型的不惜代价（v4.22 起只剩"列表放开"这一半，
     门槛那一半交给上面的 floor —— 0 门槛等于不设防地送死）。 */
  g -= targetValue(def, pv).discount;
  return Math.max(0, g);
}
/* 本回合还有没有第二支能打到同一目标的友军没开火（v4.20 集火预支）。
   只认"能打到、能开火、还没打过"——已经打过的那支输出已经交了，不能拿它当理由。 */
function aiMassedAttack(u, def) {
  if (!u || !def) return false;
  return alive(u.side).some(a => {
    if (a === u || isBroken(a) || a.fired) return false;
    if (a.rng <= 0 || !canTarget(a, def) || !canFire(a)) return false;
    const d = hexDist(a.pos, def.pos);
    return d >= minRange(a) && d <= attackRange(a);
  });
}
/* 这一格是不是"敌方（或争夺中的）要点"。用于夺取型的 all-in 判定。 */
function onEnemyObjective(def) {
  if (!def || !def.pos) return false;
  return LEVEL.objectives.some(o =>
    o.cells.some(x => x[0] === def.pos[0] && x[1] === def.pos[1]) &&
    objectiveControl(o) !== 'red');
}

/* 卡住了没有：这一回合所有能停的格子都不比现在更靠近目标。
   目标格被敌军占着时永远差一步——AI 会年复一年地贴着它站，
   却因为开火门槛差 0.1 一枪不放。 */
function aiStuck(u, goal) {
  if (!u || !goal) return false;
  const d0 = hexDist(u.pos, goal);
  const reach = computeReach(u);
  for (const key in reach.stop) {
    const p = key.split(',').map(Number);
    if (hexDist(p, goal) < d0) return false;
  }
  return true;
}
/* 破口（v4.20 第 2 批）：进攻型被一个"比我更靠近目标"的敌人卡住时，
   这一枪是清路，不是挑好打的。只认挡在前进方向上的目标；
   炮与飞机不参与——炮是支援火力，飞机不走这条路。 */
function aiBreakthroughTarget(u, style, fields) {
  const st = style || aiStyle();
  if (!st || !st.breakthrough || st.defensive) return null;
  if (!u || isArty(u) || isAir(u)) return null;
  const goal = aiGoalFor(u, st);
  if (!goal || !aiStuck(u, goal)) return null;
  const d0 = hexDist(u.pos, goal);
  let best = null, bs = -Infinity;
  for (const t of targetsFor(u, fields)) {
    if (hexDist(t.pos, goal) >= d0) continue;
    const s = scoreTarget(u, t, fields, st);
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}


/* 关于"进攻意愿低"（v4.17 反馈第 2 条）——试过三种改法，全部 A/B 记录在案：

   ① 把开火门槛从 0.85 / 0.90 降到 0.80：C3 的蓝方达成率 50% → 80%。
      红方在 0.8 上下硬换血，把自己换没了。观感更凶，实质更弱。
   ② "没有要抢的要点时向最近敌军推进"：C2 突围关 45% → **0%**。
      红方离开封锁线去追人，逃生部队被逐个咬死，整关不可通。
   ③ 护卫部队回身救炮兵（4 格内全员回防）：C3 50% → 97%。
      主力被自己的炮拽回去，要点没人占。

   三次都指向同一件事：**这十关的平衡建立在"红方按既定目标稳扎稳打"上**，
   任何"更主动"的改法都会打破它，而且破的方向并不直观。
   所以这一条改成**不碰目标函数**：只做两件不改变推进路线的事——
     · 炮兵提前一回合躲（见下面的 mind < 3）
     · 贴身的护卫打掉威胁（见 guard，只改开火优先级，不改走位）
   真要"敌人更凶"，正确的手段是加编制（辎重队、预备队），不是改 AI 的脾气。 */
/* 「我方哪个值钱的东西正被人贴脸」（v4.17）。
   返回 { mate, foe, d }：最近的那一对。只统计**敌方地面/水面**贴到 3 格内的；
   飞机不算——防空不是步兵靠过去能解决的问题，让战斗部队追着飞机跑
   会把整条战线拽散，这一条交给防空单位（它们在上面另有一条分支）。 */
function aiGuardSituation(u) {
  const mate = alive(u.side).filter(m => m !== u && (isHQ(m) || isArty(m) || m.type === 'sup'));
  let worst = null;
  for (const m of mate) {
    let nd = 99, near = null;
    for (const f of alive(other(u.side))) {
      if (isAir(f)) continue;
      const d = hexDist(m.pos, f.pos);
      if (d < nd) { nd = d; near = f; }
    }
    if (near && nd <= 3 && (!worst || nd < worst.d)) worst = { mate: m, foe: near, d: nd };
  }
  return worst;
}

/* 崩溃收拢（v4.20 第 1 批）：组织度跌破崩溃线的部队已经不能开火、不能占点，
   留在原地唯一的结果是被补刀，而且贴着敌人永远回不到恢复线。
   让它往后退——先离敌越远越好，其次挑地形防御与己方工事。
   这一步只对**已崩溃**的部队生效，不碰任何还能打的部队的推进轴。 */
function aiRetreatScore(u, p) {
  let mind = Infinity;
  for (const f of alive(other(u.side))) mind = Math.min(mind, hexDist(p, f.pos));
  if (mind === Infinity) mind = 6;
  let s = Math.min(mind, 6) * 10;
  if (!isAir(u)) {
    s += terrainAt(p[0], p[1]).def * 2;
    const f = fortAt(p[0], p[1]);
    if (f && f.side === u.side && fortWorking(f)) s += 3;
  }
  return s;
}
function aiRetreat(u) {
  const reach = computeReach(u);
  let best = null, bs = -Infinity;
  for (const key in reach.stop) {
    const p = key.split(',').map(Number);
    if (p[0] === u.pos[0] && p[1] === u.pos[1]) continue;
    const s = aiRetreatScore(u, p);
    if (s > bs) { bs = s; best = p; }
  }
  if (!best) return false;
  return doMove(u, best) === true;
}
/* 关键要点上的最后一支守军不能撤：它一走后脚旗子就换色，整关直接输。
   "最后一支"指这一格里除它之外没有别的未崩溃友军。 */
function aiBrokenHoldObjective(u) {
  if (!u || !u.pos) return false;
  for (const o of LEVEL.objectives || []) {
    if (!o.cells.some(c => c[0] === u.pos[0] && c[1] === u.pos[1])) continue;
    const vital = o.core || (LEVEL.win && LEVEL.win.keep && LEVEL.win.keep.includes(o.id));
    if (!vital) return false;
    return !alive(u.side).some(a => a !== u && !isBroken(a) &&
      o.cells.some(c => c[0] === a.pos[0] && c[1] === a.pos[1]));
  }
  return false;
}
/* 崩溃部队这一回合的动作：已经动过就不动；关键要点上的最后一支守军也不动；
   已经脱离接触（2 格内无敌军）的就地收拢，别为了挪而挪；
   还贴着敌人的才往后撤。单独成函数是为了让"该撤 / 不该撤"能从测试里直接驱动——
   挂在 runAI 分支里的话，变异回退不会让任何断言变红。 */
function aiBrokenAction(u) {
  if (!u || u.moved) return false;
  if (aiBrokenHoldObjective(u)) return false;
  if (disengaged(u)) return false;
  return aiRetreat(u);
}

async function runAI() {
  /* 这一关红方的脾气（v4.19 热补丁）。整场只取一次：
     关卡中途不会换类别，每支部队各查一遍只是白算。 */
  const style = aiStyle();
  /* 追击判定每回合算一次：兵力比 + 士气。返回的是本回合的实际状态，
     不能读 state.huntOn——那可能是上一回合留下的值。 */
  const hunt = aiHuntTick();
  /* 夺取型带攻坚令：敌方要点上的低比值目标也进列表、也放行。
     另外两种脾气这里是 undefined，targetsFor / doAttack 走原来的闸。
     追击期间再叠加 hunt 口子（见 aiTargetOpts）。 */
  const pushOpts = aiTargetOpts(style, hunt);
  const goalOf = u => aiGoalFor(u, style, hunt);
  const acts = alive('red').slice();
  for (const u of acts) {
    if (!state.units.includes(u) || state.result) break;

    /* 指挥部跟随主力，但保持 2 格以上的安全距离。
       以前这里是 `continue`——HQ 永远杵在出生点，而光环只有 2 格，
       主力一过河就永久脱指，看着就像指挥系统失灵。 */
    if (isHQ(u)) {
      const radius = hqRadius(u.type);
      const mates = alive(u.side).filter(m => m !== u && !isHQ(m));
      const foes = alive(other(u.side));
      if (mates.length && !u.moved) {
        const reach = computeReach(u);
        let best = null, bs = -Infinity;
        for (const key in reach.stop) {
          const p = key.split(',').map(Number);
          let cover = 0, mateMin = Infinity;
          for (const m of mates) {
            const d = hexDist(p, m.pos);
            if (d <= radius) cover++;
            if (d < mateMin) mateMin = d;
          }
          let foeMin = Infinity;
          for (const f of foes) foeMin = Math.min(foeMin, hexDist(p, f.pos));
          let s = cover * 10 - mateMin * 1.2;
          if (foeMin <= 1) s -= 60;          // 贴脸：绝不
          else if (foeMin <= 2) s -= 25;     // 敌炮威胁圈：尽量不
          if (s > bs) { bs = s; best = p; }
        }
        if (best && (best[0] !== u.pos[0] || best[1] !== u.pos[1])) {
          doMove(u, best);
          await sleep(150);
        }
      }
      continue;
    }

    /* 崩溃收拢（v4.20）：崩了的部队不能开火也不能占点，留在原地只会被补刀，
       而且贴着敌人永远回不到恢复线。让它自己后撤找掩体——唯一例外是
       它正站在关键要点上、且是那格里最后一支没崩的守军。 */
    if (isBroken(u)) {
      if (aiBrokenAction(u)) await sleep(140);
      continue;
    }

    /* 防空单位守在主力后方，不冲最前 */
    if (u.type === 'aac' || u.type === 'aab') {
      const goal = goalOf(u);
      if (goal && !u.moved) {
        const reach = computeReach(u);
        let best = null, bs = -Infinity;
        for (const key in reach.stop) {
          const p = key.split(',').map(Number);
          let mind = Infinity;
          for (const f of alive('blue')) mind = Math.min(mind, hexDist(p, f.pos));
          const s = -hexDist(p, goal) * 0.4 + Math.min(mind, 5) * 1.4;
          if (s > bs) { bs = s; best = p; }
        }
        if (best) { doMove(u, best); await sleep(140); }
      }
      continue;
    }

    /* 空中单位：在敌人 3 格外游弋，绝不进防空圈。
       判的是领域不是兵种——加第二型飞机时 AI 不用改一行。
       水面单位暂时走下面的通用分支（它们的目标同样是 redGoal，
       只是走不到陆地上，computeReach 自然把它们限制在水里）。 */
    if (isAir(u)) {
      const foes = alive('blue');
      if (foes.length) {
        const reach = computeReach(u);
        const cands = Object.keys(reach.stop).map(k => k.split(',').map(Number));
        cands.push(u.pos);
        const hi = attackRange(u);
        /* 敌方防空圈（半径与强度都在兵种表里，不按代号认）。
           包含两种：带 aa 的兵种，以及防空阵地 F —— 后者在 aaPenalty 里算过，
           但以前这里没算，于是 AI 会挑一个"它以为安全、实际吃 -25%"的位置。 */
        const inAA = p => foes.some(a => {
          const T2 = TYPE[a.type] || {};
          return T2.aa && hexDist(p, a.pos) <= (T2.aaRange || 2);
        }) || (state.forts || []).some(f =>
          f.side !== u.side && f.kind === 'F' && fortWorking(f) &&
          hexDist(p, [f.r, f.c]) <= 2);
        let best = null, bs = -Infinity;
        for (const p of cands) {
          /* 以前这里是 `if (inAA(p)) continue;`——结果是：只要目标被防空伞罩住，
             飞机就一架都不来，宁可飞到天边待着。战报上于是永远不出现
             "驱逐舰被炸沉"，玩家也学不到"防空伞保护舰队"这件事的重要性。
             现在改成扣分：进圈仍可能被选中，只是要拿"能开火"去换这 60 分。 */
          const risky = inAA(p);
          let canFire = 0, mind = Infinity;
          for (const f of foes) {
            const d = hexDist(p, f.pos);
            if (d < mind) mind = d;
            if (d >= minRange(u) && d <= hi && canTarget(u, f)) canFire++;
          }
          /* 能开火的位置压倒一切；同分才比距离。
             运输机（射程 0）反过来——它要的是"离敌人越远越好"。
             以前这里一律退到 3 格外，那是给射程 2 的航空连写的；
             射程 1 的战斗机照那个走就永远够不着，整局白飞。 */
          let s = canFire * 100 + (hi === 0 ? mind : -mind);
          if (risky) s -= 60;
          if (s > bs) { bs = s; best = p; }
        }
        if (best && (best[0] !== u.pos[0] || best[1] !== u.pos[1])) {
          doMove(u, best);
          await sleep(160);
        }
      }
      if (!u.fired && u.rng > 0) {
        const tg = targetsFor(u, state.fields, pushOpts);
        if (tg.length) {
          tg.sort((a, b) => scoreTarget(u, b, state.fields, style, hunt) - scoreTarget(u, a, state.fields, style, hunt));
          doAttack(u, tg[0], pushOpts);
          await sleep(220);
        }
      }
      continue;
    }

    /* 拖曳炮的展收节拍。AI 必须走同一套规则，否则 9 格射程就等于白送。
       行军状态：这一格打得到人就地架设；打不到就继续跟着走。
       已展开：这一格没目标了才收炮换阵地——有目标就继续打，别来回折腾。 */
    if (isTowed(u) && !u.moved) {
      const inR = inRangeTargets(u, state.fields);
      if (u.packed) {
        if (inR.length && u.ammo > 0) { doUnpack(u); await sleep(160); continue; }
      } else if (!inR.length && !u.fired) {
        doPack(u); await sleep(140); continue;
      }
    }

    /* 炮兵 / 直射单位：优先开火 */
    if (u.rng > 0 && !u.fired) {
      const tg = targetsFor(u, state.fields, pushOpts);
      if (tg.length) {
        tg.sort((a, b) => scoreTarget(u, b, state.fields, style, hunt) - scoreTarget(u, a, state.fields, style, hunt));
        let best = tg[0];
        /* 贴身护卫（v4.17 第 2 条）：有人摸到自己炮兵/指挥部一格内，
           这一炮先打他。**只改打谁，不改往哪走**——
           走位一改就把主力从要点上拽回去，C3 试过 50% → 97%。
           进攻型不干这事：它的目标是歼灭，回头救炮会打断冲击（见 AI_STYLES.guard）。 */
        const guard = style.guard ? aiGuardSituation(u) : null;
        if (guard && hexDist(u.pos, guard.mate.pos) <= 1 && tg.indexOf(guard.foe) >= 0) best = guard.foe;
        const pv = previewAttack(u, best, state.fields);
        const massed = aiMassedAttack(u, best);
        /* 开火底线（v4.18 反馈第 7 条）：按这一关红方的脾气取——
           进攻型 0.55 / 防守型 1.05 / 夺取型 0.85，火炮各降一档。
           已经吃过第一轮攻击的格子例外：防御被拉开了 0.30，阈值跟着放松，
           这一炮很可能值回票价（多面进攻的 AI 侧）。
           夺取型另有"不惜代价"：目标站在敌方要点上时门槛归零（见 aiFireGate）。
           进攻型卡住时，挡路的目标按破口价 0.40 打（v4.20 第 2 批）。 */
        const bt = aiBreakthroughTarget(u, style, state.fields);
        if (pv.ratio >= aiFireGate(u, best, pv, style, false, massed, best === bt, hunt)) {
          doAttack(u, best, pushOpts);
          await sleep(240);
          continue;
        }
      }
    }

    /* 注：红方没有工兵，也不挖堑壕——进攻方在本关是"时间换空间"的一方，
       一旦让它们就地加固，攻方反而变成钉子户，整体节奏会塌掉。 */

    /* 辎重：跟上主力，但别叠在一处（v4.17 第 2 条新增）。
       补给场半径 2，两辆辎挤在同一格附近等于白扔一个补给场；
       4 格内已经有 2 支友军，说明这一带有人管了，继续往前挪。 */
    if (u.type === 'sup') {
      const mates = alive(u.side).filter(m => m !== u && hexDist(u.pos, m.pos) <= 4).length;
      if (mates < 2) {
        const goal = goalOf(u);
        if (goal) stepToward(u, goal);
      }
      await sleep(120);
      continue;
    }

    /* 工兵：先判断该不该架桥，再决定是否跟随。
       红方是进攻方，正面就只有两处渡口，不架桥就只能排队送死。
       判定条件三条，缺一不可：
         ① 编制上能架桥（eng 才有舟桥分队，engc 没有）
         ② 相邻有真正的河流格（不是已有渡口）
         ③ 架完这一格，离作战目标确实更近——不为了架桥而架桥 */
    if (u.type === 'eng' || u.type === 'engc') {
      const goal = goalOf(u);
      if (u.type === 'eng' && goal && !u.moved && !u.fired) {
        /* neighbors 的签名是 (r, c)，传数组会静默返回空表——
           这里曾经写成 neighbors(u.pos)，于是红方工兵一辈子没架过桥，
           而 R3E（舟桥连）就是为了架桥才加进编制里的。 */
        const rivers = neighbors(u.pos[0], u.pos[1])
          .filter(n => LEVEL.map[n[0]][n[1]] === '~');
        let pick = null, pd = hexDist(u.pos, goal);
        for (const s of rivers) {
          const d = hexDist(s, goal);
          if (d < pd) { pd = d; pick = s; }
        }
        if (pick) {
          log('  敌工兵在 ' + coordName(pick) + ' 架设舟桥。', 'r');
          FX.banner('敌 军 架 桥 · ' + coordName(pick), 'r', 2000);
          doBridge(u, pick);
          await sleep(220);
          continue;
        }
      }
      if (goal && !u.moved) stepToward(u, goal);
      await sleep(120);
      continue;
    }

    /* 机动 */
    const goal = goalOf(u);
    const stuckTowed = isTowed(u) && !u.packed;    // 没收到炮，挪不动
    if (goal && !u.moved && !stuckTowed) {
      const reach = computeReach(u);
      let best = null, bs = -Infinity;
      for (const key in reach.stop) {
        const p = key.split(',').map(Number);
        /* 落点打分收进 aiMoveScore：三种脾气的系数差异全在 AI_STYLES 里，
           runAI 这边只负责"遍历可达格、取最高分"。 */
        const s = aiMoveScore(u, p, goal, style, hunt);
        if (s > bs) { bs = s; best = p; }
      }
      if (best) {
        /* 破口要在挪窝之前判：走完再算，computeReach 会把刚用掉的机动力
           又算回来，"卡住"就不再是事实了。 */
        const bt = aiBreakthroughTarget(u, style, state.fields);
        doMove(u, best);
        await sleep(200);
        if (u.rng > 0 && !u.fired) {
          const tg = targetsFor(u, state.fields, pushOpts);
          if (tg.length) {
            tg.sort((a, b) => scoreTarget(u, b, state.fields, style, hunt) - scoreTarget(u, a, state.fields, style, hunt));
            let bestT = tg[0];
            const guard2 = style.guard ? aiGuardSituation(u) : null;
            if (guard2 && hexDist(u.pos, guard2.mate.pos) <= 1 && tg.indexOf(guard2.foe) >= 0) bestT = guard2.foe;
            const pv = previewAttack(u, bestT, state.fields);
            const massed = aiMassedAttack(u, bestT);
            /* 走完再打比原地打难一档（+0.05）：阵型没展开。 */
            if (pv.ratio >= aiFireGate(u, bestT, pv, style, true, massed, bestT === bt, hunt)) {
              doAttack(u, bestT, pushOpts);
              await sleep(220);
            }
          }
        }
      }
    }
  }
}
