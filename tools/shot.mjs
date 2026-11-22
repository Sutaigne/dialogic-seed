// Headless-Chrome screenshot via CDP (no dependencies; Node 22+ global fetch/WebSocket).
// Usage: serve dist/ first, e.g.  python -m http.server 8742 --directory dist
//   CDP_URL=http://localhost:8742/dialogic-map.html node tools/shot.mjs <w> <h> <out.png> [js-to-eval-before-shot] [waitMs]
//   e.g. CDP_URL=http://localhost:8742/dialogic-map.html node tools/shot.mjs 1280 900 out/shot.png
// Env: CDP_URL (required, page to load); CHROME (optional, path to chrome.exe; default below).
// The first-open walk-through is kept shut (#guide=off is added) unless CDP_URL carries a # of its own, e.g. #guide=tour to shoot it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [w, h, out, js = '', wait = '3500'] = process.argv.slice(2);
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const udir = (process.env.TEMP || process.env.TMPDIR || "/tmp") + '/cdp-prof-' + port;
const p = spawn(chrome, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + udir, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break; } catch { } await sleep(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ')); else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); else if (m.method === 'Network.requestWillBeSent') logs.push('NET: ' + m.params.request.url.slice(0, 80)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send('Page.navigate', { url: process.env.CDP_URL + (process.env.CDP_URL.includes('#') ? '' : '#guide=off') });
await sleep(+wait);
if (js) { const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); console.log('EVAL', JSON.stringify(r.result?.result?.value ?? r.result)); await sleep(1800); }
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log(logs.filter(l => !l.startsWith('NET: ')).join('\n') || 'no console output');
ws.close(); p.kill();
