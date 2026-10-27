/* 把 sfx-demo 引用的音频内嵌成 base64。
 *
 * 为什么要内嵌：试听页可能被放在沙箱预览里打开，那里的相对路径
 * ../assets/sfx/ 解析不到仓库目录，点下去只是静默失败——音频文件本身
 * 完全正常（用 file:// 实测全部 err=0）。内嵌之后页面不依赖
 * 任何外部路径，放哪里都能响。
 *
 * **产物不入库**（v4.12）。`sfx-demo.html` 是骨架（13 KB，含相对路径兜底，
 * 双击就能听，Pages 上也能用）；内嵌版写成 `sfx-demo.embed.html`，1 MB 的
 * base64。把它放进版本库的代价不是占位，是**每改一次音效就整体重写一遍**，
 * diff 里什么都看不出来。所以：骨架入库，产物进 .gitignore。
 *
 * 为什么要两个文件、而不是让骨架原地内嵌：那样每生成一次就改一次入库文件，
 * 等于把"产物"和"源码"混在一个路径上，git 里永远显示它被整体重写。
 *
 *   npm run sfx:embed             生成内嵌版（给沙箱预览用）
 *   npm run sfx:embed -- --check  校验内嵌版是否与骨架 + 音频一致
 *                                 （没生成过就跳过，CI 上不该因此变红）
 *
 * 只内嵌页面真正引用的文件名，不是整个目录 —— assets/sfx 里还有
 * win/lose/ui-click 等本页用不到的槽位。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'game/audio-lab/sfx-demo.html');
const OUT = path.join(ROOT, 'game/audio-lab/sfx-demo.embed.html');
const SFX = path.join(ROOT, 'game/assets/sfx');
const START = '/*@SFX-EMBED@*/';
const END = '/*@/SFX-EMBED@*/';

const MIME = { '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

const checkOnly = process.argv.includes('--check');

/* 没生成过就跳过。CI 不该因为"没跑生成脚本"变红——它检查的是
   "已有的产物有没有过期"，不是"产物必须存在"。 */
if (checkOnly && !fs.existsSync(OUT)) {
  console.log('· 内嵌版试听页未生成（需要时跑 npm run sfx:embed；骨架 sfx-demo.html 直接双击也能听）');
  process.exit(0);
}

const html = fs.readFileSync(SRC, 'utf8');

/* 找出页面引用的音频文件名：ROWS 里的 old/syn 与底噪 */
const names = [...new Set(
  [...html.matchAll(/'([A-Za-z0-9_-]+\.(?:ogg|mp3))'/g)].map(m => m[1])
)].sort();

const missing = names.filter(n => !fs.existsSync(path.join(SFX, n)));
if (missing.length) {
  console.error('引用了不存在的文件：' + missing.join(', '));
  process.exit(1);
}

const entries = names.map(n => {
  const buf = fs.readFileSync(path.join(SFX, n));
  const mime = MIME[path.extname(n).toLowerCase()];
  return [n, 'data:' + mime + ';base64,' + buf.toString('base64')];
});

const block = START + '{\n'
  + entries.map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n')
  + '\n}' + END;

const a = html.indexOf(START);
const b = html.indexOf(END);
if (a < 0 || b < 0) {
  console.error('找不到内嵌标记 ' + START + ' / ' + END);
  process.exit(1);
}

const next = html.slice(0, a) + block + html.slice(b + END.length);
const skeletonLen = html.length;
const newLen = next.length;

if (checkOnly) {
  /* 比的是**生成物**里的那一块，不是骨架里那个空 {}：
     过期 == 音频重新合成过、或骨架里的行变了，而产物没跟上。 */
  const made = fs.readFileSync(OUT, 'utf8');
  const ma = made.indexOf(START);
  const mb = made.indexOf(END);
  if (ma < 0 || mb < 0) {
    console.error('✗ 生成物里的内嵌标记丢了。跑 npm run sfx:embed 重生成。');
    process.exit(1);
  }
  if (made.slice(ma, mb + END.length) !== block) {
    console.error('✗ 试听页内嵌音频已过期（音频重新合成过？）。跑 npm run sfx:embed 重生成。');
    process.exit(1);
  }
  console.log('✓ 试听页内嵌块是最新的：' + entries.length + ' 个文件，'
    + (made.length / 1024).toFixed(0) + ' KB（产物不入库）');
  process.exit(0);
}

fs.writeFileSync(OUT, next);
const raw = entries.reduce((s, [k]) => s + fs.statSync(path.join(SFX, k)).size, 0);
console.log('内嵌 ' + entries.length + ' 个文件');
console.log('  骨架 ' + (skeletonLen / 1024).toFixed(0) + ' KB → 页面 ' + (newLen / 1024).toFixed(0) + ' KB'
  + '（原始音频 ' + (raw / 1024).toFixed(0) + ' KB）');
for (const [k, v] of entries) {
  console.log('  ' + k.padEnd(18) + (v.length / 1024).toFixed(0).padStart(5) + ' KB');
}
