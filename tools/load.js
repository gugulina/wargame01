const fs = require('fs');
const vm = require('vm');

/* 取引擎脚本块。
   不能再用 html.match(/<script>(...)/) 抓"第一个"——v4.6.1 起 <head> 里多了一段
   先行兜底脚本（window.onerror + 看门狗），它就排在第一个。抓第一个的后果是
   加载到那段 30 行的兜底代码，然后报"未导出 window.__WAR__"，看着像引擎坏了。
   改成取最长的那块：引擎有七千多行，兜底只有几十行，这个判据比"第几个"稳。 */
function extractScript(html) {
  const all = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!all.length) return null;
  return all.reduce((a, b) => (b.length > a.length ? b : a));
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
  const code = extractScript(html);
  if (!code) throw new Error('未找到 <script> 块：' + htmlPath);

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
  return { api: sandbox.window.__WAR__, code, sandbox };
}

module.exports = { loadGame, stubEl, extractScript };
