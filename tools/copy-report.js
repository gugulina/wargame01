/* 玩家可见文案的抽取与体检表生成。
   用法：
     node tools/copy-report.js           # 生成 docs/24-游戏文案总表.md
     node tools/copy-report.js --stat    # 只在终端打统计，不写文件
     node tools/copy-report.js --json <路径>   # 额外导出结构化 JSON（给别的一次性脚本用）

   为什么要有这个脚本：
   1. 文案散在 LEVELS[] 的四个字段（teaser / intro / story.briefing / events[].effects[]）
      加 TYPE[].abil、CARDS、各渲染函数里的短句，一共一万三千多字。
      靠 grep 抽不全（拼接字符串会截半句、beats 数组会漏掉第二句），
      靠手抄会跟游戏里说的不一样——所以走"解析源码、原样输出"。
   2. 改稿要看全局：同一句"不是 A，是 B"出现三十次才显得油，
      单看一段看不出来。这份表按模块排开，毛病一眼能看见。
   3. 文案有断言（selftest [34] / briefcheck [16]），但断言只管"别露代码、别超二战"，
      管不了风格。风格问题只能人看，表是给人看的。

   注意：行号是抽取时的位置，改稿之后会漂。认 id，不认行号。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/* --src= 用来对比历史版本（git show HEAD:game/campaign.html > 临时文件），
   体检前后各跑一次就能拿出"破折号密度从 7.8 降到几"这种数字 */
const SRC_ARG = process.argv.find(a => a.startsWith('--src='));
const SRC = fs.readFileSync(path.resolve(ROOT, SRC_ARG ? SRC_ARG.slice(6) : 'game/campaign.html'), 'utf8');
const CN = /[\u4e00-\u9fa5]/;

/* ── 定位工具 ── */
function lineOf(idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (SRC.charCodeAt(i) === 10) n++;
  return n;
}

/* 从 start 的 { 或 [ 配平到闭合，跳过字符串与注释 */
function matchBlock(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, i = start, q = null;
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === q) q = null;
      i++; continue;
    }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (ch === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e + 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; i++; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (!depth) return i; }
    i++;
  }
  return -1;
}

/* 读一个（可能是 'a' + 'b' 拼接的）字符串字面量，SRC[start] 必须是开引号 */
function readStr(start) {
  let i = start, out = '';
  while (i < SRC.length) {
    if (SRC[i] !== "'") break;
    i++;
    while (i < SRC.length) {
      if (SRC[i] === '\\') { out += SRC[i] + SRC[i + 1]; i += 2; continue; }
      if (SRC[i] === "'") break;
      out += SRC[i++];
    }
    i++;
    let j = i;
    while (j < SRC.length && /\s/.test(SRC[j])) j++;
    if (SRC[j] === '+') {
      j++;
      while (j < SRC.length && /\s/.test(SRC[j])) j++;
      if (SRC[j] === "'") { i = j; continue; }
    }
    break;
  }
  return out.replace(/\\n/g, '\n');
}

const out = { levels: [], types: [], intros: [], cards: [], events: [], ui: [] };

/* ── 关卡边界 ── */
const levelStarts = [];
{
  const re = /\n {2}id: '([A-Z0-9]+)', ch: (\d+), no: (\d+)/g;
  let m;
  while ((m = re.exec(SRC))) levelStarts.push({ id: m[1], ch: +m[2], no: +m[3], at: m.index });
}
const LEVELS_END = matchBlock(SRC, SRC.indexOf('[', SRC.indexOf('const LEVELS = [')));
const levelAt = idx => {
  let cur = null;
  for (const L of levelStarts) if (L.at <= idx) cur = L; else break;
  return cur;
};

/* ── 1. 关卡文案 ── */
const CH_NAME = { 0: '序章', 1: '第一章 艰难时刻', 2: '第二章 兵临城下', 3: '第三章 一步不退',
  4: '第四章 破灭神话', 5: '第五章 战略决战', 6: '第六章 反攻号角', 7: '第七章 决胜一击', 8: '第八章 伟大胜利' };

levelStarts.forEach((L, k) => {
  const end = k + 1 < levelStarts.length ? levelStarts[k + 1].at : LEVELS_END;
  const seg = SRC.slice(L.at, end);
  const rec = { id: L.id, ch: L.ch, no: L.no, line: lineOf(L.at) };

  /* name / type / when / where 有的关跟 id 挤在同一行（`id: 'C1', ch: 1, no: 1, name: '北岭要塞'`），
     有的另起一行，所以按"字段名第一次出现"取，不假设缩进 */
  for (const key of ['name', 'type', 'when', 'where', 'teaser']) {
    const i = seg.indexOf(key + ': ');
    if (i < 0) continue;
    const q = L.at + i + seg.slice(i).indexOf("'");
    rec[key] = readStr(q);
  }

  for (const [key, br] of [['intro', '['], ['prev', '{']]) {
    const i = seg.indexOf('\n  ' + key + ': ' + br);
    if (i < 0) continue;
    const s = L.at + i + seg.slice(i).indexOf(br);
    const e = matchBlock(SRC, s);
    try { rec[key] = new Function('return ' + SRC.slice(s, e + 1))(); rec[key + 'Line'] = lineOf(s); }
    catch (err) { rec[key + 'Err'] = err.message; }
  }

  const gs = seg.indexOf('\n  story: {');
  if (gs >= 0) {
    const s = L.at + gs + seg.slice(gs).indexOf('{');
    const e = matchBlock(SRC, s);
    try { rec.story = new Function('return ' + SRC.slice(s, e + 1))(); rec.storyLine = lineOf(s); }
    catch (err) { rec.storyErr = err.message; }
  }
  out.levels.push(rec);
});

/* ── 2. 图鉴 ── */
{
  const s = SRC.indexOf('const TYPE = {');
  const e = matchBlock(SRC, SRC.indexOf('{', s));
  const body = SRC.slice(s, e + 1);
  const re = /\n {2}(\w+):\s*\{ name: '([^']*)', role: '([^']*)'/g;
  const ents = [];
  let m;
  while ((m = re.exec(body))) ents.push({ key: m[1], name: m[2], role: m[3], at: m.index });
  ents.forEach((E, k) => {
    const seg = body.slice(E.at, k + 1 < ents.length ? ents[k + 1].at : body.length);
    let abil = null, line = null;
    const ai = seg.indexOf('abil: [');
    if (ai >= 0) {
      const abs = E.at + ai + seg.slice(ai).indexOf('[');
      const abe = matchBlock(body, abs);
      try { abil = new Function('return ' + body.slice(abs, abe + 1))(); } catch (x) { abil = null; }
      line = lineOf(s + abs);
    }
    out.types.push({ key: E.key, name: E.name, role: E.role, abil, line });
  });
}

/* ── 2b. 兵种介绍（图鉴卡片顶上那段话） ──
   和 abil 分开写是作者的分工：abil 讲规则，intro 讲"该不该派它上"。
   两处都要收，只收 abil 会漏掉图鉴里最长的那段正文。 */
{
  const s = SRC.indexOf('const UNIT_INFO = {');
  const e = matchBlock(SRC, SRC.indexOf('{', s));
  const re = /\n {2}(\w+): \{ cat: '([^']*)',\n {4}intro: '/g;
  let m;
  while ((m = re.exec(SRC))) {
    if (m.index < s || m.index > e) continue;
    const q = m.index + m[0].length - 1;
    out.intros.push({ key: m[1], cat: m[2], intro: readStr(q), line: lineOf(m.index) });
  }
}

/* ── 3. 战术卡 ── */
{
  const s = SRC.indexOf('const CARDS = {');
  const e = matchBlock(SRC, SRC.indexOf('{', s));
  try {
    const obj = new Function('return ' + SRC.slice(SRC.indexOf('{', s), e + 1))();
    for (const [k, v] of Object.entries(obj))
      out.cards.push({ id: k, name: v.name, tag: v.tag, short: v.short, desc: v.desc, note: v.note });
  } catch (err) { out.cardErr = err.message; }
}

/* ── 4. 关卡事件：战报 / 无线电 / 横幅 ──
   战斗过程中玩家读到的字，59 条 log + 17 条 say + 若干 banner。
   beats 数组要单独收：一个 say 事件里可以说两句，只抓 text 会漏掉后一句。 */
{
  const re = /\{ kind: '(log|say|banner)'/g;
  let m;
  while ((m = re.exec(SRC))) {
    const win = SRC.slice(m.index, m.index + 700);
    /* who 只在当前这个 effect 对象里找：往后 700 字会吃进下一条事件的 who，
       表现是 log 事件平白多出一个说话人（踩过一次） */
    const objEnd = win.indexOf('}');
    const objWin = objEnd > 0 ? win.slice(0, objEnd) : win;
    const who = objWin.match(/who: '((?:[^'\\]|\\.)*)'/);
    const L = levelAt(m.index);
    const push = (text, kind, line, sayer) => {
      if (!text || !CN.test(text)) return;
      out.events.push({ level: L ? L.id : '?', ch: L ? L.ch : 0, no: L ? L.no : 0,
        kind, who: sayer || (who ? who[1] : ''), text, line });
    };
    /* say 里带 beats 数组：整段解析，逐句收 */
    const bi = win.indexOf('beats: [');
    if (m[1] === 'say' && bi >= 0) {
      const s = m.index + bi + 'beats: '.length;
      const e = matchBlock(SRC, s);
      try {
        const arr = new Function('return ' + SRC.slice(s, e + 1))();
        /* beats 里每句有自己的 who：一个 say 事件可以让师长开一句、副官接一句 */
        arr.forEach(b => push(b.text, 'say', lineOf(s), b.who));
      } catch (x) { /* 解析失败就退回单句 */ }
      continue;
    }
    const ti = win.indexOf("text: '");
    if (ti < 0) continue;
    push(readStr(m.index + ti + 'text: '.length), m[1] === 'say' ? 'say' : m[1] === 'banner' ? 'banner' : 'log',
      lineOf(m.index));
  }
}

/* ── 5. 引擎里的界面短句 ── */
{
  const re = /\blog\(\s*'/g;
  let m;
  while ((m = re.exec(SRC))) {
    const t = readStr(m.index + m[0].indexOf("'"));
    if (CN.test(t)) out.ui.push({ text: t, line: lineOf(m.index) });
  }
}

/* ── 统计 ── */
const cn = s => (String(s || '').match(/[\u4e00-\u9fa5]/g) || []).length;
const ready = out.levels.filter(l => l.story);
const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);

const stat = {
  levels: out.levels.length,
  ready: ready.length,
  pages: sum(ready, l => (l.story.briefing?.pages || []).length),
  paras: sum(ready, l => sum(l.story.briefing?.pages || [], p => (p.paras || []).length)),
  beats: sum(ready, l => (l.story.briefing?.beats || []).length),
  intro: sum(out.levels, l => (l.intro || []).length),
  teaser: out.levels.length,
  types: out.types.length,
  abil: sum(out.types, t => (t.abil || []).length),
  intros: out.intros.length,
  cards: out.cards.length,
  events: out.events.length,
  ui: out.ui.length
};

const chars = {
  brief: sum(ready, l => sum(l.story.briefing?.pages || [], p =>
    cn(p.title) + cn(p.kicker) + cn(p.order) + sum(p.paras || [], q => cn(q.t))) +
    sum(l.story.briefing?.beats || [], b => cn(b.text))),
  intro: sum(out.levels, l => sum(l.intro || [], cn)),
  teaser: sum(out.levels, l => cn(l.teaser)),
  abil: sum(out.types, t => sum(t.abil || [], cn)),
  dexIntro: sum(out.intros, x => cn(x.intro)),
  events: sum(out.events, e => cn(e.text)),
  cards: sum(out.cards, c => cn(c.short) + cn(c.desc) + cn(c.note))
};
const total = Object.values(chars).reduce((a, b) => a + b, 0);

console.log('=== 结构 ===');
console.log(stat);
console.log('=== 汉字 ===');
console.log(chars, '合计', total);

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) {
  fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(out, null, 1));
  console.log('已写', process.argv[jsonAt + 1]);
}
if (process.argv.includes('--stat')) process.exit(0);

/* ── 生成文档 ── */
const notes = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'data/notes.js'), 'utf8');
  const i = src.indexOf('window.CANGYU_NOTES');
  return new Function('return ' + src.slice(i + 'window.CANGYU_NOTES ='.length).replace(/;\s*$/, ''))();
})();

const L = [];
const p = s => L.push(s);
const tag = l => l.ch === 0 ? '序章 · 教学关' : CH_NAME[l.ch] + ' · 第 ' + l.no + ' 关';

p('# 游戏文案总表（玩家可见）');
p('');
p('> 由 `node tools/copy-report.js` 从 `game/campaign.html` 与 `data/*.js` 直接抽取，**不是手抄**。');
p('> 改了引擎里的文案之后重跑一次，否则这份表和游戏里说的不一样。');
p('> 行号是抽取时的位置，改稿后会漂——认 `id`，不认行号。');
p('');
p('## 0. 清单');
p('');
p('| 模块 | 条数 | 汉字 | 源 | 渲染口 |');
p('|---|---|---|---|---|');
p('| 关卡简报 `story.briefing` | ' + stat.pages + ' 页 / ' + stat.beats + ' 段对白 | ' + chars.brief + ' | `LEVELS[]` | `#briefScreen` |');
p('| 战前态势 `intro` | ' + stat.intro + ' 条 | ' + chars.intro + ' | `LEVELS[]` | 出击前弹层 |');
p('| 关卡简述 `teaser` | ' + stat.teaser + ' 条 | ' + chars.teaser + ' | `LEVELS[]` → `data/levels.js` | 菜单页关卡卡 |');
p('| 战斗战报 / 无线电 `events` | ' + stat.events + ' 条 | ' + chars.events + ' | `LEVELS[].events[].effects[]` | 战报栏 / 对白条 |');
p('| 兵种图鉴 `TYPE[].abil` | ' + stat.abil + ' 条 / ' + stat.types + ' 兵种 | ' + chars.abil + ' | `TYPE` | HQ 图鉴页 |');
p('| 兵种介绍 `UNIT_INFO[].intro` | ' + stat.intros + ' 条 | ' + chars.dexIntro + ' | `UNIT_INFO` | 图鉴卡片顶部 |');
p('| 战术卡 `CARDS` | ' + stat.cards + ' 张 | ' + chars.cards + ' | `CARDS` → `data/cards.js` | 配牌页 / 卡面 |');
p('| 界面短句 | ' + stat.ui + ' 处 | — | 各渲染函数 | 棋盘内 |');
p('');
p('合计约 **' + total.toLocaleString('en-US') + '** 汉字。已实装完整剧本的关卡：' +
  ready.map(l => l.id).join(' · ') + '；其余 ' + (out.levels.length - ready.length) + ' 关只有名称与 `teaser`。');
p('');

p('---');
p('');
p('## 1. 关卡简报（`story.briefing`）');
p('');
p('每关开头必读的三页纸：`pages[]` 是纸面，`beats[]` 是纸上抬起头的口述。');
p('`order` 是纸头左上角的公文抬头，`kicker` 是标题上方的小字，`paras[].hl` 是高亮段。');
p('');
for (const l of ready) {
  const b = l.story.briefing || {};
  p('### ' + l.id + ' ' + l.name + '（' + tag(l) + ' · `campaign.html:' + l.storyLine + '`）');
  p('');
  (b.pages || []).forEach((pg, i) => {
    p('**第 ' + (i + 1) + ' 页** — 抬头「' + (pg.order || '') + '」· 眉题「' + (pg.kicker || '') + '」');
    p('');
    p('> **' + (pg.title || '') + '**');
    p('>');
    (pg.paras || []).forEach(q => p('> ' + q.t + (q.hl ? '　〔高亮〕' : '')));
    if (pg.nums) { p('>'); p('> 数字条：' + pg.nums.map(n => n.k + ' = ' + n.v).join(' · ')); }
    p('');
  });
  if ((b.beats || []).length) {
    p('**过场对白**');
    p('');
    for (const bt of b.beats)
      p('- `' + bt.who + '`' + (bt.side ? '（' + (bt.side === 'red' ? '敌' : '我') + '）' : '') + '：' + bt.text.replace(/\n/g, ' ⏎ '));
    p('');
  }
}

p('---');
p('');
p('## 2. 战前态势（`intro`）');
p('');
p('出击前那一段条目式说明。走 `log(..., "sys")`，也就是 `bold()` 通道，所以**可以**写 `**重点**`，但不能写 HTML。');
p('');
for (const l of out.levels.filter(x => x.intro)) {
  p('### ' + l.id + ' ' + l.name + '（`campaign.html:' + l.introLine + '`）');
  p('');
  l.intro.forEach((t, i) => p((i + 1) + '. ' + t));
  p('');
}
for (const l of out.levels.filter(x => x.prev)) {
  p('### ' + l.id + ' 上一关结算语（`prev`）');
  p('');
  p('- 胜：' + l.prev.win);
  p('- 负：' + l.prev.fail);
  p('');
}

p('---');
p('');
p('## 3. 关卡简述（`teaser`）');
p('');
p('菜单页关卡卡上的一句话。**纯文本拼进 DOM**（`index.html` 直接字符串连接），不能写 `**加粗**`。');
p('');
p('| id | 章 | 关名 | 简述 |');
p('|---|---|---|---|');
for (const l of out.levels) p('| ' + l.id + ' | ' + l.ch + ' | ' + l.name + ' | ' + String(l.teaser || '').replace(/\|/g, '\\|') + ' |');
p('');

p('---');
p('');
p('## 4. 战斗中的战报与无线电（`events`）');
p('');
p('玩家在打的过程中读到的字。`log` 进战报栏，`say` 进对白条（带人像），`banner` 是屏幕中央的横幅。');
p('');
for (const l of out.levels.filter(x => out.events.some(e => e.level === x.id))) {
  const ev = out.events.filter(e => e.level === l.id);
  p('### ' + l.id + ' ' + l.name + '（' + ev.length + ' 条）');
  p('');
  for (const e of ev) p('- `' + e.kind + '`' + (e.who ? ' `' + e.who + '`' : '') + '：' + e.text.replace(/\n/g, ' ⏎ ') + '　`:' + e.line + '`');
  p('');
}

p('---');
p('');
p('## 5. 兵种图鉴（`TYPE[].abil`）');
p('');
p('图鉴每条 `<li>` 都过 `bold()`，所以这里可以写 `**重点**`。');
p('**改机动 / 弹药 / 修正值时，这里的格数会过期**——规则改了必须回头改文案（docs/08 §8.7）。');
p('');
for (const t of out.types) {
  p('### ' + t.key + ' ' + t.name + ' · ' + t.role + '（`campaign.html:' + t.line + '`）');
  p('');
  const info = out.intros.find(x => x.key === t.key);
  if (info) { p('**介绍**（' + info.cat + '）：' + info.intro); p(''); }
  (t.abil || []).forEach(a => p('- ' + a));
  p('');
}

p('---');
p('');
p('## 6. 战术卡（`CARDS`）');
p('');
p('`short` 是卡面一行，`desc` 是配牌页说明，`note` 是展开后的用法提示。');
p('');
for (const c of out.cards) {
  p('### ' + c.name + '（`' + c.id + '` · ' + c.tag + '）');
  p('');
  p('- 卡面：' + c.short);
  p('- 说明：' + c.desc);
  p('- 用法：' + (c.note || ''));
  p('');
}

p('---');
p('');
p('## 7. 界面短句');
p('');
p('| 位置 | 文案 |');
p('|---|---|');
[
  ['`UOPS_HINT.move`', '点蓝格移动；再点「移动」或按 Esc 退出'],
  ['`UOPS_HINT.fort`', '选一种工事，然后点本格或相邻格施工'],
  ['`UOPS_HINT.mine` / `clear` / `bridge`', '点相邻空格布雷 / 点相邻雷区排雷 / 点相邻河流格架桥'],
  ['结算 · 达成', '达成任务 · 核心要点守住，战役目标完成。'],
  ['结算 · 坚守', '坚守成功 · 撑到了预定时间，援军会记住这一天。'],
  ['结算 · 坚守（满）', '完整坚守 · 一个没损失，防线原封不动撑到了最后。'],
  ['结算 · 突围', '突围成功 · 足够多的部队穿过了封锁线。'],
  ['结算 · 突围（满）', '超额突围 · 冲出去的比要求还多，这条封锁线没拦住你们。'],
  ['结算 · 失败', '任务失败 · 要点失守或守备力量耗尽。'],
  ['阶段条', '我方阶段 / 敌方行动 / 已结束'],
  ['要点控制', '我方 / 敌方 / 争夺中 / 未占领']
].forEach(r => p('| ' + r.join(' | ') + ' |'));
p('');

p('---');
p('');
p('## 8. 版本公告（`data/notes.js`）');
p('');
p('最新 ' + notes.notes.length + ' 条，只列标题。公告也是玩家能看到的字，同样在文案体检范围内。');
p('');
p('| 版本 | 日期 | 标签 | 标题 |');
p('|---|---|---|---|');
notes.notes.forEach(n => p('| ' + (n.ver || '—') + ' | ' + (n.date || '') + ' | ' + (n.tag || '') + ' | ' + String(n.title || '').replace(/\|/g, '\\|') + ' |'));
p('');

fs.writeFileSync(path.join(ROOT, 'docs/24-游戏文案总表.md'), L.join('\n') + '\n');
console.log('已写 docs/24-游戏文案总表.md，' + L.length + ' 行');
