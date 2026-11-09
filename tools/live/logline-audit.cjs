const __p = require('path');
const T = __p.join(__dirname, 'out') + __p.sep;
const ROOTDIR = __p.resolve(__dirname, '..', '..');
require('fs').mkdirSync(T, { recursive: true });
/* logline.cjs — whole case logline: доступен ли он игроку целиком (на карточке он в 3 строки) */
const fs = require('fs');
const path = require('path');
const rootDir = ROOTDIR;
function elStub() {
  return { className: '', textContent: '', innerHTML: '', appendChild() {}, setAttribute() {}, addEventListener() {}, style: {} };
}
function loadCases() {
  const html = ['corp_game.html', 'Lai_CO.html']
    .map((p) => fs.readFileSync(path.join(rootDir, p), 'utf8')).join('\n');
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g;
  const seen = new Set();
  const win = {};
  win.localStorage = { _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  win.document = { createElement: elStub, createDocumentFragment: elStub, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, documentElement: { classList: { add() {}, remove() {} } }, head: elStub(), body: Object.assign(elStub(), { classList: { add() {}, remove() {} } }) };
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === 'js/20-app.js' || seen.has(m[1])) continue;
    seen.add(m[1]);
    new Function('window', 'document', 'localStorage', fs.readFileSync(path.join(rootDir, m[1]), 'utf8'))(win, win.document, win.localStorage);
  }
  return win.CASES || [];
}
const out = [];
const CASES = loadCases();
let dup = 0, uniq = 0, maxlen = 0;
for (const c of CASES) {
  const ll = String(c.logline || '');
  const br = (c.briefing || []).join(' ');
  maxlen = Math.max(maxlen, ll.length);
  const head = ll.replace(/[.…]+$/, '').slice(0, 40);
  if (head && br.indexOf(head) >= 0) dup++; else uniq++;
  if (out.length < 6) out.push(c.id + ' logline(' + ll.length + '): ' + ll + '\n   briefing(' + br.length + '): ' + br.slice(0, 150));
}
out.push('дел: ' + CASES.length + ', logline дублируется в брифинге: ' + dup + ', уникальная: ' + uniq + ', самая длинная: ' + maxlen);
fs.writeFileSync(T + 'logline.txt', out.join('\n'), 'utf8');
console.log('ok');
if (dup) process.exit(1);   /* logline дословно повторяет брифинг = падение проверки */
