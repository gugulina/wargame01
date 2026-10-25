/* 把 tools/hooks/ 下的钩子装进 .git/hooks/。

   为什么要有这个脚本：.git/hooks 不进版本库。钩子内容只留在某台机器的
   .git 目录里，换台电脑 clone 下来就是空的——所有校验全部失效，
   而且没有任何提示。tools/ 里那份是唯一的真源，这里是安装器。

   用法：node tools/install-hooks.js
   （package.json 里是 npm run hooks） */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'hooks');
const DST = path.join(ROOT, '.git', 'hooks');

if (!fs.existsSync(DST)) {
  console.error('没找到 .git/hooks —— 这不是一个 git 仓库？');
  process.exit(1);
}

/* 统一写 LF。Windows 上如果钩子带 CRLF，sh 会报
   "/bin/sh: bad interpreter: No such file or directory"，
   报错完全指不到真正原因（行尾符），查起来很费劲。 */
let n = 0;
for (const f of fs.readdirSync(SRC)) {
  const src = path.join(SRC, f);
  if (!fs.statSync(src).isFile()) continue;
  const body = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
  const dst = path.join(DST, f);
  fs.writeFileSync(dst, body, 'utf8');
  try { fs.chmodSync(dst, 0o755); } catch (e) { /* Windows 上 chmod 是空操作 */ }
  console.log('已安装 ' + f + ' → .git/hooks/' + f);
  n++;
}
console.log(n ? '共 ' + n + ' 个钩子。' : '没有可安装的钩子。');
