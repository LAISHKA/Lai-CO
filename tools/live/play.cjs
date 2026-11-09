const __p = require('path');
const T = __p.join(__dirname, 'out') + __p.sep;
const ROOTDIR = __p.resolve(__dirname, '..', '..');
require('fs').mkdirSync(T, { recursive: true });
/* play.cjs — играет в case-01 через реальный UI: чтение, выделение, ходатайства, повестки.
   Доказательство: без зацепки ничего не приходит; с зацепкой приходит; ложное направление
   отсекается; полная игра упирается только в «связи» (их проверяет tools/check-hook.mjs). */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const SHOTS = T + 'shots-play/';
const PAGE = 'file:///' + ROOTDIR.replace(/\\+/g, '/') + '/corp_game.html';
const CHROME = [process.env.CHROME, 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const PORT = 9352;
const log = [];
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(SHOTS)) fs.rmSync(SHOTS + f);
spawnSync('powershell', ['-NoProfile', '-Command', 'Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue'], { timeout: 20000 });

const HELP = `
var CS = 'case-01';
function def() { return (window.CASES||[]).find(function(c){return c.id===CS;}); }
function st() { return STORE.caseState(CS) || {}; }
function av() { return Object.keys(HOOKS.availableSet(def(), st())).length; }
function c1(sel) { var e = document.querySelector(sel); if (e) { e.click(); return 1; } return 0; }
function txt(sel) { var e = document.querySelector(sel); return e ? (e.textContent||'').trim().replace(/\\s+/g,' ') : null; }
function titles() {
  return { read: (st().read||[]).length, hooks: (st().hooks||[]).length, calls: (st().calls||[]).length,
    proto: (st().protocol||[]).length, av: av(), persons: document.querySelectorAll('#panel-persons .person').length };
}
function groups() {
  return [].map.call(document.querySelectorAll('.ev-group'), function(g) {
    return g.querySelector('b').textContent + ':' + g.querySelector('.ev-group-n').textContent;
  }).join(' | ');
}
function selRange(el, s, e) {
  var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n, pos = 0, a = null, b = null, r = document.createRange();
  while ((n = w.nextNode())) {
    var len = n.textContent.length;
    if (!a && s <= pos + len) a = { n: n, o: s - pos };
    if (!b && e <= pos + len) { b = { n: n, o: e - pos }; break; }
    pos += len;
  }
  if (!a || !b) return false;
  r.setStart(a.n, a.o); r.setEnd(b.n, b.o);
  var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true;
}
function openDoc(id) {
  var el = document.querySelector('.ev-item[data-ev="' + id + '"]');
  if (!el) return 0;
  el.click();
  return 1;
}
function readerSentences() {
  var t = (document.getElementById('reader').textContent || '').replace(/\\s+/g, ' ');
  return (t.match(/[^.!?;]+[.!?;]+[^.!?;\"]*/g) || []).map(function(s){return s.trim();})
    .filter(function(s){ return s.length >= 24 && s.length <= 300; });
}
/* цитата под направление: предложение корпуса со словом-указателем (или стемом категории) */
function quoteForCat(cat) {
  var d = HOOKS.directions(def(), S_CUR()).filter(function(x){return x.cat===cat;})[0];
  var ss = readerSentences(), q = HOOKS.words, i, w;
  var words = {};
  if (d) { var dw = q(cat + ' ' + Object.keys(d.words).join(' ')); words = dw; }
  for (i = 0; i < ss.length; i++) {
    var sw = q(ss[i]);
    for (w in sw) if (words[w]) return ss[i];
  }
  return ss[0] || null;
}
function badSentence() {
  /* предложение без единого указывающего слова ни для одного направления */
  var real = HOOKS.directions(def(), S_CUR()).map(function(d){return d.cat;});
  var all = {};
  real.forEach(function(c){ var d = HOOKS.directions(def(), S_CUR()).filter(function(x){return x.cat===c;})[0];
    if (d) Object.keys(d.words).forEach(function(w){ all[w] = 1; }); });
  var ss = readerSentences();
  for (var i = 0; i < ss.length; i++) {
    var sw = HOOKS.words(ss[i]), hit = false;
    for (var w in sw) if (all[w]) hit = true;
    if (!hit && ss[i].length > 40) return ss[i];
  }
  return null;
}
function S_CUR() {
  var on = document.querySelector('.ev-item.on');
  return on ? on.getAttribute('data-ev') : '';
}
/* повестка через интерфейс: кнопка на карточке лица (при необходимости — открыть лицо) */
function summonOne(pid) {
  var b = document.querySelector('[data-act="summon"][data-id="' + pid + '"]');
  if (b) { b.click(); return 'кнопка'; }
  var card = document.querySelector('[data-person="' + pid + '"]');
  if (card) card.click();
  return new Promise(function (r) { setTimeout(function () {
    var b2 = document.querySelector('[data-act="summon"][data-id="' + pid + '"]');
    if (b2) { b2.click(); r('кнопка после открытия'); } else r('НЕТ КНОПКИ');
  }, 260); });
}
/* ===== выделение ТОЛЬКО по отрисованному тексту (иначе getSelection пуст) ===== */
function visWalker(cb) {
  var el = document.getElementById('reader');
  var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n;
  while ((n = w.nextNode())) {
    var t = n.textContent || '';
    if (t.trim().length < 24) continue;
    if (n.parentElement && n.parentElement.getClientRects().length === 0) continue;
    if (cb(n, t)) return true;
  }
  return false;
}
function selNode(n, s, e) {
  var r = document.createRange();
  r.setStart(n, s); r.setEnd(n, e);
  var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  var got = String(sel.toString() || '').replace(/\\s+/g, ' ').trim();
  if (got.length < 12) { sel.removeAllRanges(); return null; }
  n.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return got;
}
function eachSentence(t, cb) {
  var re = /[^.!?;]+[.!?;]+/g, m;
  while ((m = re.exec(t))) {
    var head = m[0].length - m[0].replace(/^\\s+/, '').length;
    var s = m.index + head;
    var e = m.index + m[0].replace(/\\s+$/, '').length;
    var sent = t.slice(s, e);
    if (sent.trim().length >= 24 && cb(s, e, sent)) return true;
  }
  return false;
}
/* видимые текстовые узлы читалки: одна строка + карта смещений в (узел, индекс) */
function visDoc() {
  var el = document.getElementById('reader');
  var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n;
  var s = '', map = [];
  while ((n = w.nextNode())) {
    var t = n.textContent || '';
    if (!t.trim()) continue;
    if (n.parentElement && n.parentElement.getClientRects().length === 0) continue;
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (/\\s/.test(ch)) {
        if (s.charAt(s.length - 1) !== ' ') { s += ' '; map.push({ n: n, i: i }); }
        continue;
      }
      s += ch; map.push({ n: n, i: i });
    }
    if (s.charAt(s.length - 1) !== ' ') { s += ' '; map.push({ n: n, i: t.length }); }
  }
  return { text: s, map: map };
}
function selSpan(d, a, b) {
  var p = d.map[a], q = d.map[b - 1];
  if (!p || !q) return null;
  var r = document.createRange();
  r.setStart(p.n, p.i); r.setEnd(q.n, Math.min(q.i + 1, q.n.length));
  var host = p.n.parentElement;
  if (host && host.scrollIntoView) host.scrollIntoView({ block: 'center' });
  var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  var got = String(sel.toString() || '').replace(/\\s+/g, ' ').trim();
  if (got.length < 14) { sel.removeAllRanges(); return null; }
  if (p.n.parentElement) p.n.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return got;
}
/* предложения по ВСЕМУ видимому тексту: могут склеивать несколько узлов */
function eachVisSentence(d, cb) {
  var re = /[^.!?;]+[.!?;]+/g, m;
  while ((m = re.exec(d.text))) {
    var s = m.index, e = m.index + m[0].length;
    while (d.text.charAt(s) === ' ') s++;
    while (e > s && d.text.charAt(e - 1) === ' ') e--;
    var sent = d.text.slice(s, e).trim();
    if (sent.length >= 24 && cb(s, e, sent)) return true;
  }
  return false;
}
function winAround(d, pos, len) {
  var s = d.text.lastIndexOf(' ', Math.max(0, pos - 28));
  if (s < 0 || s > pos) s = pos;
  var e = d.text.indexOf(' ', pos + len + 28);
  if (e < 0 || e < pos + len) e = Math.min(d.text.length, pos + len + 28);
  return { s: s, e: e };
}
/* человек выделяет ФРАГМЕНТ со словом-мостиком, а не обязательно всё предложение */
function makeQuote(cat) {
  var dir = HOOKS.directions(def(), S_CUR()).filter(function (x) { return x.cat === cat; })[0];
  var list = [];
  if (dir) list = Object.keys(dir.words);
  var d = visDoc();
  /* слова направления нормализованы (ё->е), а корпус — нет: ищем по копии той же длины */
  var hay = d.text.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  var dbg = [];
  for (var k = 0; k < list.length; k++) {
    var re = new RegExp('(^|[^a-z0-9\u0430-\u044f\u0451])' + list[k] + '[a-z0-9\u0430-\u044f\u0451]*', 'i');
    var m = re.exec(hay);
    if (!m) { dbg.push(list[k] + ':нет в видимом тексте'); continue; }
    var pos = m.index + (m[1] ? m[1].length : 0);
    var win = winAround(d, pos, m[0].length);
    var got = selSpan(d, win.s, win.e);
    if (got) return { ok: 1, quote: got, matched: list[k] };
    dbg.push(list[k] + ':окно ' + win.s + '-' + win.e + ', выделение не удалось');
  }
  var raw = (document.getElementById('reader').textContent || '').replace(/\\s+/g, ' ').trim();
  var miss = [];
  list.forEach(function (w) { if (hay.indexOf(w) < 0) miss.push(w); });
  var where = miss.map(function (w) {
    var tw = document.createTreeWalker(document.getElementById('reader'), NodeFilter.SHOW_TEXT, null), n;
    while ((n = tw.nextNode())) {
      var tx = (n.textContent || '').replace(/ё/g, 'е');
      if (tx.toLowerCase().indexOf(w) < 0) continue;
      var p = n.parentElement, chain = [];
      var rr = document.createRange(); rr.selectNode(n);
      var nrects = rr.getClientRects().length;
      while (p && chain.length < 5) {
        var cs = getComputedStyle(p);
        chain.push(p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + (p.className ? '.' + String(p.className).split(' ')[0] : '') + '[' + cs.display + '/' + cs.visibility + '/' + cs.contentVisibility + '/rects' + p.getClientRects().length + ']');
        if (p.id === 'reader' || p.classList.contains('sheet')) break;
        p = p.parentElement;
      }
      return w + ' -> узел rects ' + nrects + ', длина ' + tx.length + ' :: ' + chain.join(' < ');
    }
    return w + ' -> нет в DOM читалки';
  });
  return { ok: 0, diag: (dir ? '' : 'НАПРАВЛЕНИЯ НЕТ; ') + 'слов ' + list.length + '; видим ' + d.text.length + ' зн., весь текст ' + raw.length + ' зн. :: ' + dbg.join(' | ') + (where.length ? ' :: ' + where.join(' ;; ') : ' :: все слова видны') };
}
function makeBadQuote() {
  var all = {};
  HOOKS.directions(def(), S_CUR()).forEach(function (x) {
    Object.keys(x.words).forEach(function (w) { all[w] = 1; });
  });
  var d = visDoc(), at = 0;
  var text = d.text.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  while (at + 30 < text.length) {
    var hard = Math.min(text.length, at + 90);
    var sp = text.lastIndexOf(' ', hard);
    if (sp <= at) sp = hard;
    var chunk = text.slice(at, sp);
    if (chunk.trim().length >= 24) {
      var ws = HOOKS.words(chunk), hit = false;
      for (var w in ws) if (all[w]) { hit = true; break; }
      if (!hit) {
        var got = selSpan(d, at, sp);
        if (got) return { ok: 1, quote: got };
      }
    }
    at = sp + 1;
  }
  return { ok: 0 };
}
function selectText(text) {
  var el = document.getElementById('reader');
  var raw = el.textContent || '';
  var idx = raw.indexOf(text);
  if (idx < 0) {
    /* поиск по нормализованным пробелам, но смещения — в СЫРОМ тексте */
    var norm = '', map = [], i;
    for (i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (/\\s/.test(ch)) {
        if (norm.charAt(norm.length - 1) !== ' ') { norm += ' '; map.push(i); }
        continue;
      }
      norm += ch; map.push(i);
    }
    var needle = text.replace(/\\s+/g, ' ').trim();
    var p = norm.indexOf(needle);
    if (p < 0) {
      needle = needle.split(/[,;:]/)[0].trim();
      p = norm.indexOf(needle);
    }
    if (p < 0) return -1;
    var s = map[p], e = map[Math.min(p + needle.length - 1, map.length - 1)] + 1;
    if (!selRange(el, s, e)) return -2;
  } else {
    if (!selRange(el, idx, idx + text.length)) return -2;
  }
  var got = String(getSelection().toString() || '').replace(/\\s+/g, ' ').trim();
  if (got.length < 12) return -3;
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return 1;
}
function whyFresh() {
  var s = st(), before = arguments[0] || [];
  var now = Object.keys(HOOKS.availableSet(def(), s));
  return now.filter(function(id){ return before.indexOf(id) < 0; }).map(function(id){
    var e = def().evidence.find(function(x){ return x.id === id; });
    var arguable = (e.after || []).some(function(pid){
      var d = HOOKS.directions(def(), pid).filter(function(x){ return x.ids.indexOf(id) >= 0; })[0];
      return d && Object.keys(d.words).length > 0;
    });
    return id + '(' + (e.kind === 'talk' ? 'протокол' : (e.after || []).length === 0 ? 'корень'
      : (arguable ? 'ЕЩЁ НЕ ПРОЧИТАН ПРЕДОК?' : 'автоклапан, слов нет')) + ')';
  });
}
function unavReasons() {
  var s = st(), avm = HOOKS.availableSet(def(), s), known = HOOKS.knownPersons(def(), s);
  var called = {};
  (s.calls || []).forEach(function(c){ called[c.pid || c] = 1; });
  function hookedTo(eid) {
    var e = def().evidence.find(function(x){ return x.id === eid; });
    return (s.hooks || []).some(function(h){
      var d = HOOKS.directions(def(), h.ev).filter(function(x){ return x.cat === h.dir; })[0];
      if (!d || d.ids.indexOf(eid) < 0) return false;
      return !h.who || !e || !(e.tags || []).length || e.tags.indexOf(h.who) >= 0;
    });
  }
  return def().evidence.filter(function(e){ return !avm[e.id]; }).map(function(e) {
    var r;
    if (e.kind === 'talk') {
      var mine = (e.tags || []).filter(function(p){ return known[p]; });
      var any = mine.some(function(p){ return called[p]; });
      if (!hookedTo(e.id)) r = 'нет зацепки, которая выводит на этот протокол (лица: ' + (mine.join(',') || 'никто не установлен') + ')';
      else if (!mine.length) r = 'никто из тегов не известен';
      else if (!any) r = 'зацепка есть, но никто из лиц (' + mine.join(',') + ') не вызван';
      else r = 'ПОВЕСТКА ЕСТЬ, НО НЕ ОТКРЫЛСЯ';
    } else if ((e.after || []).length) {
      var un = e.after.filter(function(id){ return (s.read || []).indexOf(id) < 0; });
      r = un.length ? 'не прочитан предок ' + un.join(',') : 'зацепка не оформлена/не найдена';
    } else r = 'корень не открыт(!)';
    return e.id + ' [' + e.cat + '/' + e.kind + '] ' + r;
  });
}
function ovTitle() { return txt('.overlay:not(.hidden) .ov-title'); }
function dirBtns() {
  return [].map.call(document.querySelectorAll('.hook-dirs .hook-dir'), function(b){
    return b.getAttribute('data-dir');
  });
}
function realCats() {
  return HOOKS.directions(def(), S_CUR()).map(function(d){ return d.cat; });
}
/* сколько лиц предлагает оверлей «Кого вызываем?» и кнопка по индексу */
function whoCount() {
  return document.querySelectorAll('.hook-dirs .hook-dir[data-who]').length;
}
function clickWho(i) {
  var bs = document.querySelectorAll('.hook-dirs .hook-dir[data-who]');
  if (!bs.length) return '';
  var b = bs[(i || 0) % bs.length];
  b.click();
  return b.getAttribute('data-who');
}
function clickDir(cat) {
  var sel = '.hook-dirs .hook-dir[data-dir="' + cat.replace(/"/g, '') + '"]';
  return c1(sel);
}
`;

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${T}chrome-play2`,
  '--window-size=1680x1000', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', detached: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let ws, id = 0, pending = {};
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const msgId = ++id; pending[msgId] = { res, rej };
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId: sid }));
    setTimeout(() => { if (pending[msgId]) { delete pending[msgId]; rej(new Error(method + ' таймаут')); } }, 30000);
  });
  const evl = async (code) => {
    const r = await send('Runtime.evaluate', { expression: '(async()=>{\n' + HELP + '\n' + code + '\n})()', awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return { v: r.result.value };
  };
  const shot = async (name, sid) => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
    if (r && r.data) fs.writeFileSync(SHOTS + name + '.png', Buffer.from(r.data, 'base64'));
  };
  const errs = [];
  await sleep(2800);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => { ws.onopen = res; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id].res(m.result || m); delete pending[m.id]; }
    else if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text).slice(0, 220));
    else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errs.push('CONSOLE ' + m.params.type + ' ' + m.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE });
  await sleep(2200);
  const phase = async (label, fn) => {
    try { await fn(); log.push('FASE OK: ' + label); }
    catch (e) { log.push('FASE FAIL: ' + label + ' :: ' + e.message); }
  };
  const need = (r, what) => { if (r.err) throw new Error(what + ' :: ' + r.err); return r.v; };

  await phase('меню', async () => {
    const r = need(await evl(`return document.querySelectorAll('#case-list .case-card, #case-list [data-act="open-case"]').length;`), 'меню');
    log.push('дел в меню: ' + r);
    await shot('01-menu');
  });

  await phase('старт case-01', async () => {
    need(await evl(`localStorage.removeItem('sr.save.v1'); return 1;`), 'clear-save');
    await send('Page.navigate', { url: PAGE });
    await sleep(2000);
    if (need(await evl(`return (st().read || []).length;`), 'read0') !== 0) throw new Error('сейв не очищен');
    need(await evl(`c1('[data-act="open-case"][data-id="case-01"]'); await new Promise(r=>setTimeout(r,600)); return txt('#ov-title')||txt('.ov-title');`), 'вход');
    log.push('брифинг: ' + need(await evl(`return txt('.ov-title');`), 'ovtitle'));
    need(await evl(`return c1('[data-act="close-overlay"]');`), 'закрыть брифинг');
    await sleep(500);
    log.push('после брифинга: ' + JSON.stringify(need(await evl(`return titles();`), 'titles')));
    log.push('группы: ' + need(await evl(`return groups();`), 'groups'));
    /* читалка печатает лист с content-visibility:auto: у текста ниже сгиба НЕТ
       клиентских прямоугольников, и тест ослепает. Человек доскроллит — тест
       отключает пропускаемую раскладку, чтобы выделять корпус целиком. */
    need(await evl(`var s=document.createElement('style');s.id='test-nocv';
      s.textContent='#reader,#reader *{content-visibility:visible !important}';
      document.head.appendChild(s); return 1;`), 'nocv');
    await shot('02-start');
  });

  await phase('чтение корней (проверка: ничего не приходит)', async () => {
    const roots = need(await evl(`return def().evidence.filter(function(e){return !e.after||!e.after.length;}).map(function(e){return e.id;}).slice(0,5);`), 'roots');
    const before = need(await evl(`return Object.keys(HOOKS.availableSet(def(), st()));`), 'avBefore');
    for (const rid of roots) { need(await evl(`return openDoc(${JSON.stringify(rid)});`), 'open'); await sleep(240); }
    const t = need(await evl(`return titles();`), 'titles');
    log.push('прочитано: ' + JSON.stringify(roots) + ' -> ' + JSON.stringify(t));
    log.push('НОВОЕ без зацепки: ' + JSON.stringify(need(await evl(`return whyFresh(${JSON.stringify(before)});`), 'why')));
    log.push('люди: ' + need(await evl(`return txt('.persons-note');`), 'pnote'));
    log.push('группы: ' + need(await evl(`return groups();`), 'groups'));
    await shot('03-after-roots');
    if (t.hooks !== 0) throw new Error('появились хуки без ходатайств');
    if (t.read < 5) throw new Error('корни не прочитаны: ' + t.read);
  });

  await phase('зацепка: выделение -> направление -> поступление', async () => {
    const dirs = need(await evl(`var ids = st().read, out = null;
      for (var i = 0; i < ids.length && !out; i++) { openDoc(ids[i]);
        var ds = HOOKS.pendingDirections(def(), st(), ids[i]).filter(function(d){ return HOOKS.checkable(def(), ids[i], d.cat); });
        if (ds.length) out = { id: ids[i], cats: ds.map(function(d){return d.cat;}) };
      }
      return out;`), 'findMove');
    if (!dirs) throw new Error('нет материала с направлениями');
    await sleep(200);
    const cat = dirs.cats[0];
    const m = need(await evl(`return makeQuote(${JSON.stringify(cat)});`), 'mq');
    if (!m.ok) throw new Error('нет отрисованной цитаты под направление ' + cat + ' в ' + dirs.id);
    const quote = m.quote;
    log.push('ход: ' + dirs.id + ' -> «' + cat + '» :: ' + quote.slice(0, 64) + ' [мостик ' + m.matched + ']');
    log.push('панель: ' + need(await evl(`var b=document.getElementById('hook-bar');
      return (b.classList.contains('hidden') ? 'СКРЫТА' : 'видна') + ' :: ' + txt('#hook-quote');`), 'hookbar'));
    const form = need(await evl(`c1('#btn-hook'); await new Promise(r=>setTimeout(r,350));
      return { title: ovTitle(), btns: dirBtns() };`), 'form');
    if (!/ходатайство/i.test(form.title || '')) throw new Error('форма не открылась: ' + form.title);
    log.push('форма: ' + form.title + ' | направлений: ' + form.btns.length + ' → ' + form.btns.join(', '));
    await shot('04-hook-form');
    const res = need(await evl(`return clickDir(${JSON.stringify(cat)});`), 'clickDir');
    if (!res) throw new Error('кнопка направления «' + cat + '» не найдена среди: ' + form.btns.join(','));
    await sleep(400);
    const who = need(await evl(`return ovTitle() === 'Направление: ' + ${JSON.stringify(cat)} ? (function(){
      var b = document.querySelector('.hook-dirs .hook-dir'); return b ? b.getAttribute('data-who') : ''; })() : '';`), 'who');
    if (who) {
      need(await evl(`return c1('.hook-dirs .hook-dir');`), 'who-click');
      await sleep(350);
    }
    const title = need(await evl(`return ovTitle();`), 'ovtitle2');
    const t = need(await evl(`return titles();`), 'titles2');
    log.push('итог: ' + title + (who ? ' (лицо вызвано: ' + who + ')' : '') + ' | ' + JSON.stringify(t));
    log.push('новое в деле: ' + JSON.stringify(need(await evl(`return [].slice.call(document.querySelectorAll('.hook-arrived .link-ev')).map(function(b){return b.textContent.trim();});`), 'arrived')));
    await shot('05-hook-ok');
    need(await evl(`return c1('[data-act="close-overlay"]');`), 'close');
    if (title !== 'Ходатайство принято') throw new Error('зацепка не принята: ' + title);
    if (t.hooks < 1) throw new Error('ходатайство не записано');
  });

  await phase('отказ по ложному направлению', async () => {
    const prep = need(await evl(`var ids = st().read, out = null;
      for (var i = 0; i < ids.length && !out; i++) { openDoc(ids[i]);
        var ds = HOOKS.pendingDirections(def(), st(), ids[i]).filter(function(d){ return HOOKS.checkable(def(), ids[i], d.cat); });
        if (ds.length) out = { id: ids[i], cat: ds[0].cat };
      }
      return out;`), 'prep2');
    if (!prep) throw new Error('нет материала с направлениями для отказа');
    await sleep(200);
    const m2 = need(await evl(`return makeBadQuote();`), 'bq');
    if (!m2.ok) throw new Error('нет отрисованной цитаты без указывающих слов');
    log.push('цитата для отказа: ' + m2.quote.slice(0, 64));
    need(await evl(`c1('#btn-hook'); await new Promise(r=>setTimeout(r,350)); return 1;`), 'form2');
    const fake = need(await evl(`return HOOKS.dummies(def(), S_CUR(), 1)[0] || '';`), 'fakeCat');
    if (!fake) throw new Error('дело без ложных категорий — проверка отказа не выполнена');
    const hooksBefore = need(await evl(`return (st().hooks||[]).length;`), 'hooksBefore');
    const clicked = need(await evl(`return clickDir(${JSON.stringify(fake)});`), 'clickFake');
    await sleep(350);
    const title = need(await evl(`return ovTitle();`), 't3');
    const t = need(await evl(`return titles();`), 't4');
    log.push('ложное направление «' + fake + '»: кнопка ' + clicked + ' -> ' + title + ' | ' + JSON.stringify(t));
    await shot('06-hook-refused');
    need(await evl(`return c1('[data-act="hook-back"]') || c1('[data-act="close-overlay"]');`), 'back');
    if (!clicked) throw new Error('кнопки ложного направления нет в форме: ' + fake);
    if (title !== 'Оснований не вижу') throw new Error('ложное направление прошло: ' + title);
    if (t.hooks !== hooksBefore) throw new Error('отказ записал ходатайство: ' + hooksBefore + ' -> ' + t.hooks);
  });

  await phase('полная игра: читаем, ходатайствуем, вызываем', async () => {
    let stall = 0, last = 0, iter = 0;
    const skip = [], dead = [], tries = {}, noQuote = [];
    /* кругами: ходатайства -> повестки -> дочитка, пока что-то двигается */
    for (let round = 0; round < 4; round++) {
    for (; iter < 90; iter++) {
      const step = need(await evl(`
        var s = st(), avm = HOOKS.availableSet(def(), s);
        var unread = def().evidence.filter(function(e){ return avm[e.id] && (s.read||[]).indexOf(e.id) < 0; });
        for (var i = 0; i < unread.length && i < 12; i++) { openDoc(unread[i].id); await new Promise(r=>setTimeout(r,60)); }
        return unread.length;`), 'readAll');
      await sleep(200);
      const moved = need(await evl(`
        var ids = st().read, tries = ${JSON.stringify(tries)}, skip = ${JSON.stringify(skip)}, dead = ${JSON.stringify(dead)}, out = null;
        for (var i = 0; i < ids.length && !out; i++) {
          var ds = HOOKS.pendingDirections(def(), st(), ids[i]).filter(function(d){ return HOOKS.checkable(def(), ids[i], d.cat); });
          for (var j = 0; j < ds.length; j++) {
            var k = ids[i] + '|' + ds[j].cat;
            if (skip.indexOf(k) >= 0 || dead.indexOf(k) >= 0) continue;
            out = { id: ids[i], cat: ds[j].cat, try: tries[k] || 0 };
            break;
          }
        }
        if (out) { openDoc(out.id); }
        return out;`), 'move');
      if (!moved) break;
      await sleep(220);
      const m3 = need(await evl(`return makeQuote(${JSON.stringify(moved.cat)});`), 'q3');
      if (!m3.ok) {
        log.push('  нет цитаты под направление: ' + moved.id + ' / ' + moved.cat + ' :: ' + (m3.diag || 'без диагностики'));
        noQuote.push(moved.id + '/' + moved.cat);
        dead.push(moved.id + '|' + moved.cat);
        iter--;
        continue;
      }
      need(await evl(`c1('#btn-hook'); await new Promise(r=>setTimeout(r,300)); return 1;`), 'form3');
      const clicked = need(await evl(`return clickDir(${JSON.stringify(moved.cat)});`), 'click3');
      if (!clicked) { log.push('  направления нет в форме: ' + moved.id + '/' + moved.cat); skip.push(moved.id + '|' + moved.cat); iter--; continue; }
      await sleep(320);
      const avBefore = need(await evl(`return Object.keys(HOOKS.availableSet(def(), st())).length;`), 'avBefore3');
      const whoBtn = need(await evl(`return ovTitle() === 'Направление: ' + ${JSON.stringify(moved.cat)} ? whoCount() : 0;`), 'whoCheck');
      let who = '';
      if (whoBtn) {
        who = need(await evl(`return clickWho(${moved.try});`), 'whoClick') || '';
        await sleep(300);
      }
      const title = need(await evl(`return ovTitle();`), 't5');
      need(await evl(`return c1('[data-act="close-overlay"]');`), 'close5');
      const t = need(await evl(`return titles();`), 't6');
      const key = moved.id + '|' + moved.cat;
      tries[key] = (tries[key] || 0) + 1;
      if (t.av === avBefore) {
        /* направление отработано, а поступление не сдвинулось: пробуем другое лицо, пока они есть */
        if (whoBtn && tries[key] > whoBtn) { skip.push(key); }
        else if (!whoBtn) { skip.push(key); }
      }
      if (tries[key] > 6) skip.push(key);
      const prog = need(await evl(`
        var s = st();
        return Object.keys(HOOKS.availableSet(def(), s)).length + (s.hooks||[]).length + (s.calls||[]).length
          + HOOKS.summonsTargets(def(), s).length + Object.keys(HOOKS.knownPersons(def(), s)).length;`), 'prog');
      if (prog === last) { stall++; if (stall >= 8) { log.push('  стоп: прогресс ' + prog + ' последн. ответ ' + title); break; } } else stall = 0;
      last = prog;
      if (iter % 6 === 0 || t.av >= 30) log.push('  шаг ' + iter + ': ' + moved.id + ' -> ' + moved.cat + (who ? ' (' + who + ')' : '') + ' :: ' + title + ' :: read ' + t.read + ' av ' + t.av + ' hooks ' + t.hooks + ' calls ' + t.calls + ' лиц ' + t.persons);
    }
    /* повестки всем, у кого есть не поступившие протоколы */
    const sum = need(await evl(`
      var s = st(), out = [];
      for (var i = 0; i < 12; i++) {
        var ts = HOOKS.summonsTargets(def(), STORE.caseState(CS));
        if (!ts.length) break;
        var pid = ts[0].person.id;
        out.push(pid);
        /* повестка через UI: карточка лица -> data-act=summon */
        c1('[data-act="summon"][data-id="' + pid + '"]');
        await new Promise(r=>setTimeout(r,120));
        if (!(STORE.caseState(CS).calls||[]).some(function(c){ return (c.pid||c) === pid; })) {
          /* если карточки нет на виду — открыть лицо и нажать в читалке */
          c1('[data-person="' + pid + '"]');
          await new Promise(r=>setTimeout(r,250));
          c1('[data-act="summon"][data-id="' + pid + '"]');
          await new Promise(r=>setTimeout(r,200));
        }
      }
      return out;`), 'summon');
    await sleep(300);
    if (sum.length) log.push('повесток выдано через UI: ' + sum.length + ' (' + sum.slice(0, 8).join(', ') + ')');
    /* ещё круг чтения после повесток */
    let readAgain = 0;
    for (let k = 0; k < 8; k++) {
      const n = need(await evl(`
        var s = st(), avm = HOOKS.availableSet(def(), s);
        var unread = def().evidence.filter(function(e){ return avm[e.id] && (s.read||[]).indexOf(e.id) < 0; });
        for (var i = 0; i < unread.length && i < 12; i++) { openDoc(unread[i].id); await new Promise(r=>setTimeout(r,60)); }
        return unread.length;`), 'read2');
      readAgain = n;
      if (!n) break;
      await sleep(150);
    }
    const left = need(await evl(`
      var s = st(), avm = HOOKS.availableSet(def(), s), pend = 0;
      (s.read||[]).forEach(function(id){ pend += HOOKS.pendingDirections(def(), s, id).filter(function(d){ return HOOKS.checkable(def(), id, d.cat); }).length; });
      return { unread: def().evidence.filter(function(e){ return avm[e.id] && (s.read||[]).indexOf(e.id) < 0; }).length,
               summons: HOOKS.summonsTargets(def(), s).length, pend: pend };`), 'left');
    log.push('  круг ' + round + ': непрочитано ' + left.unread + ', повесток к выдаче ' + left.summons + ', направлений в работе ' + left.pend);
    if (!left.unread && !left.summons && !left.pend) break;
    if (!readAgain && !left.summons && !left.pend) break;
    skip.length = 0;
    }
    const t = need(await evl(`return titles();`), 'final');
    const reasons = need(await evl(`return unavReasons();`), 'reasons');
    log.push('итог игры: ' + JSON.stringify(t) + ' из 38 материалов, 10 лиц, ' + need(await evl(`return def().contradictions.length;`), 'links') + ' связей');
    log.push('группы: ' + need(await evl(`return groups();`), 'groups2'));
    log.push('не поступило (' + reasons.length + '):');
    reasons.forEach((r) => log.push('   - ' + r));
    const dbgState = need(await evl(`
      var s = st(), av = HOOKS.availableSet(def(), s);
      return {
        hooks: (s.hooks||[]).map(function(h){ return h.ev + '>' + h.dir + '/' + (h.who || '-') + (h.ok ? '' : '(отказ)'); }),
        calls: (s.calls||[]).map(function(c){ return JSON.stringify(c); }),
        pendingTalks: Object.keys(HOOKS.pendingTalks(def(), s)),
        summonsTargets: HOOKS.summonsTargets(def(), s).map(function(t){ return t.person.id; }),
        talks: def().evidence.filter(function(e){ return e.kind === 'talk'; }).map(function(e){
          return e.id + '[' + (e.tags||[]).join('/') + ']' + (av[e.id] ? '=открыт' : '') + (e.after ? '<' + e.after.join(',') : '');
        })
      };`), 'dbgstate');
    log.push('СОСТОЯНИЕ: ' + JSON.stringify(dbgState, null, 1));
    need(await evl(`c1('.tab[data-tab="protocol"]'); await new Promise(r=>setTimeout(r,250)); return 1;`), 'tab');
    log.push('строк протокола: ' + need(await evl(`return document.querySelectorAll('.proto-row').length;`), 'protorows'));
    const total = need(await evl(`return def().evidence.length;`), 'totalN');
    if (noQuote.length) throw new Error('нет выделенной цитаты: ' + noQuote.join(', '));
    if (reasons.length) throw new Error('не поступило ' + reasons.length + ' из ' + total + ': ' + reasons.join(' | ').slice(0, 300));
    if (t.read < total) throw new Error('прочитано ' + t.read + ' из ' + total);
    if (!t.proto) throw new Error('протокол хода пуст');
    await shot('07-play-end');
  });

  await phase('переполнения', async () => {
    const bad = need(await evl(`
      var out = [];
      ['.ev-t','.ev-s','.ev-group-h','.hook-dir','.proto-x','.p-claim','.p-why','.persons-note','.ev-dirs','.folder-tab','.ft-name','.doc-grif','.dg-case','.doc-stamp'].forEach(function(sel) {
        [].forEach.call(document.querySelectorAll(sel), function(e) {
          if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.textContent.trim().length > 3) out.push(sel + ' :: ' + e.scrollWidth + '>' + e.clientWidth);
        });
      });
      return out;`), 'ovf');
    log.push('переполнений: ' + bad.length + (bad.length ? ' :: ' + bad.slice(0, 8).join(' | ') : ''));
  });

  await phase('каркас: папка, гриф, постановление', async () => {
    /* штамп и лист дела на материале, приобщённом по ходатайству */
    need(await evl(`openDoc('e16'); return 1;`), 'open16');
    await sleep(200);
    const g = need(await evl(`
      var st = document.getElementById('doc-stamp');
      return { tab: txt('.folder-tab'), grif: txt('.doc-grif'), stamp: (st.textContent||'').trim(), hidden: st.classList.contains('hidden') };`), 'grif');
    log.push('каркас: папка «' + g.tab + '» || лист «' + g.grif + '» || штамп «' + g.stamp + '»');
    if (!/ДЕЛО/.test(g.tab || '')) throw new Error('корешок папки пуст: ' + g.tab);
    if (!/л\. д\./.test(g.grif || '')) throw new Error('в грифе нет листа дела: ' + g.grif);
    if (g.hidden || !/ХОДАТАЙСТВУ/.test(g.stamp || '')) throw new Error('штамп на e16 не тот: ' + JSON.stringify(g));
    /* сдача: ворота -> отдельный экран с бланком */
    need(await evl(`c1('#btn-accuse'); return 1;`), 'accuse');
    await sleep(220);
    need(await evl(`c1('[data-act="accuse-open"]'); return 1;`), 'accuse-open');
    await sleep(260);
    const vd = need(await evl(`
      var v = document.getElementById('view-verdict'), c = document.getElementById('view-case');
      return { shown: !v.classList.contains('hidden'), caseHidden: c.classList.contains('hidden'),
        postan: !!v.querySelector('.postan'), head: txt('.pa-title'), sub: txt('#vd-sub'),
        fields: v.querySelectorAll('.pa-field select').length,
        acts: [].map.call(v.querySelectorAll('[data-vact]'), function (b) { return b.getAttribute('data-vact'); }) };`), 'vdform');
    log.push('бланк: открыт ' + vd.shown + ', дело скрыто ' + vd.caseHidden + ', подзаголовок «' + vd.sub + '», полей ' + vd.fields + ', кнопки [' + vd.acts.join(',') + ']');
    if (!vd.shown || !vd.postan) throw new Error('экран постановления не открылся: ' + JSON.stringify(vd));
    if (!vd.fields) throw new Error('в бланке нет полей');
    if (vd.acts.indexOf('send') < 0) throw new Error('в бланке нет кнопки подписания');
    /* переполнения на бланке до отправки */
    const ovfForm = need(await evl(`
      var out = [];
      ['.pa-cap','.pa-title','.pa-meta','.pa-intro','.pa-flabel','.pa-fline','.pa-sign-row','.pa-foot'].forEach(function (sel) {
        [].forEach.call(document.querySelectorAll('#view-verdict ' + sel), function (e) {
          if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.textContent.trim().length > 3)
            out.push(sel + ' ' + e.scrollWidth + '>' + e.clientWidth + ' :: ' + e.textContent.trim().slice(0, 46));
        });
      });
      return out;`), 'ovfform');
    log.push('переполнений в бланке (форма): ' + ovfForm.length + (ovfForm.length ? ' :: ' + ovfForm.slice(0, 5).join(' | ') : ''));
    /* заполняем заключение правильно и подписываем */
    const res = need(await evl(`
      var f = def().objective.fields;
      f.forEach(function (x) {
        var el = document.getElementById('fld-' + x.id);
        if (el) { el.value = x.correct; el.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      c1('[data-vact="send"]');
      await new Promise(function (r) { setTimeout(r, 320); });
      var v = document.getElementById('view-verdict');
      return { badge: txt('.verdict-badge'), name: txt('.pa-name'), tables: v.querySelectorAll('.score-table').length,
        rows: v.querySelectorAll('.score-table tr').length,
        prose: v.querySelector('.prose') ? (v.querySelector('.prose').textContent || '').trim().length : 0,
        clock: txt('#vd-clock') };`), 'send');
    log.push('итог: ' + res.badge + ' || «' + res.name + '» || таблиц ' + res.tables + ', строк ' + res.rows + ', реконструкция ' + res.prose + ' зн., часы ' + res.clock);
    if (!/РАСКРЫТО/.test(res.badge || '')) throw new Error('неожиданный итог: ' + res.badge);
    if (res.tables < 2 || !res.rows) throw new Error('нет таблицы оценки: ' + JSON.stringify(res));
    if (!res.prose) throw new Error('нет реконструкции событий');
    const ovfRes = need(await evl(`
      var out = [];
      ['.pa-name','.pa-intro','.score-table','.reveal-h','.prose','.pa-foot'].forEach(function (sel) {
        [].forEach.call(document.querySelectorAll('#view-verdict ' + sel), function (e) {
          if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.textContent.trim().length > 3)
            out.push(sel + ' ' + e.scrollWidth + '>' + e.clientWidth + ' :: ' + e.textContent.trim().slice(0, 46));
        });
      });
      return out;`), 'ovfres');
    log.push('переполнений в бланке (итог): ' + ovfRes.length + (ovfRes.length ? ' :: ' + ovfRes.slice(0, 5).join(' | ') : ''));
    await shot('08-verdict');
    if (ovfForm.length || ovfRes.length) throw new Error('переполнение бланка постановления');
    /* выход в меню по кнопке «К списку дел» */
    need(await evl(`c1('[data-vact="menu"]'); return 1;`), 'vmenu');
    await sleep(260);
    const back = need(await evl(`
      return { menu: !document.getElementById('view-menu').classList.contains('hidden'),
        vd: document.getElementById('view-verdict').classList.contains('hidden') };`), 'vback');
    log.push('выход из постановления: меню ' + back.menu + ', бланк скрыт ' + back.vd);
    if (!back.menu || !back.vd) throw new Error('из постановления не вернулись в меню: ' + JSON.stringify(back));
  });

  log.push('ОШИБКИ СТРАНИЦЫ (' + errs.length + '):');
  errs.slice(0, 12).forEach((e) => log.push('  ' + e));
  fs.writeFileSync(T + 'play.txt', log.join('\n'), 'utf8');
  ws.close(); chrome.kill();
  console.log(log.find((l) => l.startsWith('FASE')) || 'готово');
}
main().catch((e) => { log.push('FATAL ' + e.message); fs.writeFileSync(T + 'play.txt', log.join('\n'), 'utf8'); chrome.kill(); process.exit(1); });
