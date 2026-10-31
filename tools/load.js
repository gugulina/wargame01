const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* 取引擎脚本块（只取内联的，不含外链）。
   不能再用 html.match(/<script>(...)/) 抓"第一个"——v4.6.1 起 <head> 里多了一段
   先行兜底脚本（window.onerror + 看门狗），它就排在第一个。抓第一个的后果是
   加载到那段 30 行的兜底代码，然后报"未导出 window.__WAR__"，看着像引擎坏了。
   改成取最长的那块：引擎有七千多行，兜底只有几十行，这个判据比"第几个"稳。

   用途：check.js 要统计"引擎本体"的行数与语法。**它不看外链**——
   外链是别的文件，混进来会让行号与规模统计失真。 */
function extractScript(html) {
  const all = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!all.length) return null;
  return all.reduce((a, b) => (b.length > a.length ? b : a));
}

/* 按 HTML 里的**出现顺序**收集所有要执行的脚本，外链读同目录文件。
   这是 loadGame 用的，模拟浏览器逐个 <script> 执行。

   为什么必须按顺序：v4.21 把红方 AI 抽到 game/ai.js 之后，引擎顶层那句
   `window.__WAR__ = { …, runAI, huntContact, … }` 直接引用 AI 的函数声明。
   AI 若排在后面，导出那一刻就 ReferenceError；排在前面就没事（AI 引用引擎的
   state / LEVEL / TYPE 全在函数体内，调用时才解析）。

   跳过两类：
   - 第一个内联块（<head> 兜底脚本）：它是浏览器端的报错兜底，混进被测代码没意义；
   - http(s) 外链：测试环境没有网络，也不该有。
   判据仍是"最长的那块是引擎本体"，与 extractScript 同一个口径。 */
function extractAllScripts(html, baseDir) {
  const re = /<script(\s+src="([^"]+)")?\s*>([\s\S]*?)<\/script>/g;
  const items = [];
  let m;
  while ((m = re.exec(html))) {
    items.push({ src: m[2] || null, body: m[3] || '', len: (m[3] || '').length });
  }
  if (!items.length) return null;
  const maxInline = items.filter(x => !x.src).reduce((a, b) => (b.len > a.len ? b : a), { len: -1 }).len;

  const parts = [];
  for (const it of items) {
    if (it.src) {
      if (/^https?:/i.test(it.src)) continue;
      const rel = it.src.split('?')[0];
      const abs = path.resolve(baseDir, rel);
      if (!fs.existsSync(abs)) {
        /* 外链缺文件必须炸，不能静默跳过：跳过之后表现为"某个函数未定义"，
           报错点会落在调用它的那一行，看着像引擎坏了而不是文件没搬。 */
        throw new Error('外链脚本不存在：' + it.src + '（' + abs + '）');
      }
      parts.push({ name: rel, text: fs.readFileSync(abs, 'utf8') });
    } else if (it.len === maxInline && maxInline > 0) {
      parts.push({ name: '(内联引擎)', text: it.body });
    }
  }
  if (!parts.length) return null;
  /* 拼成一段再跑：两个 <script> 在浏览器里是两次独立执行，顶层 const 都落在
     同一个全局词法环境里。拼起来等价，而且**重名会直接报重复声明**——
     比跑起来之后某个函数被后者覆盖要早暴露得多。 */
  return {
    code: parts.map(p => p.text).join('\n;\n'),
    parts: parts.map(p => p.name)
  };
}

/* jsdom 只解析 DOM、不替你去取外部脚本，所以 <script src> 不内联的话，
   那些文件里的顶层声明全是 undefined——而**它不报错**：每个渲染口都有自己的
   兜底分支（"读不到数据"），断言只会静默地变空。
   v4.21 把红方 AI 抽到 game/ai.js 之后，这一条从"公告页签"扩大到"整个 AI"。

   按 HTML 里的 src 值就地解析（相对 HTML 所在目录），不写死文件名：
   变异版会生成 _mut_ai.js 并把标签改成它，写死就内联不到变异后的那份，
   表现为"变异改了但断言不红"——那是假绿。

   briefcheck 与 levelcheck 都走这一条；selftest 不用它（走上面的纯文本拼接）。 */
function inlineLocalScripts(html, baseDir) {
  return html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    if (/^https?:/i.test(src)) return m;                 // 外站，测试环境不取
    const abs = path.resolve(baseDir, src.split('?')[0]);
    /* 文件不在就原样留着：jsdom 会静默跳过它，断言该红的时候自然红，
       而不是在这里抛一个和被测逻辑无关的 ENOENT。 */
    if (!fs.existsSync(abs)) return m;
    return '<script>' + fs.readFileSync(abs, 'utf8') + '</script>';
  });
}

function stubEl() {
  return {
    innerHTML: '',
    textContent: '',
    scrollTop: 0,
    scrollHeight: 0,
    clientWidth: 1200,
    clientHeight: 600,
    offsetWidth: 1200,
    offsetHeight: 600,
    parentNode: null,
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
    /* 属性操作：键盘光标要设 aria-activedescendant。
       stub 缺方法时引擎会抛 TypeError（不是断言变红），看起来像引擎坏了，
       所以 stub 要补齐"引擎真的会用到的"那几个。 */
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    focus() {},
    remove() {},
    removeChild() {},
    insertBefore() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 600 }; },
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelectorAll: () => [],
    appendChild() {}
  };
}

function loadGame(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  /* v4.21 起引擎是「外链（ai.js、notes.js）+ 内联本体」两段以上，
     必须按 HTML 顺序全拼进来，否则 AI 那 38 个符号全都是未定义。 */
  const bundle = extractAllScripts(html, path.dirname(htmlPath));
  if (!bundle) throw new Error('未找到 <script> 块：' + htmlPath);
  const code = bundle.code;

  /* localStorage：纯内存实现，只为让存档往返测试能跑通。
     真实浏览器里隐私模式 / file:// 直开可能直接抛错，代码本身有 typeof 保护，
     测试端删掉这个属性就能验证降级路径。 */
  const _ls = {};
  const sandbox = {
    console,
    localStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null),
      setItem: (k, v) => { _ls[k] = String(v); },
      removeItem: k => { delete _ls[k]; },
      clear: () => { for (const k of Object.keys(_ls)) delete _ls[k]; }
    },
    setTimeout,
    setInterval,
    clearTimeout,
    /* setInterval 起了就得有 clearInterval，否则打字机效果的收尾会抛异常。
       这跟 document 的桩是同一类问题：漏掉一个浏览器 API，错误就炸在
       "报表打完之后"，看起来像无害的退出噪音。 */
    clearInterval,
    setImmediate,
    queueMicrotask,
    Math,
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    /* 视图层用到的浏览器 API：Node 下只保证不抛错，不做真实布局 */
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (t) => clearTimeout(t),
    getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px' }),
    document: {
      getElementById: stubEl,
      querySelector: stubEl,
      querySelectorAll: () => [],
      createElement: stubEl,
      /* 剧情卡（cutin）会在 document 上挂 keydown 监听来支持 Esc 跳过。
         少了这个桩，只要有一条 say 事件被触发，自动化就会在运行末尾炸掉——
         而它炸在"报表已经打完之后"，特别容易被当成"只是退出时报错"忽略掉。 */
      addEventListener() {},
      removeEventListener() {},
      body: stubEl()
    },
    window: {
      __FAST__: true,
      innerWidth: 1200,
      innerHeight: 900,
      addEventListener() {},
      removeEventListener() {}
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window.document = sandbox.document;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: htmlPath });

  if (!sandbox.window.__WAR__) throw new Error('未导出 window.__WAR__');
  return { api: sandbox.window.__WAR__, code, sandbox, parts: bundle.parts };
}

module.exports = { loadGame, stubEl, extractScript, extractAllScripts, inlineLocalScripts };
