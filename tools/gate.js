#!/usr/bin/env node
/* 校验闸门的**唯一入口**（v5.4）。
 *
 * 为什么要有这个文件：12 步校验原来有三份拷贝——package.json 的 test、
 * .git/hooks/pre-commit、.github/workflows/test.yml。三份里任何一份漏一步，
 * 就会出现"本地全绿、CI 红"或者"钩子放行、发布物过期"。
 * 现在步骤表只在这里写一次，三处都调它：
 *
 *   node tools/gate.js            # 全套（含两支自战冒烟，约 30–40 秒）
 *   node tools/gate.js --fast     # 跳过自战冒烟（约 20 秒，钩子里用）
 *   node tools/gate.js --list     # 只打印步骤表
 *   node tools/gate.js --only=selftest,copy-report
 *
 * 用法约定：每个步骤是 { name, args, slow? }，args[0] 是相对仓库根的文件。
 * 失败就停在第一步，退出码 1——和 npm test 的 && 链语义一致。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const STEPS = [
  { name: 'selftest',      args: ['tools/selftest.js'], slow: true },
  { name: 'check',         args: ['tools/check.js', 'game/campaign.html'] },
  { name: 'levelcheck',    args: ['tools/levelcheck.js'] },
  { name: 'briefcheck',    args: ['tools/briefcheck.js'], slow: true },
  { name: '快照一致性',    args: ['tools/export-levels.js', '--check'], id: 'export-levels' },
  { name: '文案表一致性',  args: ['tools/copy-report.js', '--check'], id: 'copy-report' },
  { name: 'orgcheck',      args: ['tools/orgcheck.js'] },
  { name: '变异锚点',      args: ['tools/mutcheck.js', '--check-anchors'], id: 'mutcheck' },
  { name: '音效内嵌',      args: ['tools/sfx-embed.js', '--check'], id: 'sfx-embed' },
  { name: '打包物一致性',  args: ['tools/build-www.js', '--check'], id: 'build-www' },
  /* 自战冒烟：不追求统计意义，只让 AI 的护送/抢修/多回合主循环在闸门里跑一次。
     --no-gate：3 局样本太小，"某条事件没触发"在这里只会误报。 */
  { name: '自战·护送',     args: ['tools/autoplay-campaign.js', 'game/campaign.html', '3', '--level=C11B', '--seed=1', '--no-gate'], slow: true, smoke: true },
  { name: '自战·破袭',     args: ['tools/autoplay-campaign.js', 'game/campaign.html', '3', '--level=C7B', '--seed=1', '--no-gate'], slow: true, smoke: true }
];

const argv = process.argv.slice(2);
const FAST = argv.includes('--fast');
const LIST = argv.includes('--list');
const ONLY = (argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

if (LIST) {
  STEPS.forEach((s, i) => console.log(String(i + 1).padStart(2) + '. ' + s.name + (s.smoke ? '（冒烟）' : '')));
  process.exit(0);
}

const steps = STEPS.filter(s => {
  if (FAST && s.smoke) return false;
  if (!ONLY.length) return true;
  return ONLY.includes(s.id || s.name);
});
if (!steps.length) { console.log('没有匹配的步骤'); process.exit(1); }

console.log('校验闸门：' + steps.length + ' 步' + (FAST ? '（--fast：跳过自战冒烟）' : ''));
const t0 = Date.now();
let failed = 0;
for (const s of steps) {
  const t = Date.now();
  const r = spawnSync(process.execPath, s.args, { cwd: ROOT, encoding: 'utf8' });
  const dt = ((Date.now() - t) / 1000).toFixed(1);
  if (r.status === 0) {
    const tail = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
    console.log('  ✓ ' + s.name.padEnd(14) + ' ' + dt + 's' + (tail ? '  ' + tail.slice(0, 70) : ''));
  } else {
    failed++;
    console.log('  ✗ ' + s.name.padEnd(14) + ' ' + dt + 's');
    const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n');
    out.slice(-24).forEach(l => console.log('      ' + l));
    console.log('\n  修法：单独跑一次 `node ' + s.args.join(' ') + '` 看全貌。');
    break;
  }
}
const total = ((Date.now() - t0) / 1000).toFixed(1);
if (failed) { console.log('\n闸门失败（' + total + 's）'); process.exit(1); }
console.log('\n闸门通过：' + steps.length + ' 步 / ' + total + 's');
