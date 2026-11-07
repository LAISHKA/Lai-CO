const __p = require('path');
const T = __p.join(__dirname, 'out') + __p.sep;
const ROOTDIR = __p.resolve(__dirname, '..', '..');
require('fs').mkdirSync(T, { recursive: true });
/* silent4.cjs — что НЕ доехало на экран ПОСЛЕ починки рендера.
   Маркеры ищутся в RAW html, тексты — по norm+без пробелов. */
const fs = require('fs');
const ROOT = ROOTDIR;
const FILES = ['01-core.js', '02-evidence.js', '03-evidence.js', '04-evidence.js', '05-evidence.js', '06-evidence.js', '07-links.js', '08-final.js'];
function loadCase(cs) {
  const store = { cases: {}, registerCase(def) { this.cases[def.id] = def; } };
  const el = () => ({ className: '', textContent: '', innerHTML: '', appendChild() {}, setAttribute() {}, addEventListener() {}, style: {} });
  const doc = { createElement: el, createDocumentFragment: el, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, documentElement: { classList: { add() {}, remove() {} } }, head: el(), body: Object.assign(el(), { classList: { add() {}, remove() {} } }) };
  const win = Object.assign(store, { localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), requestAnimationFrame: () => 0, location: { hash: '' }, setTimeout: () => 0, clearTimeout() {}, DOCS: { list: [], render: () => '' } });
  new Function('window', 'document', 'localStorage', fs.readFileSync(ROOT + '/js/00-store.js', 'utf8'))(win, doc, win.localStorage);
  new Function('window', 'document', 'localStorage', fs.readFileSync(ROOT + '/js/10-docs.js', 'utf8'))(win, doc, win.localStorage);
  for (const f of FILES) {
    const p = ROOT + '/cases/' + cs + '/' + f;
    if (fs.existsSync(p)) new Function('window', 'document', 'localStorage', fs.readFileSync(p, 'utf8'))(win, doc, win.localStorage);
  }
  return { C: (win.CASES || []).find((x) => x.id === cs), D: win.DOCS };
}
const norm = (x) => String(x == null ? '' : x).replace(/<[^>]*>/g, ' ').replace(/[\s\u00A0\u2009]+/g, '').trim();
const txt = (x) => (Array.isArray(x) ? x.map(txt).join(' ') : (x && typeof x === 'object' ? Object.keys(x).map((k) => k + ' ' + txt(x[k])).join(' ') : String(x == null ? '' : x)));
const out = []; const cnt = {}; const byCase = {};
function bump(k) { cnt[k] = (cnt[k] || 0) + 1; }
function audit(cs, e, d, plain, html) {
  const bad = [];
  // короткие значения (—, «нет», цифры) проверке не подлежат: считать отрисованными
  const hasv = (v) => { const n = norm(txt(v)); if (n.length <= 3) return true; return plain.indexOf(n) >= 0; };
  (Array.isArray(d.body) ? d.body : []).forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    if (b.p && !hasv(b.p)) bad.push('body[' + i + '].p потерян');
    if (b.h && !hasv(b.h)) bad.push('body[' + i + '].h потерян');
    if (b.quote && !hasv(b.quote)) bad.push('body[' + i + '].quote потерян');
    if (b.note && !hasv(b.note)) bad.push('body[' + i + '].note потерян');
    if (b.list) b.list.forEach((x, j) => { if (!hasv(x)) bad.push('body[' + i + '].list[' + j + '] потерян'); });
    if (b.lines) b.lines.forEach((x, j) => { if (!hasv(x)) bad.push('body[' + i + '].lines[' + j + '] потерян'); });
    if (b.kv) b.kv.forEach((p, j) => { if (!hasv(p[1])) bad.push('body[' + i + '].kv[' + j + '] потерян'); });
    if (b.table && b.table.rows) b.table.rows.forEach((r, j) => { const cells = Array.isArray(r) ? r : (r.c || r.cells || []); cells.forEach((c, k) => { if (!hasv(c)) bad.push('body[' + i + '].table r' + j + 'c' + k); }); });
    const known = ['h', 'p', 'list', 'lines', 'kv', 'table', 'quote', 'note', 'sign', 'stamp', 'html', 'hand'];
    const rest = Object.keys(b).filter((k) => known.indexOf(k) < 0);
    if (rest.length) bad.push('body[' + i + ']: неизвестные ключи {' + rest.join(',') + '}');
  });
  if (Array.isArray(d.kv)) d.kv.forEach((p, i) => { if (!hasv(p[1])) bad.push('kv[' + i + '] ' + p[0] + ' потерян'); });
  if (Array.isArray(d.meta)) d.meta.forEach((p, i) => { if (!hasv(p[1])) bad.push('meta[' + i + '] ' + p[0] + ' потерян'); });
  if (Array.isArray(d.qa)) d.qa.forEach((q, i) => { if (!hasv(q.a)) bad.push('qa[' + i + '] ответ потерян'); });
  if (d.sign && !hasv(d.sign.name)) bad.push('sign.name потерян');
  if (d.stamp && !hasv(d.stamp.text)) bad.push('stamp.text потерян');
  if (d.table && d.table.rows) d.table.rows.forEach((r, i) => { const cells = Array.isArray(r) ? r : (r.c || r.cells || []); cells.forEach((c, j) => { if (!hasv(c)) bad.push('table r' + i + 'c' + j + ' потерян'); }); });
  if (d.lines) d.lines.forEach((x, i) => { if (!hasv(x)) bad.push('lines[' + i + '] потерян'); });
  if (d.note && !hasv(d.note)) bad.push('note потерян');
  if (d.source && !hasv(d.source)) bad.push('source потерян');
  if (d.subject && !hasv(d.subject)) bad.push('subject потерян');
  if (d.from && !hasv(d.from)) bad.push('from потерян');
  if (Array.isArray(d.to)) d.to.forEach((x, i) => { if (!hasv(x)) bad.push('to[' + i + '] потерян'); });
  if (Array.isArray(d.msgs)) d.msgs.forEach((m, i) => { if (m && m.text && !hasv(m.text)) bad.push('msgs[' + i + '] текст потерян'); if (m && m.day && !hasv(m.day)) bad.push('msgs[' + i + '] день потерян'); });
  if (Array.isArray(d.attach)) d.attach.forEach((a, i) => { const n = typeof a === 'string' ? a : (a.name || a.n); if (n && !hasv(n)) bad.push('attach[' + i + '] потерян'); });
  if (Array.isArray(d.ts)) d.ts.forEach((t, i) => { (Array.isArray(t) ? t : [t]).forEach((p) => { if (!hasv(p)) bad.push('ts[' + i + '] потерян'); }); });
  if (d.cap && !hasv(d.cap)) bad.push('cap потерян');
  if (d.img && html.indexOf('<img') < 0) bad.push('img есть, но <img> не отрисован');
  if (bad.length) { bad.forEach((b) => bump(b.split(/[\[ ]/)[0])); out.push(cs + ' ' + e.id + ' (' + (e.kind || '?') + '): ' + bad.join(' | ').slice(0, 300)); byCase[cs] = (byCase[cs] || 0) + 1; }
}
for (let i = 1; i <= 20; i++) {
  const cs = 'case-' + String(i).padStart(2, '0');
  const L = loadCase(cs); const C = L.C; const D = L.D;
  for (const e of C.evidence) {
    const d = e.doc || {};
    const html = D.render(e);
    audit(cs, e, d, norm(html), html);
  }
}
const rep = [];
rep.push('=== ПОТЕРИ КОНТЕНТА ПОСЛЕ ПОЧИНКИ РЕНДЕРА: файлов-строк ' + out.length + ' ===');
rep.push('СЧЁТЧИКИ: ' + JSON.stringify(cnt));
rep.push('ПО ДЕЛАМ: ' + JSON.stringify(byCase));
rep.push('');
out.forEach((l) => rep.push(l));
fs.writeFileSync(T + 'silent4.txt', rep.join('\n'), 'utf8');
console.log(rep.slice(0, 4).join('\n'));
