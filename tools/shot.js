/* 精确截图：用 CDP 的 Emulation.setDeviceMetricsOverride 指定视口，
   而不是 Edge 的 --window-size。
   为什么要多这一步：系统 DPI 是 125% 时，--window-size=390 实际视口会是 504，
   截出来只显示左边 390px，任何居中的卡片都像"溢出屏幕"——这个坑踩过一次，
   当时误判成 CSS 宽度问题，连改了三个版本。 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const EDGE = EDGE_CANDIDATES.find(p => fs.existsSync(p));
if (!EDGE) { console.error('找不到 msedge.exe'); process.exit(1); }

const url = process.argv[2];
const out = process.argv[3] || 'shot.png';
const W = Number(process.argv[4] || 1280);
const H = Number(process.argv[5] || 900);
const MOBILE = process.argv.includes('--mobile');
const WAIT = Number((process.argv.find(a => a.startsWith('--wait=')) || '--wait=1800').slice(7));

if (!url) { console.error('用法: node tools/shot.js <url> <out.png> [w] [h] [--mobile] [--wait=ms]'); process.exit(1); }

const port = 9300 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), 'edge-cdp-' + Date.now());

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  'about:blank'
], { stdio: 'ignore' });

const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path: p }, r => {
    let s = '';
    r.on('data', d => s += d);
    r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

async function waitPort() {
  for (let i = 0; i < 80; i++) {
    try { return await getJSON('/json/version'); }
    catch (e) { await new Promise(r => setTimeout(r, 150)); }
  }
  throw new Error('CDP 端口未就绪');
}

(async () => {
  await waitPort();
  const list = await getJSON('/json');
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: MOBILE
  });
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, WAIT));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved ' + out + '  ' + W + 'x' + H + (MOBILE ? ' mobile' : ''));

  ws.close();
  proc.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => {
  console.error('截图失败:', e.message);
  try { proc.kill(); } catch (_) {}
  process.exit(1);
});
