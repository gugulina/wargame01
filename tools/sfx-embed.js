/* 把 sfx-demo.html 引用的音频内嵌成 base64。
 *
 * 为什么需要这一步：试听页可能被放在沙箱预览里打开，那里的相对路径
 * ../assets/sfx/ 解析不到仓库目录，点下去只是静默失败——音频文件本身
 * 完全正常（用 file:// 实测 13 个全部 err=0）。内嵌之后页面不依赖
 * 任何外部路径，放哪里都能响。
 *
 * 只内嵌页面真正引用的文件名，不是整个目录 —— assets/sfx 里还有
 * win/lose/ui-click 等本页用不到的槽位。
 *
 *   npm run sfx:embed          写入
 *   npm run sfx:embed -- --check  只校验内嵌块是否过期
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'game/audio-lab/sfx-demo.html');
const SFX = path.join(ROOT, 'game/assets/sfx');
const START = '/*@SFX-EMBED@*/';
const END = '/*@/SFX-EMBED@*/';

const MIME = { '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

const html = fs.readFileSync(HTML, 'utf8');

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
const oldLen = html.length;
const newLen = next.length;

if (process.argv.includes('--check')) {
  if (html.slice(a, b + END.length) !== block) {
    console.error('✗ 内嵌音频块已过期（音频重新合成过？）。跑 npm run sfx:embed 重生成。');
    process.exit(1);
  }
  console.log('✓ 内嵌块是最新的：' + entries.length + ' 个文件，' + (newLen / 1024).toFixed(0) + ' KB');
  process.exit(0);
}

fs.writeFileSync(HTML, next);
const raw = entries.reduce((s, [k]) => s + fs.statSync(path.join(SFX, k)).size, 0);
console.log('内嵌 ' + entries.length + ' 个文件');
console.log('  原始 ' + (raw / 1024).toFixed(0) + ' KB → 页面 '
  + (oldLen / 1024).toFixed(0) + ' KB → ' + (newLen / 1024).toFixed(0) + ' KB');
for (const [k, v] of entries) {
  console.log('  ' + k.padEnd(18) + (v.length / 1024).toFixed(0).padStart(5) + ' KB');
}
