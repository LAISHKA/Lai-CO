#!/usr/bin/env node
/* ============================================================
   tools/check-hook.mjs — механика зацепок: доказательства на живых
   данных 20 дел.

   A. на старте открыты ровно корневые материалы;
   B. ПРОЧТЕНИЕ ВСЕХ доступных не открывает НИ ОДНОГО нового —
      зацепок нет, прогресса нет (былая жалоба игрока);
   C. ложное направление (категории, которой у предка нет) не открывает;
   D. ПОЛНЫЙ ПРОГОН идеальным игроком: цитата из корпуса -> направление
      -> новый материал -> связь -> повестка. После прогона обязаны быть
      прочитаны ВСЕ материалы, установлены ВСЕ лица и найдены ВСЕ связи;
   E. case-01: детерминированный путь e11 -> «Цифры» -> e16 -> повестка
      -> e22, и отказ на выдуманном направлении;
   F. безысходных материалов нет: их берёт автоклапан;
   G. revealAll открывает всё (клапан жив).

   Запуск:  node tools/check-hook.mjs
   ============================================================ */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const SKIP = ['js/20-app.js'];

const problems = [];
const info = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

/* ---------- загрузка дел (тот же приём, что в validate.mjs) ---------- */
function elStub() {
  return { className: '', textContent: '', innerHTML: '', appendChild() {}, setAttribute() {}, addEventListener() {}, style: {} };
}
function loadCases() {
  const html = ['corp_game.html', 'Lai_CO.html']
    .map((p) => readFileSync(join(rootDir, p), 'utf8')).join('\n');
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g;
  const seen = new Set();
  const win = {};
  win.localStorage = { _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  win.document = { createElement: elStub, createDocumentFragment: elStub, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, documentElement: { classList: { add() {}, remove() {} } }, head: elStub(), body: Object.assign(elStub(), { classList: { add() {}, remove() {} } }) };
  let m;
  while ((m = re.exec(html))) {
    if (SKIP.includes(m[1]) || seen.has(m[1])) continue;
    seen.add(m[1]);
    new Function('window', 'document', 'localStorage', readFileSync(join(rootDir, m[1]), 'utf8'))(win, win.document, win.localStorage);
  }
  if (!win.HOOKS) { console.error('HOOKS не загружен (js/15-hook-engine.js)'); process.exit(1); }
  return { CASES: win.CASES || [], H: win.HOOKS };
}
const { CASES, H } = loadCases();
if (!CASES.length) { console.error('дела не загружены'); process.exit(1); }

const fresh = () => ({ read: [], found: [], hooks: [], calls: [], suspects: {}, notes: '', hints: 0, clockMs: 0, revealAll: false, started: null, verdict: null });
const idsOf = (set) => Object.keys(set).sort();
const has = (list, id) => list.indexOf(id) >= 0;

/* ---------- «цитата игрока»: предложение из корпуса с указывающим словом ---------- */
function sentList(text) {
  return String(text).replace(/\s+/g, ' ').replace(/ \. /g, '. ').split(/(?<=[.!?])\s*/).map((s) => s.trim()).filter(Boolean);
}
function quoteFrom(text, dir) {
  const list = sentList(text);
  for (let i = 0; i < list.length; i++) {
    const sw = H.words(list[i]);
    const hit = Object.keys(dir.words).filter((w) => sw[w])[0];
    if (!hit) continue;
    let q = list[i];
    if (q.length < 12 && list[i + 1]) q += ' ' + list[i + 1];
    if (q.length < 12 && list[i - 1]) q = list[i - 1] + ' ' + q;
    if (q.length < 12) continue;
    return { quote: q, word: hit };
  }
  return null;
}

/* ---------- прогон дела идеальным игроком ---------- */
function solve(def) {
  const st = fresh();
  let round = 0;
  for (; round < 300; round++) {
    const sig = [st.read.length, st.found.length, st.hooks.length, st.calls.length].join('/');
    idsOf(H.availableSet(def, st)).forEach((id) => { if (!has(st.read, id)) st.read.push(id); });
    (def.contradictions || []).forEach((l) => {
      if (has(st.found, l.id)) return;
      if (has(st.read, l.a) && has(st.read, l.b)) st.found.push(l.id);
    });
    st.read.slice().forEach((pid) => {
      const pred = H.evidenceById(def, pid);
      if (!pred) return;
      H.pendingDirections(def, st, pid).forEach((d) => {
        if (H.hookOf(st, pid, d.cat)) return;
        const q = quoteFrom(H.ownText(def, pred), d);
        if (!q) return;
        if (H.judge(def, pid, d.cat, q.quote).ok) st.hooks.push({ ev: pid, quote: q.quote, dir: d.cat, ok: true, ts: round });
      });
    });
    H.summonsTargets(def, st).forEach((t) => st.calls.push({ pid: t.person.id, ts: round }));
    if (sig === [st.read.length, st.found.length, st.hooks.length, st.calls.length].join('/')) break;
  }
  return { st, rounds: round };
}

let totalRoots = 0, autoValveTotal = 0, hookTotal = 0, strandedAll = [];

for (const def of CASES) {
  const cs = def.id;
  const all = def.evidence;
  const roots = all.filter(H.isRoot).map((e) => e.id).sort();

  /* A: старт */
  let st = fresh();
  const atStart = idsOf(H.availableSet(def, st));
  if (atStart.join() !== roots.join()) {
    fail(cs, `на старте открыто ${atStart.length} при корнях ${roots.length}: лишние ${atStart.filter((i) => roots.indexOf(i) < 0).join(',') || '-'}`);
  }
  totalRoots += atStart.length;
  const startPersons = H.personOrder(def, st).map((p) => p.id);
  if (!def.persons.filter((p) => p.kind === 'victim').every((v) => has(startPersons, v.id))) fail(cs, 'на старте не видно потерпевшего');

  /* B: одно прочтение не даёт нового материала (кроме автоклапана) */
  st = fresh();
  atStart.forEach((id) => st.read.push(id));
  const readSet = {};
  st.read.forEach((id) => { readSet[id] = 1; });
  const leaked = idsOf(H.availableSet(def, st)).filter((id) => !has(atStart, id));
  let avCount = 0;
  leaked.forEach((id) => {
    const e = H.evidenceById(def, id);
    const allPredRead = (e.after || []).every((p) => readSet[p]);
    const canArgue = (e.after || []).some((p) => H.checkable(def, p, e.cat));
    if (allPredRead && !canArgue) avCount++;
    else fail(cs, `${id} открылся от одного прочтения (предки прочитаны: ${allPredRead}, можно обосновать: ${canArgue})`);
  });
  autoValveTotal += avCount;

  /* C: ложное направление */
  st = fresh();
  atStart.forEach((id) => st.read.push(id));
  const before = idsOf(H.availableSet(def, st));
  const predWithKids = roots.map((r) => H.evidenceById(def, r)).filter((e) => H.childrenOf(def, e.id).length)[0];
  if (predWithKids) {
    const fake = H.dummies(def, predWithKids.id, 1)[0];
    if (fake) {
      st.hooks.push({ ev: predWithKids.id, quote: 'фраза без адреса', dir: fake, ok: true, ts: 1 });
      if (idsOf(H.availableSet(def, st)).some((i) => !has(before, i))) fail(cs, `ложное направление «${fake}» открыло материал`);
    }
  }

  /* D+F: полный прогон */
  const solved = solve(def);
  st = solved.st;
  hookTotal += st.hooks.length;
  const unread = all.filter((e) => !has(st.read, e.id)).map((e) => `${e.id}(${e.cat})`);
  if (unread.length) fail(cs, `идеальный игрок не дошёл до ${unread.length}: ${unread.slice(0, 8).join(' ')}`);
  const unfound = (def.contradictions || []).filter((l) => !has(st.found, l.id)).map((l) => l.id);
  if (unfound.length) fail(cs, `противоречия не найдены: ${unfound.slice(0, 8).join(' ')}`);
  const seen = H.personOrder(def, st).map((p) => p.id);
  const mentioned = {};
  all.forEach((e) => (e.tags || []).forEach((t) => { mentioned[t] = 1; }));
  (def.contradictions || []).forEach((l) => Object.keys(l.flags || {}).forEach((t) => { mentioned[t] = 1; }));
  const stranded = def.persons.filter((p) => p.kind !== 'victim' && !mentioned[p.id] && !has(seen, p.id));
  strandedAll = strandedAll.concat(stranded.map((p) => `${cs}:${p.id}`));
  def.persons.forEach((p) => {
    if (has(seen, p.id) || stranded.indexOf(p) >= 0) return;
    fail(cs, `лицо ${p.id} (${p.kind}) не вышло на доску за весь прогон`);
  });
  if (solved.rounds >= 299) fail(cs, 'прогон не сошёлся за 300 раундов (цикл в правилах)');
  info.push(`${cs}: прочитано ${st.read.length}/${all.length}, зацепок ${st.hooks.length}, повесток ${st.calls.length}, связей ${st.found.length}/${(def.contradictions || []).length}, лиц ${seen.length}/${def.persons.length}, раундов ${solved.rounds + 1}`);

  /* G: revealAll */
  st = fresh();
  st.revealAll = true;
  if (idsOf(H.availableSet(def, st)).length !== all.length) fail(cs, 'revealAll не открыл всё');
}

/* E: case-01 детерминированно */
const c01 = CASES.find((c) => c.id === 'case-01');
if (!c01) fail('СВОДКА', 'нет case-01');
else {
  const pred = H.evidenceById(c01, 'e11');
  const dir = H.directions(c01, 'e11').filter((d) => d.cat === 'Цифры')[0];
  if (!dir || dir.ids.indexOf('e16') < 0) fail('case-01', 'у e11 нет направления «Цифры» с e16');
  else {
    const q = quoteFrom(H.ownText(c01, pred), dir);
    if (!q) fail('case-01', 'в корпусе e11 нет предложения со словом-указателем на «Цифры»');
    else {
      if (!H.judge(c01, 'e11', 'Цифры', q.quote).ok) fail('case-01', `цитата «${q.quote.slice(0, 50)}» не прошла судью`);
      info.push(`case-01: e11 -> «Цифры» по слову «${q.word}»: ${q.quote.slice(0, 64)}`);
      const st = fresh();
      st.read.push('e11');
      st.hooks.push({ ev: 'e11', quote: q.quote, dir: 'Цифры', ok: true, ts: 1 });
      if (!H.availableSet(c01, st).e16) fail('case-01', 'e16 не открылась по зацепке');
      if (H.judge(c01, 'e11', 'Допросы', q.quote).ok) fail('case-01', 'выдуманное для e11 направление «Допросы» прошло');
      /* e16 прочитана -> зацепка в «Допросы» выводит на khairullin ->
         протокол e22 приходит только по повестке */
      st.read.push('e16');
      const d2 = H.directions(c01, 'e16').filter((d) => d.cat === 'Допросы')[0];
      if (!d2 || d2.ids.indexOf('e22') < 0) fail('case-01', 'у e16 нет направления «Допросы» с e22');
      else {
        const q2 = quoteFrom(H.ownText(c01, H.evidenceById(c01, 'e16')), d2);
        if (!q2) fail('case-01', 'в корпусе e16 нет слова-указателя на «Допросы»');
        else {
          st.hooks.push({ ev: 'e16', quote: q2.quote, dir: 'Допросы', ok: true, ts: 2 });
          if (H.availableSet(c01, st).e22) fail('case-01', 'протокол e22 пришёл без повестки');
          const tg = H.summonsTargets(c01, st).filter((t) => t.person.id === 'khairullin')[0];
          if (!tg) fail('case-01', 'после зацепки e16 -> Допросы нельзя вызвать khairullin');
          else if (tg.ids.indexOf('e22') < 0) fail('case-01', 'повестка khairullin не обещает протокол e22');
          else {
            st.calls.push({ pid: 'khairullin', ts: 3 });
            if (!H.availableSet(c01, st).e22) fail('case-01', 'повестка не открыла протокол e22');
          }
        }
      }
      /* без зацепки e16 не открывается: проверка жалобы */
      const st2 = fresh();
      c01.evidence.filter(H.isRoot).forEach((e) => st2.read.push(e.id));
      if (H.availableSet(c01, st2).e16) fail('case-01', 'e16 открылась без зацепки');
    }
  }
}

info.unshift(`автоклапан (материалов без словесного мостика): ${autoValveTotal}`);
info.unshift(`корневых на старте: ${totalRoots} (ожидалось 192)`);
info.unshift(`нигде не упомянутые лица: ${strandedAll.length} (${strandedAll.join(' ') || '—'})`);

if (totalRoots !== 192) fail('СВОДКА', `корневых ${totalRoots}, должно быть 192`);
if (autoValveTotal > 60) fail('СВОДКА', `слишком много автоклапанов: ${autoValveTotal}`);

if (problems.length) {
  console.log('ПРОБЛЕМЫ (' + problems.length + '):');
  problems.forEach((p) => console.log('  ! ' + p));
  info.forEach((p) => console.log('  . ' + p));
  process.exit(1);
}
console.log('механика зацепок: всё сходится');
info.forEach((p) => console.log('  · ' + p));
