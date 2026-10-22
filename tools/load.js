const fs = require('fs');
const vm = require('vm');

function stubEl() {
  return {
    innerHTML: '',
    textContent: '',
    scrollTop: 0,
    scrollHeight: 0,
    dataset: {},
    addEventListener() {},
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
    document: {
      getElementById: stubEl,
      querySelector: stubEl,
      querySelectorAll: () => [],
      createElement: stubEl
    },
    window: { __FAST__: true }
  };
  sandbox.globalThis = sandbox;
  sandbox.window.document = sandbox.document;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: htmlPath });

  if (!sandbox.window.__WAR__) throw new Error('未导出 window.__WAR__');
  return { api: sandbox.window.__WAR__, code, sandbox };
}

module.exports = { loadGame, stubEl };
