const fs = require('fs');
const vm = require('vm');

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
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('未找到 <script> 块：' + htmlPath);
  const code = m[1];

  const sandbox = {
    console,
    setTimeout,
    setInterval,
    clearTimeout,
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
      createElement: stubEl
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

module.exports = { loadGame, stubEl };
