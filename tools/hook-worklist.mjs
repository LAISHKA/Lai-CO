/* Диагноз механики зацепок: точный список дефектов по адресам (дело → материал → поле).
   Считает по реальной модели js/15-hook-engine.js, ничего не правит.
   Печатает:
     1) материалы, которые не добыть ходатайством (+ готовые слова-мосты из текста основания);
     2) основания, где не обосновать словами ни одно направление;
     3) широкие указывающие слова (более BROAD_LIMIT корпусов) с адресами детей;
     4) материалы, которым не помогает ни связь, ни повестка — только автоклапан.
   Выход: tools/live/out/hook-worklist.txt (для среды PowerShell — перенаправить в файл). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = ['js/20-app.js'];
const PAGES = ['corp_game.html', 'Lai_CO.html'];
const BROAD_LIMIT = Number(process.env.BROAD_LIMIT || 6);
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
  return { CASES: win.CASES || [], H: win.HOOKS };
}

const { CASES, H } = loadCases();
const printed = (def, e) => {
  const v = H.renderedText(def, e);
  return v && v.length > 60 ? v : JSON.stringify(e.doc || '');
};
const L = [];
const cnt = { hookless: 0, silent: 0, broad: 0, valveOnly: 0 };

for (const def of CASES) {
  const ev = def.evidence || [];
  const textOf = new Map(ev.map((e) => [e.id, H.words(printed(def, e))]));
  const ownOf = new Map(ev.map((e) => [e.id, H.words(H.ownText(def, e))]));
  const sigOf = new Map(ev.map((e) => [e.id, H.words(H.childSig(def, e))]));
  const n = ev.length || 1;
  const df = {};
  sigOf.forEach((w) => Object.keys(w).forEach((x) => { df[x] = (df[x] || 0) + 1; }));
  const generic = new Set(Object.keys(df).filter((x) => df[x] / n > 0.35));
  const corpCount = {};
  textOf.forEach((w) => Object.keys(w).forEach((x) => { corpCount[x] = (corpCount[x] || 0) + 1; }));
  const linkOpens = new Set((def.contradictions || []).map((l) => l.b));

  /* 1 и 4: что не добывается ходатайством */
  const rows = [];
  for (const e of ev) {
    const preds = (e.after || []).slice();
    if (!preds.length) continue;
    const cat = e.cat || 'Материалы';
    if (preds.some((p) => H.checkable(def, p, cat))) continue;
    const byLink = linkOpens.has(e.id);
    const bySummon = e.kind === 'talk';
    cnt.hookless++;
    if (!byLink && !bySummon) cnt.valveOnly++;
    const childBody = textOf.get(e.id) || {};
    const sugg = {};
    for (const p of preds) {
      const own = ownOf.get(p) || {};
      sugg[p] = Object.keys(own)
        .filter((w) => !generic.has(w) && w.length > 3 && childBody[w])
        .sort((a, b) => (df[a] || 9) - (df[b] || 9) || b.length - a.length)
        .slice(0, 6);
    }
    rows.push({ id: e.id, title: e.title, cat, preds, byLink, bySummon, sugg, valve: !byLink && !bySummon });
  }
  /* 2: основания без словесного направления */
  const silent = [];
  for (const e of ev) {
    if (!H.childrenOf(def, e.id).length) continue;
    const live = H.directions(def, e.id).filter((d) => Object.keys(d.words).length);
    if (live.length) continue;
    cnt.silent++;
    silent.push({ id: e.id, title: e.title, kids: H.childrenOf(def, e.id).map((k) => k.id + ' [' + (k.cat || 'Материалы') + ']') });
  }
  /* 3: широкие слова */
  const broad = [];
  const seenP = new Set();
  for (const e of ev) {
    if (!H.childrenOf(def, e.id).length) continue;
    for (const d of H.directions(def, e.id)) {
      for (const w of Object.keys(d.words || {})) {
        const key = e.id + '|' + d.cat + '|' + w;
        if (seenP.has(key)) continue;
        seenP.add(key);
        const where = ev.filter((x) => (textOf.get(x.id) || {})[w]);
        if (where.length <= BROAD_LIMIT) continue;
        cnt.broad++;
        const kids = H.childrenOf(def, e.id).filter((c) => (c.cat || 'Материалы') === d.cat);
        const inSig = kids.filter((k) => (sigOf.get(k.id) || {})[w]).map((k) => k.id);
        broad.push({ src: e.id, cat: d.cat, w, c: where.length, kidList: kids.map((k) => k.id), inSig });
      }
    }
  }
  if (!rows.length && !silent.length && !broad.length) continue;
  L.push('══════ ' + def.id + ' — ' + (def.title || ''));
  for (const r of rows) {
    L.push((r.valve ? '  [ТОЛЬКО АВТОКЛАПАН] ' : '  ') + 'не добыть: ' + r.id + ' «' + r.title + '» (' + r.cat + ') после ' + r.preds.join('+') +
      (r.byLink ? ' [ОТКРЫВАЕТСЯ СВЯЗЬЮ]' : '') + (r.bySummon ? ' [ПОВЕСТКА]' : ''));
    for (const p of r.preds) {
      const s = r.sugg[p] || [];
      L.push('      мост из ' + p + ': ' + (s.length ? s.join(', ') : 'НЕТ — в тексте основания нет ни одного редкого слова тела ребёнка'));
    }
  }
  for (const s of silent) L.push('  основание без направления: ' + s.id + ' «' + s.title + '» → ' + s.kids.join(', '));
  const bmap = new Map();
  for (const b of broad) {
    const k = b.src + ' → ' + b.cat;
    if (!bmap.has(k)) bmap.set(k, []);
    bmap.get(k).push(b);
  }
  for (const [k, list] of bmap) {
    L.push('  широкие слова ' + k + ':');
    for (const b of list) {
      L.push('      «' + b.w + '» в ' + b.c + ' корпусах → дети ' + b.kidList.join(',') +
        (b.inSig.length ? ' | УЖЕ В АДРЕСЕ РЕБЁНКА: ' + b.inSig.join(',') : ''));
    }
  }
}
L.unshift('дела: ' + CASES.length + ' | не добыть ходатайством: ' + cnt.hookless + ' | из них только автоклапан: ' + cnt.valveOnly +
  ' | оснований без направления: ' + cnt.silent + ' | широких вхождений: ' + cnt.broad +
  ' (порог: слово более чем в ' + BROAD_LIMIT + ' корпусах)');
try { mkdirSync(join(ROOT, 'tools/live/out'), { recursive: true }); } catch (e) { }
writeFileSync(join(ROOT, 'tools/live/out/hook-worklist.txt'), L.join('\n'), 'utf8');
console.log(L[0]);
console.log('отчёт: tools/live/out/hook-worklist.txt');
