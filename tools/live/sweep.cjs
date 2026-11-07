const __p = require('path');
const T = __p.join(__dirname, 'out') + __p.sep;
const ROOTDIR = __p.resolve(__dirname, '..', '..');
require('fs').mkdirSync(T, { recursive: true });
/* sweep.cjs — свип переполнений и обрезков текста: все экраны × 2 темы × 4 ширины + печать.
   Выход: sweep.txt (находки) и shots-sweep/*.png (кадры при 1600). */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const SHOTS = T + 'shots-sweep/';
const PAGE = 'file:///' + ROOTDIR.replace(/\\+/g, '/') + '/index.html';
const CHROME = [process.env.CHROME, 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const PORT = 9353;
const log = [];
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(SHOTS)) fs.rmSync(SHOTS + f);
spawnSync('powershell', ['-NoProfile', '-Command', 'Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue'], { timeout: 20000 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* детектор: горизонтальный скролл страницы, выход текста за вьюпорт, обрезка по X и по Y */
const DET = `
function det() {
  var out = [], W = innerWidth, de = document.documentElement;
  if (de.scrollWidth > W + 1) out.push('PAGE-H-SCROLL ' + de.scrollWidth + '>' + W);
  var els = document.querySelectorAll('body *');
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    var cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    var r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    var leaf = !e.children.length;
    var txt = leaf ? (e.textContent || '').trim() : '';
    if (txt.length < 2) continue;
    var cls = (typeof e.className === 'string' ? e.className : e.tagName) || e.tagName;
    if (r.right > W + 2 || r.left < -2) out.push('OUT ' + cls + ' L' + Math.round(r.left) + ' R' + Math.round(r.right) + ' [' + txt.slice(0, 34) + ']');
    if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX === 'visible') out.push('CLIP-X ' + cls + ' ' + e.scrollWidth + '>' + e.clientWidth + ' [' + txt.slice(0, 34) + ']');
    var clampY = cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
    if (txt.length > 3 && e.scrollHeight > e.clientHeight + 2 && cs.overflowY === 'hidden' && !clampY)
      out.push('CLIP-Y ' + cls + ' ' + e.scrollHeight + '>' + e.clientHeight + ' [' + txt.slice(0, 34) + ']');
  }
  var uniq = {};
  return out.filter(function (x) { if (uniq[x]) return false; uniq[x] = 1; return true; }).slice(0, 30);
}`;

/* переходы между экранами: каждая функция возвращает имя экрана или ошибку */
const GO = {
  menu: `return 'menu';`,
  case: `
    for (var g = 0; g < 30; g++) {
      if (document.querySelector('[data-act="open-case"][data-id="case-01"]')) break;
      await new Promise(function(r){ setTimeout(r, 120); });
    }
    if (document.getElementById('view-menu').classList.contains('hidden') === false) {
      document.querySelector('[data-act="open-case"][data-id="case-01"]').click();
      await new Promise(function(r){ setTimeout(r, 400); });
    }
    var b = document.querySelector('[data-act="close-overlay"]');
    if (b) { b.click(); await new Promise(function(r){ setTimeout(r, 200); }); }
    var it = document.querySelector('.ev-item[data-ev="e01"]');
    if (it) it.click();
    await new Promise(function(r){ setTimeout(r, 250); });
    return 'case';`,
  hook: `
    var el = document.querySelector('#reader .doc') || document.getElementById('reader');
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), target = null, n;
    while ((n = w.nextNode())) { if ((n.textContent || '').trim().length >= 40) { target = n; break; } }
    if (!target) return 'hook-bar';
    var r2 = document.createRange();
    r2.setStart(target, 0);
    r2.setEnd(target, Math.min(target.nodeValue.length, 60));
    var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r2);
    var bh = document.getElementById('btn-hook');
    if (!bh || bh.disabled) return 'hook-bar';
    bh.click();
    await new Promise(function(r){ setTimeout(r, 300); });
    return 'hook';`,
  who: `
    var d = document.querySelector('.hook-dir');
    if (d) { d.click(); await new Promise(function(r){ setTimeout(r, 300); }); }
    return document.querySelector('[data-act="hook-who"]') ? 'who' : 'hook';`,
  back: `
    var x = document.querySelector('[data-act="hook-back"]') || document.querySelector('[data-act="close-overlay"]');
    if (x) { x.click(); await new Promise(function(r){ setTimeout(r, 250); }); }
    return 'case';`,
  tab: (name) => `
    var x = document.querySelector('[data-act="hook-back"]') || document.querySelector('[data-act="close-overlay"]');
    if (x) { x.click(); await new Promise(function(r){ setTimeout(r, 200); }); }
    var t = document.querySelector('.tab[data-tab="${name}"]');
    if (t) { t.click(); await new Promise(function(r){ setTimeout(r, 250); }); return '${name}'; }
    return 'no-tab-${name}';`,
  person: `
    var p = document.querySelector('#panel-persons .person');
    if (p) { p.click(); await new Promise(function(r){ setTimeout(r, 250); }); return 'person'; }
    return 'no-person';`,
  closeOv: `
    var x = document.querySelector('[data-act="close-overlay"]');
    if (x) { x.click(); await new Promise(function(r){ setTimeout(r, 200); }); }
    return 'case';`,
  verdictForm: `
    document.getElementById('btn-accuse').click();
    await new Promise(function(r){ setTimeout(r, 250); });
    var a = document.querySelector('[data-act="accuse-open"]');
    if (a) { a.click(); await new Promise(function(r){ setTimeout(r, 300); }); }
    return 'verdict-form';`,
  verdictBack: `
    var b = document.querySelector('[data-vact="back"]');
    if (b) { b.click(); await new Promise(function(r){ setTimeout(r, 250); }); }
    return 'case';`,
  verdictResult: `
    var cs = window.CASES.find(function(c){ return c.id === 'case-01'; });
    cs.objective.fields.forEach(function(x){
      var el = document.getElementById('fld-' + x.id);
      if (el) el.value = x.correct;
    });
    var s = document.querySelector('[data-vact="send"]');
    if (s) { s.click(); await new Promise(function(r){ setTimeout(r, 350); }); }
    return 'verdict-result';`
};

async function main() {
  let ws, id = 0, pending = {};
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const mid = ++id; pending[mid] = { res, rej };
    ws.send(JSON.stringify({ id: mid, method, params, sessionId: sid }));
    setTimeout(() => { if (pending[mid]) { delete pending[mid]; rej(new Error(method + ' таймаут')); } }, 30000);
  });
  const raw = async (code) => {
    const r = await send('Runtime.evaluate', { expression: '(async()=>{\n' + code + '\n})()', awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return { v: r.result.value };
  };
  const det = async () => (await raw(DET + '\nreturn det();')).v;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r && r.data) fs.writeFileSync(SHOTS + name + '.png', Buffer.from(r.data, 'base64'));
  };
  const errs = [];
  const chromeProc = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${T}chrome-sweep`,
    '--allow-file-access-from-files', PAGE], { stdio: 'ignore' });
  await sleep(3200);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id].res(m.result || m); delete pending[m.id]; }
    else if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text).slice(0, 200));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('CONSOLE ' + m.params.args.map((a) => a.value || a.description).join(' ').slice(0, 180));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  const WIDTHS = [[1920, 1040], [1600, 960], [1280, 860], [860, 900]];
  const THEMES = ['light', 'dark'];
  const total = {};

  for (const [w, h] of WIDTHS) {
    for (const theme of THEMES) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await raw(`localStorage.clear(); return 1;`);
      await send('Page.navigate', { url: PAGE });
      await sleep(1500);
      await raw(`document.documentElement.setAttribute('data-theme','${theme}'); return 1;`);
      const seq = [
        ['меню', GO.menu],
        ['дело', GO.case],
        ['ходатайство', GO.hook],
        ['лица-или-направления', GO.who],
        ['назад', GO.back],
        ['ход', GO.tab('protocol')],
        ['таймлайн', GO.tab('timeline')],
        ['заметки', GO.tab('notes')],
        ['выводы', GO.tab('clues')],
        ['люди', GO.tab('persons')],
        ['карточка', GO.person],
        ['закрыть', GO.closeOv],
        ['постановление-форма', GO.verdictForm],
        ['назад-к-делу', GO.verdictBack],
        ['дело-после-формы', GO.case],
        ['итог', GO.verdictResult]
      ];
      for (const [label, code] of seq) {
        const g = await raw(typeof code === 'function' ? code : code);
        if (g.err) { log.push(`!! ${w}x${h} ${theme} ${label}: ГО НЕ СРАБОТАЛ :: ` + g.err.slice(0, 160)); continue; }
        const bad = (await det()) || [];
        if (bad.length) {
          total[label + ' @' + w + '/' + theme] = bad.length;
          log.push(`${w}x${h} ${theme} ${label}: ${bad.length}`);
          bad.slice(0, 8).forEach((b) => log.push('    ' + b));
        }
        if (w === 1600) await shot(`${String(w)}-${theme}-${label}`.replace(/[^0-9a-zа-я-]/gi, '_'));
      }
      /* печать: лист дела, бланк постановления, итог */
      const printCheck = async (label) => {
        const p = await raw(`
          var de = document.documentElement, out = [];
          if (de.scrollWidth > innerWidth + 1) out.push('PAGE-H ' + de.scrollWidth + '>' + innerWidth);
          ['.doc,.postan,.doc-head,.doc-grif,.sheet'].forEach(function(sel){
            [].forEach.call(document.querySelectorAll(sel), function(e){
              var cs = getComputedStyle(e), r = e.getBoundingClientRect();
              if (cs.display === 'none' || !r.width) return;
              if (r.width > innerWidth + 2) out.push('WIDE ' + sel + ' ' + Math.round(r.width) + '>' + innerWidth);
              if (e.scrollWidth > e.clientWidth + 1) out.push('CLIP ' + sel + ' ' + e.scrollWidth + '>' + e.clientWidth);
            });
          });
          return out;`);
        if (p.v && p.v.length) log.push(`${w}x${h} ${theme} ПЕЧАТЬ ${label}: ${p.v.join(' | ')}`);
      };
      await raw(GO.case);
      await send('Emulation.setEmulatedMedia', { media: 'print' });
      await sleep(300);
      await printCheck('дело');
      await raw(GO.verdictForm);
      await sleep(250);
      await printCheck('бланк');
      await raw(GO.verdictResult);
      await sleep(250);
      await printCheck('итог');
      await send('Emulation.setEmulatedMedia', { media: '' });
      log.push(`--- конец: ширина ${w}, тема ${theme}`);
    }
  }
  log.push('ОШИБКИ СТРАНИЦЫ (' + errs.length + '):');
  errs.slice(0, 10).forEach((e) => log.push('  ' + e));
  const n = Object.keys(total).length;
  log.push('ИТОГО экранов с замечаниями: ' + n + ' из ' + (WIDTHS.length * THEMES.length * 16));
  fs.writeFileSync(T + 'sweep.txt', log.join('\n'), 'utf8');
  ws.close();
  chromeProc.kill();
  console.log(n ? 'замечания: ' + n : 'чисто');
}
main().catch((e) => { log.push('FATAL ' + e.message); fs.writeFileSync(T + 'sweep.txt', log.join('\n'), 'utf8'); process.exit(1); });
