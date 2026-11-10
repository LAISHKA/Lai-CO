/* Симуляция: что stanieтся с механикой зацепок, если движок перестанет считать
   указательным словом то, что напечатано почти во всём деле.
   Порог T — доля корпусов дела, в которых встречается слово.
   Считаем для T = 0.15 / 0.25 / 0.35:
     • сколько направлений потеряют ВСЕ слова (перестанут checkable);
     • сколько материалов перестанут добываться ходатайством;
     • среднее число слов на направление (насколько сузится «тыканье»).
   Зачем: решает, можно ли лечить «ширину» направлений порогом в движке или
   только данными (чистка title/where/keys детей). Ответ в выводе — только
   данными: при T=0.15 умирают 79 направлений, и ширина просто заменится
   автоклапанными подарками.
   Только чтение, ничего не правит. Отчёт: tools/live/out/broad-sim.txt */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = ['js/20-app.js'];
const PAGES = ['corp_game.html', 'Lai_CO.html'];
const OUT = join(ROOT, 'tools', 'live', 'out', 'broad-sim.txt');
const elStub = () => ({ className: '', textContent: '', innerHTML: '', appendChild() {}, setAttribute() {}, addEventListener() {}, style: {} });

function loadCases() {
  const html = PAGES.map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n');
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g;
  const win = {};
  win.localStorage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  win.document = { createElement: elStub, createDocumentFragment: elStub, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, documentElement: { classList: { add() {}, remove() {} } }, head: elStub(), body: elStub() };
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    const rel = m[1];
    if (SKIP.includes(rel) || seen.has(rel)) continue;
    seen.add(rel);
    new Function('window', 'document', 'localStorage', readFileSync(join(ROOT, rel), 'utf8'))(win, win.document, win.localStorage);
  }
  return { CASES: win.CASES, H: win.HOOKS };
}
const { CASES, H } = loadCases();
const printed = (def, e) => { const v = H.renderedText(def, e); return v && v.length > 60 ? v : JSON.stringify(e.doc || ''); };
const r1 = (x) => Math.round(10 * x) / 10;

const TS = [0.15, 0.25, 0.35];
const L = [];
const blank = () => ({ dirs: 0, deadDirs: 0, hookless: 0, chain: 0, wordsSum: 0 });
const tot = { now: blank() };
TS.forEach((T) => { tot[T] = blank(); });

const perCase = [];
for (const def of CASES) {
  const ev = def.evidence || [];
  const body = new Map(ev.map((e) => [e.id, H.words(printed(def, e))]));
  const linkOpens = new Set((def.contradictions || []).map((l) => l.b));
  const docCount = {};
  body.forEach((w) => Object.keys(w).forEach((x) => { docCount[x] = (docCount[x] || 0) + 1; }));
  const row = { id: def.id, n: ev.length, now: {}, sim: {} };

  for (const e of ev) {
    if (!H.childrenOf(def, e.id).length) continue;
    for (const d of H.directions(def, e.id)) {
      const all = Object.keys(d.words);
      const live = all.length > 0;
      tot.now.dirs += live ? 1 : 0;
      tot.now.wordsSum += all.length;
      row.now.dirs = (row.now.dirs || 0) + 1;
      row.now.wordsSum = (row.now.wordsSum || 0) + all.length;
      for (const T of TS) {
        const w = all.filter((x) => docCount[x] / ev.length <= T);
        if (live) tot[T].dirs += 1;
        if (live && !w.length) tot[T].deadDirs += 1;
        tot[T].wordsSum += w.length;
        row.sim[T] = row.sim[T] || { dirs: 0, dead: 0, words: 0 };
        row.sim[T].dirs += live ? 1 : 0;
        row.sim[T].dead += live && !w.length ? 1 : 0;
        row.sim[T].words += w.length;
      }
    }
  }
  for (const e of ev) {
    const preds = (e.after || []).slice();
    if (!preds.length) continue;
    tot.now.chain++;
    const cat = e.cat || 'Материалы';
    const okNow = preds.some((p) => H.checkable(def, p, cat));
    if (!okNow && !linkOpens.has(e.id) && e.kind !== 'talk') tot.now.hookless++;
    for (const T of TS) {
      const ok = preds.some((p) => {
        const d = H.directions(def, p).filter((x) => x.cat === cat)[0];
        return !!(d && Object.keys(d.words).some((w) => docCount[w] / ev.length <= T));
      });
      tot[T].chain++;
      if (!ok && !linkOpens.has(e.id) && e.kind !== 'talk') tot[T].hookless++;
    }
  }
  perCase.push(row);
}

const avg = (o) => (o.dirs ? r1(o.wordsSum / o.dirs) : 0);
/* медиана «слов на направление» по делам — как в историческом прогоне 10.11 */
const med = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2); };
const medNow = med(perCase.map((r) => avg(r.now)));
const medAt = (T) => med(perCase.map((r) => { const s = r.sim[T] || { dirs: 0, words: 0 }; return s.dirs ? r1(s.words / s.dirs) : 0; }));
L.push('Симуляция фильтра «слово слишком частое по делу» (доля корпусов > T — слово НЕ указательное)');
L.push('Материалов цепочных: ' + tot.now.chain + '. Сейчас: направлений со словами ' + tot.now.dirs +
  ', слов на направление ' + avg(tot.now) + ' (медиана по делам ' + medNow + '), материалов вне ходатайства (только автоклапан/связь/повестка) ' + tot.now.hookless);
L.push('');
L.push('порог | направлений без слов | слов на направление (медиана по делам) | вне ходатайства');
for (const T of TS) {
  const t = tot[T];
  L.push(T.toFixed(2) + ' | ' + t.deadDirs + ' | ' + avg(t) + ' (' + medAt(T) + ') | ' + t.hookless + ' (было ' + tot.now.hookless + ')');
}
L.push('');
L.push('По делам при T=0.25 (направлений без слов / всего направлений; слов на направление сейчас → станет):');
for (const r of perCase) {
  const s = r.sim[0.25] || { dirs: 0, dead: 0, words: 0 };
  L.push('  ' + r.id + ' (материалов ' + r.n + '): ' + s.dead + ' / ' + s.dirs + '   ' +
    avg(r.now) + ' → ' + (s.dirs ? r1(s.words / s.dirs) : 0));
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(L[1]);
console.log('отчёт: ' + OUT.replace(ROOT + '\\', '') + ' (' + L.length + ' строк)');
