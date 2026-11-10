#!/usr/bin/env node
/* ============================================================
   tools/check-candidates.cjs — гейт подсветки кандидатов (заказ F1).

   Что проверяет (автономно, без npm, выход 0 = чисто / 1 = проблема):

   A. js/17-candidates.js НЕ заглядывает в «правду» дела: в исходнике
      нет обращений к contradictions, reveals, correct, crime, judge —
      то есть множество подсвеченных узлов не может зависеть от того,
      какая зацепка верная.

   B. Порядок загрузки: тег js/17-candidates.js стоит строго между
      js/15-hook-engine.js и js/20-app.js в ОБЕИХ входных страницах.

   C. Классы и словарь: CLASSES ровно шесть; каждое слово словаря лиц
      обязано стоять в persons[].short / persons[].name, каждое слово
      словаря мест — в evidence[].where или в тексте варианта ответа
      поля place. Правильность ответа нигде не используется.

   D. Независимость на живых данных 21 дела: для каждого дела
      сравниваем разметку (scan) нормального определения дела и
      «обезвреженного» — копия, из которой вырезаны contradictions,
      crime, hints, а у objective полей сняты верный ответ, близкие и
      explain. Наборы узлов обязаны совпасть знак в знак.

   E. Стиль: `.cand` описан в assets/styles.css и в @media print
      подчёркивание снято.

   INFO (не ошибка): по делу № 21 — сколько узлов каждого класса даёт
   разметка в каждом материале, чтобы видеть, не подсвечен ли весь текст.

   Запуск:  node tools/check-candidates.cjs > out.txt 2>&1
   (в PowerShell кириллицу в консоли ломает — вывод читают файлом)
   ============================================================ */
'use strict';

const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const pages = ['corp_game.html', 'Lai_CO.html'];
const problems = [];
const notes = [];
const bad = (where, msg) => problems.push(where + ': ' + msg);

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ---------- заглушка окна: те же скрипты, что в браузере ---------- */
function elStub() {
  return {
    className: '', textContent: '', innerHTML: '', style: {},
    appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {}
  };
}
function loadScripts() {
  const html = pages.map(read).join('\n');
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g;
  const win = {};
  win.localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  win.document = {
    createElement: elStub, createDocumentFragment: elStub, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    documentElement: { classList: { add() {}, remove() {} } },
    head: elStub(), body: elStub()
  };
  const order = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    const rel = m[1];
    if (rel === 'js/20-app.js' || seen.has(rel)) continue;
    seen.add(rel);
    order.push(rel);
    new Function('window', 'document', 'localStorage', read(rel))(win, win.document, win.localStorage);
  }
  return { win, order };
}

/* ---------- A. запрещённые обращения в исходнике модуля ---------- */
const SRC = 'js/17-candidates.js';
let src = '';
try {
  src = read(SRC);
} catch (e) {
  bad(SRC, 'файл не читается: ' + e.message);
}

const FORBIDDEN = [
  ['contradictions', /contradictions/],
  ['reveals', /reveals/],
  ['correct', /correct/],
  ['crime', /\bcrime\b/],
  ['judge', /\bjudge\b/]
];
if (src) {
  FORBIDDEN.forEach(([name, re]) => {
    const hits = [];
    src.split(/\r?\n/).forEach((line, i) => {
      if (re.test(line)) hits.push('строка ' + (i + 1));
    });
    if (hits.length) bad(SRC, 'обращение к «' + name + '» (' + hits.join(', ') + ') — подсветка не должна зависеть от правды дела');
  });
  ['mark', 'clear', 'CLASSES'].forEach((api) => {
    if (!new RegExp('\\b' + api + '\\b').test(src)) bad(SRC, 'нет публичного API ' + api);
  });
  if (!/function hasDom\(\)/.test(src)) bad(SRC, 'нет hasDom() — файл обязан грузиться без DOM');
  /* стиль движка: ES5-подобный синтаксис */
  if (/\b(let|const)\s+/.test(src)) bad(SRC, 'let/const в рантайм-файле движка');
  if (/=>/.test(src)) bad(SRC, 'стрелочная функция в рантайм-файле движка');
  if (/`/.test(src)) bad(SRC, 'шаблонный литерал в рантайм-файле движка');
}

/* ---------- B. порядок тегов на обеих страницах ---------- */
pages.forEach((p) => {
  let html = '';
  try { html = read(p); } catch (e) { bad(p, 'не читается: ' + e.message); return; }
  const tags = [...html.matchAll(/<script\s+[^>]*src="([^"]+)"/g)].map((x) => x[1]);
  const iHooks = tags.indexOf('js/15-hook-engine.js');
  const iCand = tags.indexOf(SRC);
  const iApp = tags.indexOf('js/20-app.js');
  if (iCand < 0) { bad(p, 'нет тега ' + SRC); return; }
  if (!(iHooks >= 0 && iApp >= 0)) { bad(p, 'не нашёл теги 15-hook-engine / 20-app'); return; }
  if (!(iHooks < iCand && iCand < iApp)) {
    bad(p, SRC + ' стоит не между 15-hook-engine и 20-app (порядок: ' + iHooks + ' < ' + iCand + ' < ' + iApp + ' не выполняется)');
  }
  const iDocs = tags.indexOf('js/10-docs.js');
  const iStore = tags.indexOf('js/00-store.js');
  const iRep = tags.indexOf('js/30-report.js');
  if (!(iStore >= 0 && iDocs >= 0 && iDocs < iHooks && iHooks < iCand && iCand < iRep && iRep < iApp)) {
    bad(p, 'цепочка 00-store -> дела -> 10-docs -> 15-hook-engine -> 17-candidates -> 30-report -> 20-app разорвана');
  }
});

/* ---------- C..D. живые данные ---------- */
const { win } = loadScripts();
const CAND = win.CANDIDATES;
const CASES = win.CASES || [];

if (!CAND) {
  bad(SRC, 'window.CANDIDATES не появился после загрузки файла');
} else if (!CASES.length) {
  bad('СВОДКА', 'дела не загрузились');
} else {
  const want = ['date', 'time', 'num', 'sum', 'person', 'place'];
  const got = (CAND.CLASSES || []).slice().sort();
  if (got.join() !== want.slice().sort().join()) {
    bad(SRC, 'CLASSES = [' + got.join(', ') + '], должно быть [' + want.join(', ') + ']');
  }

  /* текст материала так, как его видит читалка: теги = границы текстовых узлов */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', numero: '\u2116', trade: '\u2122', deg: '°', copy: '©', laquo: '«', raquo: '»', lsquo: '\u2018', rsquo: '\u2019', bull: '\u2022' };
  function uncode(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body) => {
      if (body[0] === '#') {
        const n = body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : all;
      }
      const k = body.toLowerCase();
      return ENT[k] !== undefined ? ENT[k] : ' ';
    });
  }
  function textChunks(html) {
    return uncode(String(html == null ? '' : html))
      .replace(/<script[\s\S]*?<\/script>/gi, '\u0000')
      .replace(/<style[\s\S]*?<\/style>/gi, '\u0000')
      .replace(/<[^>]*>/g, '\u0000')
      .split('\u0000')
      .map((t) => t.replace(/\r/g, ' '))
      .filter((t) => t.trim().length);
  }
  /* узлы материала: dict — словарь дела (его и проверяем), e — материал
     так, как его напечатал бы движок. Рендерим ВСЕГДА оригинальный e:
     сравнивать нужно словарь, а не верстку. */
  function nodesOf(dict, e) {
    let html = '';
    try { html = win.DOCS && win.DOCS.render ? win.DOCS.render(e) : ''; } catch (err) { html = ''; }
    if (!html) return { per: {}, hits: [], words: [], total: 0, chars: 0, hit: 0 };
    const per = { date: 0, time: 0, num: 0, sum: 0, person: 0, place: 0 };
    const hits = [];
    let chars = 0, hit = 0, part = 0;
    textChunks(html).forEach((chunk) => {
      part++;
      chars += chunk.length;
      CAND.scan(chunk, dict).forEach((n) => {
        per[n.t]++;
        hit += n.end - n.start;
        hits.push({ t: n.t, w: chunk.slice(n.start, n.end), at: part + ':' + n.start + '-' + n.end });
      });
    });
    return {
      per: per, hits: hits, total: hits.length, chars: chars, hit: hit,
      words: hits.map((h) => h.at + ' ' + h.t + '|' + h.w)
    };
  }

  /* «обезвреженное» определение: только открытые поля формы
     (лица без ролей и биографий, материалы без keys/пояснений,
     objective — одни варианты ответа) */
  function sanitize(def) {
    const c = JSON.parse(JSON.stringify(def));
    c.id = String(def.id) + '#anon';
    delete c.contradictions;
    delete c.crime;
    delete c.hints;
    delete c.reconstruction;
    delete c.verdict;
    c.persons = (c.persons || []).map((p) => ({ id: p.id, name: p.name, short: p.short }));
    c.evidence = (c.evidence || []).map((e) => ({ id: e.id, cat: e.cat, kind: e.kind, title: e.title, where: e.where }));
    if (c.objective) {
      c.objective.fields = (c.objective.fields || []).map((f) => ({ id: f.id, label: f.label, options: f.options }));
    }
    return c;
  }
  CASES.forEach((def) => {
    const dict = CAND.dictFor(def);
    if (!(dict.person || []).length) bad(def.id, 'словарь лиц пуст — persons[].short/name не читаются');
    if (!(dict.place || []).length) bad(def.id, 'словарь мест пуст — evidence[].where не читается');

    /* C. происхождение каждого слова словаря — только из открытых полей */
    const personSrc = (def.persons || []).map((p) => String(p.short || '') + ' ' + String(p.name || '')).join(' | ');
    dict.person.forEach((o) => {
      if (personSrc.indexOf(o.w) < 0) bad(def.id, 'слово лиц «' + o.w + '» не стоит в persons[].short / persons[].name');
    });
    const placeSrc = (def.evidence || []).map((e) => String(e.where || '')).join(' | ')
      + ' | ' + ((def.objective && def.objective.fields) || [])
        .filter((f) => String(f.id) === 'place')
        .map((f) => (f.options || []).map((o) => (o || []).join(' ')).join(' | ')).join(' | ');
    dict.place.forEach((o) => {
      if (placeSrc.indexOf(o.w) < 0) bad(def.id, 'слово мест «' + o.w + '» не стоит в evidence[].where или в вариантах поля place');
    });

    /* D. разметка не меняется, если забрать правду дела: сравниваем
       один и тот же напечатанный текст под обычным словарём и под
       словарём «обезвреженного» определения */
    const anon = sanitize(def);
    const dictAnon = CAND.dictFor(anon);
    let same = true, changed = 0, totalAll = 0;
    (def.evidence || []).forEach((e) => {
      const a = nodesOf(dict, e);
      const b = nodesOf(dictAnon, e);
      totalAll += a.total;
      const wa = a.words.join('§'), wb = b.words.join('§');
      if (wa !== wb) { same = false; changed++; }
    });
    if (!same) bad(def.id, 'узлы ' + changed + ' материалов меняются, если вырезать правду дела — подсветка зависит от служебных полей');
    if ((dict.person || []).length !== (dictAnon.person || []).length) bad(def.id, 'словарь лиц изменился после вырезания правды дела');
    if ((dict.place || []).length !== (dictAnon.place || []).length) bad(def.id, 'словарь мест изменился после вырезания правды дела');
    const caseTotal = totalAll;
    if (!caseTotal) bad(def.id, 'ни одного узла во всём деле — распознавание сломано');
  });
  notes.push('проверено дел на независимость подсветки: ' + CASES.length);

  /* ---------- INFO: дело № 21, узлы по каждому материалу ---------- */
  const c21 = CASES.filter((c) => c.id === 'case-21')[0];
  if (!c21) {
    notes.push('дела № 21 нет в реестре — таблица пропущена');
  } else {
    const head = ['материал', 'знаков', 'date', 'time', 'num', 'sum', 'person', 'place', 'всего', 'подв.'];
    const rows = [];
    const grand = { date: 0, time: 0, num: 0, sum: 0, person: 0, place: 0 };
    const tally = { date: {}, time: {}, num: {}, sum: {}, person: {}, place: {} };
    let sumChars = 0, sumHit = 0, sumTot = 0;
    const dict21 = CAND.dictFor(c21);
    (c21.evidence || []).forEach((e) => {
      const r = nodesOf(dict21, e);
      want.forEach((k) => {
        grand[k] += r.per[k] || 0;
        (r.hits || []).forEach((h) => {
          if (h.t !== k) return;
          tally[k][h.w] = (tally[k][h.w] || 0) + 1;
        });
      });
      sumChars += r.chars; sumHit += r.hit; sumTot += r.total;
      rows.push([
        e.id + ' ' + String(e.title).slice(0, 34),
        String(r.chars), String(r.per.date), String(r.per.time), String(r.per.num),
        String(r.per.sum), String(r.per.person), String(r.per.place), String(r.total),
        (r.chars ? Math.round(r.hit / r.chars * 100) : 0) + '%'
      ]);
    });
    const W = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cells) => cells
      .map((c, i) => (i === 0 ? c.padEnd(W[0]) : c.padStart(W[i])))
      .join(' | ');
    notes.push('');
    notes.push('INFO — дело № 21: узлов каждого класса в каждом материале');
    notes.push(line(head));
    rows.forEach((r) => notes.push(line(r)));
    notes.push(line(['ИТОГО', String(sumChars), String(grand.date), String(grand.time), String(grand.num),
      String(grand.sum), String(grand.person), String(grand.place), String(sumTot),
      (sumChars ? Math.round(sumHit / sumChars * 100) : 0) + '%']));
    notes.push('материалов: ' + rows.length + ' | узлов на материал: '
      + (rows.length ? (sumTot / rows.length).toFixed(1) : 0)
      + ' | подсвечено знаков: ' + (sumChars ? (sumHit / sumChars * 100).toFixed(1) : 0) + '%');
    /* INFO: сами узлы по классам (частые) — по ним видно шум и пробелы */
    const top = (k, n) => Object.keys(tally[k])
      .sort((a, b) => tally[k][b] - tally[k][a] || (a < b ? -1 : 1))
      .slice(0, n).map((w) => w + '×' + tally[k][w]).join(', ');
    notes.push('');
    notes.push('INFO — дело № 21: частые узлы по классам (значение × сколько раз)');
    want.forEach((k) => {
      notes.push('  ' + k.padEnd(6) + ' разных ' + Object.keys(tally[k]).length + ': ' + (top(k, 14) || '—'));
    });
    notes.push('  словарь мест (' + dict21.place.length + '): ' + dict21.place.map((o) => o.w).join(', '));
    notes.push('  словарь лиц (' + dict21.person.length + '): ' + dict21.person.map((o) => o.w).join(', '));
    if (sumChars && sumHit / sumChars > 0.35) {
      bad('СВОДКА', 'подсвечено ' + Math.round(sumHit / sumChars * 100) + '% знаков дела № 21 — подсветка съедает текст');
    }
  }
}

/* ---------- E. стили ---------- */
let css = '';
try { css = read('assets/styles.css'); } catch (e) { bad('assets/styles.css', 'не читается: ' + e.message); }
if (css) {
  if (!/\.cand\b/.test(css)) bad('assets/styles.css', 'нет описания .cand');
  else {
    const block = (css.match(/\.cand\s*\{[^}]*\}/) || [''])[0];
    if (!/text-decoration:\s*underline dotted/.test(block)) bad('assets/styles.css', '.cand без text-decoration: underline dotted');
    if (!/text-underline-offset/.test(block)) bad('assets/styles.css', '.cand без text-underline-offset');
    if (!/cursor:\s*text/.test(block)) bad('assets/styles.css', '.cand без cursor: text');
    if (/(padding|border-width|margin)\s*:/.test(block)) bad('assets/styles.css', '.cand трогает геометрию строки (padding/border/margin)');
    if (!/\.cand:hover|\.cand:focus/.test(css)) bad('assets/styles.css', 'нет реакции на наведение/фокус у .cand');
    const printBlocks = css.split('@media print').slice(1).join('@media print');
    if (!/\.cand\s*\{[^}]*text-decoration:\s*none/.test(printBlocks)) bad('assets/styles.css', 'в @media print у .cand не снято подчёркивание');
    if (!/html\[data-theme='dark'\]\s*\.cand|html\[data-theme="dark"\]\s*\.cand/.test(css)) bad('assets/styles.css', 'нет отдельного правила для тёмной темы');
    if (!/html\[data-theme='light'\]\s*\.cand|html\[data-theme="light"\]\s*\.cand/.test(css)) bad('assets/styles.css', 'нет отдельного правила для светлой темы');
  }
}

/* ---------- вывод ---------- */
if (problems.length) {
  console.log('ПРОБЛЕМЫ (' + problems.length + '):');
  problems.forEach((p) => console.log('  ! ' + p));
  notes.forEach((p) => console.log('  · ' + p));
  process.exit(1);
}
console.log('кандидаты: всё сходится');
notes.forEach((p) => console.log('  · ' + p));
process.exit(0);
