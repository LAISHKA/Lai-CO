#!/usr/bin/env node
/* ============================================================
   tools/check-typos.mjs — автономный гейт опечаток и брака в текстах.

   Чем отличается от check-lookalike.mjs: тот ищет иероглифы и английское
   слово между двумя кириллическими словами. Этот ищет БЕЗЛИСТАЯ подмена
   букв (кириллица + латиница внутри одного слова — «рaзмер»), пробельный
   брак, кавычки, незакрытые теги, склейку слов в местах конкатенации
   строк и прочий механический брак.

   Тексты НЕ правит: только читает и печатает отчёт.

   Загрузка текстов:
     • cases/case-NN — данные дела грузятся тем же приёмом, что и в
       tools/validate.mjs (stub-окно + window.CASES), и обходятся рекурсией
       по всем полям. Так видно реальный склеенный текст ('правша.' +
       'Одиннадцатый' → 'правша.Одиннадцатый'), а не куски из исходника.
       Строка и файл находки находятся поиском фрагмента по файлам дела.
     • js/*.js — строковые литералы и комментарии (мини-сканер исходника).
     • *.md — построчный проход с пропуском ``` блоков и инлайнового `code`;
       перевод строки склеивается в абзац (чтобы видеть переносы посреди
       предложения), списки и таблицы остаются отдельными юнитами.
     • *.html — текст разметки (теги маскируются) + содержимое <script>/<style>.
     • *.css — комментарии и строки content:"…".

   Запуск:
     node tools/check-typos.mjs
     node tools/check-typos.mjs --paths cases/case-05,docs/PLAYBOOK.md
     node tools/check-typos.mjs --budget 20      # не больше 20 строк на код
     node tools/check-typos.mjs --budget 0       # только счётчики
     node tools/check-typos.mjs --json           # для машины

   Выход: 1, если есть хоть одна находка уровня error, иначе 0.
   Уровень error: mixed-alpha, mojibake, unbalanced-quotes, unclosed-inline.
   ============================================================ */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* ============================================================
   1. Коды проверок и уровни
   ============================================================ */
const SEVERITY = {
  'mixed-alpha': 'error',       // кириллица и латиница в одном слове
  'mojibake': 'error',           // битая кодировка
  'unbalanced-quotes': 'error',  // несовпавшиеся «»
  'unclosed-inline': 'error',    // незакрытый <b>/<i>/<span>…
  'double-space': 'warn',
  'space-before-punct': 'warn',
  'no-space-after': 'warn',
  'repeat-word': 'warn',
  'straight-quote': 'warn',      // кавычка-лапка " вместо «»
  'thin-space': 'warn',
  'dash': 'warn',
  'lower-after-dot': 'info'      // только INFO: строчная после «. »
};
const CODES = Object.keys(SEVERITY);

/* ============================================================
   2. Аргументы командной строки
   ============================================================ */
const argv = process.argv.slice(2);
let ONLY = null;          // --paths a,b
let BUDGET = Infinity;    // --budget N (0 = только счётчики)
let AS_JSON = false;
let GATE = false;         // --gate: только дела, и warn тоже валит прогон
let ALLOW_FILE = null;    // --allow <путь>, по умолчанию tools/typos-allowlist.txt
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--paths') ONLY = String(argv[++i] || '').split(',').map((x) => x.trim()).filter(Boolean);
  else if (a === '--budget') BUDGET = Number(argv[++i]);
  else if (a === '--json') AS_JSON = true;
  else if (a === '--gate') GATE = true;
  else if (a === '--allow') ALLOW_FILE = String(argv[++i] || '');
  else if (!a.startsWith('--')) ONLY = ONLY || [a];
  else { console.log(`неизвестный ключ: ${a}`); process.exit(2); }
}
if (!Number.isFinite(BUDGET)) BUDGET = Infinity;

/* --gate — режим девятго гейта: проверяем только тексты дел (то, что читает
   игрок), и роняем прогон уже на warn. Отчётовый режим (без флага) смотрит весь
   репозиторий и падает только на error, потому что в исходниках js разметка
   нарочно разрезана по литералам конкатенации. */
if (GATE && !ONLY) ONLY = ['cases'];

/* Allowlist заведомо ложных срабатываний:
     code<TAB>файл<TAB>подстрока пути поля<TAB>причина
   Ключ структурный (путь поля в данных дела), а не номер строки, — правка
   соседних строк его не съезжает. */
const ALLOW = [];
{
  const p = ALLOW_FILE ? resolve(ROOT, ALLOW_FILE) : join(HERE, 'typos-allowlist.txt');
  if (existsSync(p)) {
    readFileSync(p, 'utf8').split(/\r?\n/).forEach((L) => {
      const s = L.trim();
      if (!s || s.startsWith('#')) return;
      const [code, file, where = '', why = ''] = L.split('\t');
      if (code && file) ALLOW.push({ code: code.trim(), file: file.trim(), where: (where || '').trim(), why: (why || '').trim() });
    });
  }
}
const allowedBy = (r) => ALLOW.find((a) => a.code === r.code && a.file === r.file &&
  (!a.where || String(r.where || '').includes(a.where)));

/* ============================================================
   3. Обход файлов
   ============================================================ */
const SELF = 'tools' + sep + 'check-typos.mjs';

function walk(abs, out) {
  let st;
  try { st = statSync(abs); } catch { return out; }
  if (st.isDirectory()) { readdirSync(abs).forEach((f) => walk(join(abs, f), out)); return out; }
  out.push(abs);
  return out;
}
const rel = (p) => relative(ROOT, p).split(sep).join('/');

/* Что обходим по умолчанию (по постановке задачи). */
const DEFAULT_ROOTS = [
  'cases',            // *.js
  'js',               // *.js
  'assets/styles.css',
  'corp_game.html',
  'Lai_CO.html',
  'docs',             // *.md
  'biz',              // **.md
  'README.md',
  'AGENTS.md',
  'outreach'          // *.md
];
const WANTED_EXT = { '.js': 1, '.md': 1, '.css': 1, '.html': 1 };

function wanted(absPath) {
  const r = rel(absPath);
  if (r === SELF) return false;
  const e = extname(r).toLowerCase();
  if (!WANTED_EXT[e]) return false;
  if (r.startsWith('backup/') || r.startsWith('dist/') || r.startsWith('node_modules/') ||
      r.startsWith('cases-wip/') || r.startsWith('briefs/') || r.startsWith('tools/live/')) return false;
  if (e === '.js') return r.startsWith('cases/') || r.startsWith('js/');
  return true;
}

let fileList = [];
if (ONLY) {
  ONLY.forEach((p) => walk(resolve(ROOT, p), fileList));
  fileList = fileList.filter(wanted);
} else {
  DEFAULT_ROOTS.forEach((p) => walk(resolve(ROOT, p), fileList));
  fileList = fileList.filter(wanted);
}
fileList = [...new Set(fileList)].sort();

/* groups: case-NN | js | html | css | docs | biz | outreach | root */
function groupOf(r) {
  const m = /^cases\/(case-\d+)\//.exec(r);
  if (m) return m[1];
  if (r.startsWith('js/')) return 'js';
  if (r.endsWith('.html')) return 'html';
  if (r.endsWith('.css')) return 'css';
  if (r.startsWith('docs/')) return 'docs';
  if (r.startsWith('biz/')) return 'biz';
  if (r.startsWith('outreach/')) return 'outreach';
  return 'корень';
}

/* ============================================================
   4. Юнит = кусок текста, над которым делаются проверки.
      plain/tagged сохраняют ДОЛГИНУ raw: всё «инертное» затирается
      знаком ░, поэтому смещение находки == смещение в исходнике.
   ============================================================ */
const FILL = '░';
const CY = '\u0400-\u04FF';
const LA = 'A-Za-z';
const ALNUM = `${LA}${CY}0-9`;
const WORDCH = `${LA}${CY}\u00C0-\u00FF`;
const isCyr = (ch) => !!ch && ch >= '\u0400' && ch <= '\u04FF';
const isLat = (ch) => !!ch && /[A-Za-z]/.test(ch);
const isAlnum = (ch) => !!ch && new RegExp(`[${ALNUM}]`).test(ch);

const ENTITIES = {
  nbsp: '\u00A0', thinp: '\u2009', thinsp: '\u2009', numsp: '\u2007',ensp: '\u2002', emsp: '\u2003',
  mdash: '\u2014', ndash: '\u2013', dash: '\u2014', hellip: '\u2026', middot: '\u00B7', bull: '\u2022',
  laquo: '\u00AB', raquo: '\u00BB', ldquo: '\u201C', rdquo: '\u201D', bdquo: '\u201E', sbquo: '\u2018',
  lsquo: '\u2018', rsquo: '\u2019', quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp2: '\u00A0',
  copy: '\u00A9', reg: '\u00AE', trade: '\u2122', deg: '\u00B0', plusmn: '\u00B1', times: '\u00D7',
  divide: '\u00F7', frac12: '\u00BD', sup2: '\u00B2', sup3: '\u00B3', micro: '\u00B5', mill: '\u2030',
  euro: '\u20AC', pound: '\u00A3', yen: '\u00A5', sect: '\u00A7', para: '\u00B6', prime: '\u2032',
  Prime: '\u2033', larr: '\u2190', rarr: '\u2192', harr: '\u2194', ne: '\u2260', le: '\u2264',
  ge: '\u2265', alpha: '\u03B1', beta: '\u03B2', delta: '\u0394', Omega: '\u03A9', omega: '\u03C9'
};

const RE_MASK = [
  /* html-комментарии */ /<!--[\s\S]*?-->/g,
  /* инлайновый код в md */ /`[^`\n]+`/g,
  /* URL, почта, пути, файлы */ /(?:https?:\/\/|ftp:\/\/|www\.)[^\s"'<>«»[\]()░]+/gi,
  /(?:[\w.\-]+\/)+[\w.\-]+/g,
  /[\w\-]+\.(?:js|mjs|cjs|md|html|css|json|svg|png|jpe?g|zip|txt|ps1|xml|yml|yaml|ico|woff2?)\b/gi,
  /[\w.\-]+@[\w.\-]+\.[A-Za-z]{2,}/g,
  /* числа, время, даты, номера */ /\d+(?:[.,:]\d+)+/g,
  /№\s*\d[\d\-\/а-яё]*/gi
];

function fillSpan(arr, from, to) {
  for (let i = from; i < to && i < arr.length; i++) if (arr[i] !== '\n') arr[i] = FILL;
}
function maskRe(text, re) {
  const arr = text.split('');
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) fillSpan(arr, m.index, m.index + m[0].length);
  return arr.join('');
}

/* Сущности раскрываются на месте: символ + затёртая длина исходной ссылки. */
function decodeEntities(text) {
  const arr = text.split('');
  const re = /&([A-Za-z][A-Za-z0-9]{1,9}|#\d{1,5}|#x[0-9A-Fa-f]{1,4});/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1];
    let ch = null;
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code < 0x10FFFF) ch = String.fromCodePoint(code);
    } else if (Object.prototype.hasOwnProperty.call(ENTITIES, body)) ch = ENTITIES[body];
    const val = ch === null ? FILL : ch;
    arr[m.index] = val;
    for (let i = m.index + 1; i < m.index + m[0].length; i++) arr[i] = FILL;
  }
  return arr.join('');
}

const TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?>/g;

function makeUnit(o) {
  const raw = o.raw;
  let t = decodeEntities(raw);
  RE_MASK.forEach((re) => { t = maskRe(t, re); });
  const unit = Object.assign({}, o, { raw, tagged: t, plain: t.replace(TAG_RE, (m) => FILL.repeat(m.length)) });
  unit.cyr = new RegExp(`[${CY}]`).test(unit.plain);
  return unit;
}

/* Смещение → номер строки (для юнитов, собранных из строк файла). */
function lineAt(unit, off) {
  const b = unit.bounds;
  if (!b || !b.length) return unit.startLine || 0;
  let lo = 0, hi = b.length - 1, res = b[0].line;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid].start <= off) { res = b[mid].line; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

/* ============================================================
   5. Находки
   ============================================================ */
const findings = [];
function emit(unit, code, start, len, message) {
  findings.push({ unit, code, sev: SEVERITY[code], start, len, message });
}

function excerpt(unit, start, len) {
  const from = Math.max(0, start - 26);
  const to = Math.min(unit.raw.length, start + len + 26);
  const cut = (s) => s.replace(/[\s░]+/g, ' ').replace(/^ | $/g, '').trim();
  const frag = cut(unit.plain.slice(start, start + len)) || cut(unit.raw.slice(start, start + len));
  const ctx = (from > 0 ? '…' : '') + cut(unit.plain.slice(from, to)) + (to < unit.raw.length ? '…' : '');
  return { frag, ctx };
}

/* ============================================================
   6. Проверки
   ============================================================ */
/* 6.1 mixed-alpha — кириллица и латиница в одном слове. Дефис разделяет
       слова, поэтому «HTML-разметка» не считается. */
const WORD_RE = new RegExp(`[${WORDCH}][${WORDCH}0-9]*`, 'gu');
function checkMixedAlpha(u) {
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(u.plain))) {
    const w = m[0];
    let cy = 0, la = 0;
    for (const ch of w) { if (isCyr(ch)) cy++; else if (isLat(ch)) la++; }
    if (!cy || !la) continue;
    if (w.length < 2) continue;
    emit(u, 'mixed-alpha', m.index, w.length,
      `в одном слове ${cy} кириллич. + ${la} латин. (возможна подмена буквы)`);
  }
}

/* 6.2 double-space — два пробела внутри предложения. */
const DBL_RE = /[^\s░] {2,}[^\s░]/g;
function checkDoubleSpace(u) {
  if (u.skipSpacing) return;
  DBL_RE.lastIndex = 0;
  let m;
  while ((m = DBL_RE.exec(u.plain))) {
    const s = m[0].indexOf(' ');
    const n = m[0].trim().length;
    emit(u, 'double-space', m.index + s, n, `${n} пробела(ов) подряд внутри фразы`);
    DBL_RE.lastIndex = m.index + s + n;
  }
}

/* 6.3 space-before-punct — пробел перед . , : ; ! ? ) и после ( */
const BEFORE_PUNCT = /[ \u00A0\u2009]+([.,:;!?)])/g;
function checkSpaceBeforePunct(u) {
  if (u.skipSpacing) return;
  BEFORE_PUNCT.lastIndex = 0;
  let m;
  while ((m = BEFORE_PUNCT.exec(u.plain))) {
    if (m[0].trim() === ')' && /\)[ \u00A0]+$/.test(m[0])) { /* no-op */ }
    emit(u, 'space-before-punct', m.index, m[0].length, `пробел перед «${m[1]}»`);
  }
  const AFTER_OPEN = /([(][ \u00A0\u2009]+\S)/g;
  AFTER_OPEN.lastIndex = 0;
  while ((m = AFTER_OPEN.exec(u.plain))) {
    if (u.plain[m.index] !== '(' || /[░]/.test(u.plain.slice(m.index, m.index + 1))) continue;
    if (!/\S/.test(u.plain[m.index + 1])) continue;
    if (/\d/.test(u.plain[m.index + 1]) && !isCyr(u.plain[m.index + 2])) continue; // ( 5 ) — не наш случай
    emit(u, 'space-before-punct', m.index, m[1].length, 'пробел после «(»');
  }
}

/* 6.4 no-space-after — нет пробела после , ; : .  (кроме чисел, дат,
       времени, URL, файлов, инициалов и сокращений вида «т.д.»). */
const NOSPACE = new RegExp(`([,;:.])(?=[${ALNUM}])`, 'g');
function checkNoSpaceAfter(u) {
  if (u.skipSpacing) return;
  const t = u.plain;
  NOSPACE.lastIndex = 0;
  let m;
  while ((m = NOSPACE.exec(t))) {
    const p = m[1], i = m.index;
    const prev = t[i - 1], next = t[i + 1];
    if ((p === '.' || p === ',' || p === ':' || p === ';') && /[0-9]/.test(prev || '') && /[0-9]/.test(next || '')) continue;
    if (p === '.' && (t[i + 1] === '.' || t[i - 1] === '.')) continue;         // многоточие «...»
    if (p === '.' && t[i + 1] === ' ' ) continue;
    const tokenRe = new RegExp(`[^\\s░]*[${ALNUM}][^\\s░]*`, 'g');
    let tok = '', tokStart = i;
    tokenRe.lastIndex = 0;
    let tm;
    while ((tm = tokenRe.exec(t))) {
      if (tm.index <= i && tm.index + tm[0].length > i) { tok = tm[0]; tokStart = tm.index; break; }
      if (tm.index > i) break;
    }
    if (!new RegExp(`[${CY}]`).test(tok)) continue;                            // чисто технический токен
    if (p === '.') {
      let b = i, a = i + 1, nb = 0, na = 0;
      while (b - 1 >= tokStart && new RegExp(`[${WORDCH}]`).test(t[b - 1])) { b--; nb++; }
      while (a < tokStart + tok.length && new RegExp(`[${WORDCH}]`).test(t[a])) { a++; na++; }
      if (nb <= 3 && na <= 3) continue;                                        // т.д. / Е.Т. / п.5
    }
    emit(u, 'no-space-after', i, 2, `нет пробела после «${p}» (склеенный текст?)`);
  }
}

/* 6.5 repeat-word — одно и то же слово подряд. Реестр легальных повторов
       ниже; повторы на стыке предложений не считаются. */
const REPEAT_OK = new Set(['не не', 'да да', 'и и', 'но но', 'или или', 'либо либо',
  'как как', 'же же', 'то то', 'вот вот', 'тут тут', 'раз раз', 'мало-помалу',
  'ещё ещё', 'еще еще', 'сам сам', 'ни ни']);
const REPEAT_RE = new RegExp(`(^|[^\\s${WORDCH}])([${WORDCH}]+)([ \u00A0\u2009]+)\\2(?![${WORDCH}0-9])`, 'gu');
function checkRepeatWord(u) {
  REPEAT_RE.lastIndex = 0;
  let m;
  while ((m = REPEAT_RE.exec(u.plain))) {
    const w = m[2];
    if (!new RegExp(`[${CY}${LA}]`).test(w)) continue;
    if (w.length === 1 && !isCyr(w[0])) continue;
    const key = `${w.toLowerCase()} ${w.toLowerCase()}`;
    if (REPEAT_OK.has(key)) continue;
    const before = u.plain.slice(Math.max(0, m.index), m.index + m[0].length);
    if (/[.!?…]\s*$/.test(u.plain.slice(0, m.index + 1))) continue;             // начало нового предложения
    emit(u, 'repeat-word', m.index + m[1].length, m[0].length - m[1].length, `повтор слова «${w}»`);
    void before;
  }
}

/* 6.6 mojibake — следы битой кодировки. */
const MOJI_BIGRAM = new RegExp(`[\u00C2\u00C3\u00D0\u00D1][\u0080-\u00BF\u00C2-\u00F5\u0400-\u04FF]`, 'g');
const MOJI_SEQ = /(â€|Ã[\u0080-\u00BF]|Ð[\u0080-\u00BF]|Ñ[\u0080-\u00BF])/g;
function checkMojibake(u) {
  const t = u.plain;
  const seen = new Set();
  [[MOJI_BIGRAM, 'следы битой кодировки (UTF-8 как CP1251/Latin-1)'],
   [MOJI_SEQ, 'следы битой кодировки (â€-цепочка)']].forEach(([re, msg]) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      if (seen.has(m.index)) continue;
      seen.add(m.index);
      emit(u, 'mojibake', m.index, m[0].length, msg);
    }
  });
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\uFFFD') emit(u, 'mojibake', i, 1, 'символ замены U+FFFD (файл не UTF-8)');
  }
}

/* 6.7 unbalanced-quotes + straight-quote */
function checkQuotes(u) {
  const t = u.plain;
  const stack = [];
  let firstExtraClose = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '«') stack.push(i);
    else if (c === '»') { if (stack.length) stack.pop(); else if (firstExtraClose < 0) firstExtraClose = i; }
  }
  if (stack.length || firstExtraClose >= 0) {
    const open = (t.match(/«/g) || []).length, close = (t.match(/»/g) || []).length;
    const at = firstExtraClose >= 0 ? firstExtraClose : stack[0];
    emit(u, 'unbalanced-quotes', at, 1, `«» не сходятся: « — ${open}, » — ${close}`);
  }
  if (u.cyr) {
    const q = t.indexOf('"');
    if (q >= 0) {
      const n = (t.match(/"/g) || []).length;
      emit(u, 'straight-quote', q, 1, `кавычка-лапка " в русском тексте (${n}) — нужно «»`);
    }
  }
}

/* 6.8 unclosed-inline — незакрытые строчные теги внутри литерала/абзаца. */
const INLINE_TAGS = ['b', 'i', 'em', 'strong', 'span', 'u', 's', 'sup', 'sub'];
function checkInlineTags(u) {
  /* В исходниках js/html баланс тегов считать бессмысленно: движок собирает
     разметку конкатенацией, и `<b>' + text + '</b>` живёт в трёх разных
     литералах. 167 из 167 находок этого правила в js/ были именно таким шумом
     (проверено глазами, docs/QA-TYPOS.md §5). Проверяем только склеенный текст
     дел и HTML-разметку входных файлов — там строка уже полная. */
  if (/литерал js|комментарий js|литерал из <script>/.test(u.type || '')) return;
  const t = u.tagged;
  for (const tag of INLINE_TAGS) {
    const openRe = new RegExp(`<${tag}(\\s[^<>]*)?>`, 'gi');
    const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
    const opens = [...t.matchAll(openRe)].map((m) => m.index);
    const closes = [...t.matchAll(closeRe)].map((m) => m.index);
    if (opens.length === closes.length) {
      /* сравнить порядок: закрытие раньше открытия */
      let depth = 0, bad = -1;
      const ev = opens.map((p) => [p, 1]).concat(closes.map((p) => [p, -1])).sort((a, b) => a[0] - b[0]);
      for (const [p, d] of ev) { depth += d; if (depth < 0 && bad < 0) { bad = p; break; } }
      if (bad >= 0) emit(u, 'unclosed-inline', bad, 6, `</${tag}> без открывающего тега`);
      continue;
    }
    let at = opens.length > closes.length ? opens[opens.length - 1] : closes[0];
    /* точнее: первый незакрытый открывающий */
    if (opens.length > closes.length) {
      const st = [];
      const ev = opens.map((p) => [p, 1]).concat(closes.map((p) => [p, -1])).sort((a, b) => a[0] - b[0]);
      for (const [p, d] of ev) { if (d > 0) st.push(p); else st.pop(); }
      if (st.length) at = st[0];
    }
    emit(u, 'unclosed-inline', at, 7,
      `<${tag}> без пары: открыто ${opens.length}, закрыто ${closes.length}`);
  }
  const brBad = /<br(?![^<>]*>)/gi;
  let m;
  while ((m = brBad.exec(t))) emit(u, 'unclosed-inline', m.index, 3, '<br без закрывающей скобки >');
}

/* 6.9 lower-after-dot — INFO: обрыв предложения. Раньше класс символов брал и
       заглавные (\u0400-\u04FF), поэтому правило кричало на каждое «. Слово» в
       репозитории (7349 шт.) и было бесполезно. Здесь — настоящая строчная. */
const LOWER_AFTER = new RegExp(`(^|[^.${CY}${LA}0-9])([${CY}${LA}][${CY}${LA}]{1,})\\.([ \u00A0\u2009]+)([\u0430-\u044F\u0451][${CY}]*)`, 'gu');
function checkLowerAfterDot(u) {
  if (!u.cyr) return;
  LOWER_AFTER.lastIndex = 0;
  let m;
  while ((m = LOWER_AFTER.exec(u.plain))) {
    if (m[2].length === 1) continue;                       // инициал «Е. петров» — не наш случай
    if (/^(и|а|но|что|где|когда|как|если|то|он|она|оно|они|в|во|с|со|у|к|по|на|не|для|из|от|до|за|при|это|бы|же|ли|ну|да)$/.test(m[4])) {
      /* частотное продолжение — всё равно INFO, но без него отчёт тише не станет; оставляем */
    }
    emit(u, 'lower-after-dot', m.index + m[1].length, m[0].length - m[1].length,
      `после «${m[2]}. » строчная «${m[4]}» — возможен обрезанный текст`);
  }
}

/* 6.10 thin-space — неразрывный/узкий пробел вперемешку с обычным
        в одной и той же связке слов. */
const SPACE_PAIR = new RegExp(`([^\\s░]+)([ \u00A0\u2009\u202F])([^\\s░]+)`, 'gu');
function checkThinSpace(u) {
  const t = u.plain;
  if (!/[\u00A0\u2009\u202F]/.test(t)) return;
  const seen = new Map();
  SPACE_PAIR.lastIndex = 0;
  let m;
  while ((m = SPACE_PAIR.exec(t))) {
    const kind = m[2] === ' ' ? 'plain' : 'hard';
    const key = `${m[1].toLocaleLowerCase()}|${m[3].toLocaleLowerCase()}`;
    const prev = seen.get(key);
    if (prev && prev !== kind) {
      emit(u, 'thin-space', m.index + m[1].length, 1,
        `та же связка «${m[1]} ${m[3]}» набрана то обычным, то неразрывным/узким пробелом (U+${m[2].codePointAt(0).toString(16)})`);
      seen.set(key, 'done');
    } else if (!prev) seen.set(key, kind);
    SPACE_PAIR.lastIndex = m.index + m[1].length + 1;
  }
}

/* 6.11 dash — дефис вместо тире в конструкции «слово - слово». */
const DASH_RE = new RegExp(`([${CY}])[ \u00A0]+(-)[ \u00A0]+(?=[${CY}])`, 'gu');
function checkDash(u) {
  if (!u.cyr) return;
  DASH_RE.lastIndex = 0;
  let m;
  while ((m = DASH_RE.exec(u.plain))) {
    emit(u, 'dash', m.index + m[1].length, 3, 'дефис « - » вместо тире « — »');
  }
}

const CHECKS = {
  'mixed-alpha': checkMixedAlpha,
  'double-space': checkDoubleSpace,
  'space-before-punct': checkSpaceBeforePunct,
  'no-space-after': checkNoSpaceAfter,
  'repeat-word': checkRepeatWord,
  'mojibake': checkMojibake,
  'unbalanced-quotes': checkQuotes,
  'straight-quote': checkQuotes,
  'unclosed-inline': checkInlineTags,
  'lower-after-dot': checkLowerAfterDot,
  'thin-space': checkThinSpace,
  'dash': checkDash
};

function scanUnit(u) {
  const active = u.checks || CODES;
  const done = new Set();
  for (const code of active) {
    if (done.has(CHECKS[code])) continue;
    done.add(CHECKS[code]);
    CHECKS[code](u);
  }
}

/* ============================================================
   7. Читатели файлов → юниты
   ============================================================ */
function readText(abs) {
  const buf = readFileSync(abs);
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    /* BOM: смещение не сдвигаем, но отмечаем в отчёте */
    bomFiles.push(rel(abs));
  }
  return buf.toString('utf8');
}
const bomFiles = [];

const LINE_SPLIT = /\r?\n/;

/* --- 7.1 markdown --- */
function mdUnits(abs) {
  const r = rel(abs);
  const lines = readText(abs).split(LINE_SPLIT);
  const units = [];
  let cur = null, fence = false;
  const flush = () => { cur = null; };
  const push = (arr, type, extra) => {
    const parts = [];
    const bounds = [];
    let off = 0;
    arr.forEach(([lineNo, text]) => {
      const trimmed = text.replace(/^\s+/, '');
      const lead = text.length - trimmed.length;
      const body = trimmed.replace(/\s+$/, '');
      if (!parts.length) { bounds.push({ start: 0, line: lineNo }); void lead; }
      else bounds.push({ start: off + 1, line: lineNo });
      parts.push(body);
      off += body.length + 1;
    });
    units.push(makeUnit(Object.assign({
      file: r, group: groupOf(r), raw: parts.join(' '), bounds, type
    }, extra || {})));
  };
  let para = [];
  const closePara = () => { if (para.length) { push(para, 'проза'); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { closePara(); fence = !fence; continue; }
    if (fence) continue;
    if (!line.trim()) { closePara(); continue; }
    if (/^\s*\|/.test(line)) { closePara(); push([[i + 1, line]], 'таблица', { skipSpacing: true }); continue; }
    if (/^(#{1,6}\s|>\s?)/.test(line) || /^\s*(?:[-*+•]\s|\d+[.)]\s)/.test(line) && !/^\s{2,}\S/.test(line)) {
      closePara(); push([[i + 1, line]], 'маркер'); continue;
    }
    if (cur === null && para.length === 0) { /* noop */ }
    para.push([i + 1, line]);
    cur = 1;
    if (/^\s{2,}\S/.test(line)) continue;
  }
  closePara();
  void flush;
  return units;
}

/* --- 7.2 css: комментарии и строки --- */
function cssUnits(abs) {
  const r = rel(abs);
  const src = readText(abs);
  const lines = src.split(LINE_SPLIT);
  const units = [];
  const add = (raw, lineNo, type) => units.push(makeUnit({
    file: r, group: groupOf(r), raw, bounds: [{ start: 0, line: lineNo }], startLine: lineNo, type
  }));
  let inComment = false, buf = [], startLine = 0;
  lines.forEach((line, i) => {
    let s = line;
    if (inComment) {
      const e = s.indexOf('*/');
      if (e < 0) { buf.push(s); return; }
      buf.push(s.slice(0, e)); inComment = false;
      const txt = buf.join(' ');
      if (/[^\s.*\-–—]/.test(txt)) add(txt, startLine, 'комментарий');
      buf = [];
      s = s.slice(e + 2);
    }
    const gre = /\/\*[\s\S]*?\*\//g;
    let m;
    while ((m = gre.exec(s))) {
      const txt = m[0].replace(/^\/\*/, '').replace(/\*\/$/, '');
      if (txt.indexOf('*/') < 0 && !txt.includes('/*')) add(txt, i + 1, 'комментарий');
    }
    const sre = /content\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gi;
    while ((m = sre.exec(s))) add(m[1].slice(1, -1).replace(/\\([^\n])/g, '$1'), i + 1, 'строка content');
    const rest = s.replace(gre, ' ');
    if (/\s\/\*[^*]*$/.test(rest) || /\/\*[^*]*$/.test(s)) { inComment = true; startLine = i + 1; buf = [s.slice(s.indexOf('/*') + 2)]; }
  });
  return units;
}

/* --- 7.3 js: мини-сканер литералов и комментариев --- */
function jsLiterals(src) {
  const out = [];
  const n = src.length;
  let i = 0, prevSig = '';
  const isRegexOk = () => /[=(,:[!&|?{};+\-*%<>~^]/.test(prevSig) || prevSig === '';
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i); if (j < 0) j = n;
      out.push({ kind: 'comment', s: src.slice(i + 2, j), start: i + 2 });
      i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2); if (j < 0) j = n;
      out.push({ kind: 'comment', s: src.slice(i + 2, j), start: i + 2 });
      i = j + 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1, body = '';
      while (j < n) {
        if (src[j] === '\\') { body += src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === c) break;
        if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      const rawBody = src.slice(i + 1, j);
      out.push({ kind: c === '`' ? 'template' : 'string', s: rawBody, start: i + 1, quote: c });
      prevSig = c;
      i = j + 1; continue;
    }
    if (c === '/' && isRegexOk()) {
      let j = i + 1, cls = false, ok = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { ok = true; break; }
        else if (d === '\n') break;
        j++;
      }
      if (ok) { i = j + 1; prevSig = '/'; continue; }
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out;
}

function unescapeJs(s) {
  return s.replace(/\\u\{([0-9A-Fa-f]+)\}/g, (x, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (x, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\\t/g, ' ')
    .replace(/\\(['"`\\])/g, '$1').replace(/\\\n/g, ' ');
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
function lineOfOffset(starts, off) {
  let lo = 0, hi = starts.length - 1, res = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= off) { res = mid + 1; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

function jsFileUnits(abs) {
  const r = rel(abs);
  const src = readText(abs);
  const starts = lineIndex(src);
  const units = [];
  jsLiterals(src).forEach((lit) => {
    if (lit.kind === 'string') {
      /* конкатенация 'a' + 'b' видна здесь как два юнита; для js/*.js это
         допустимо, для дел есть загрузка через window.CASES */
      const txt = unescapeJs(lit.s);
      if (txt.trim().length < 3) return;
      units.push(makeUnit({
        file: r, group: groupOf(r), raw: txt.replace(/\n/g, ' '),
        bounds: [{ start: 0, line: lineOfOffset(starts, lit.start) }], type: 'литерал js'
      }));
    } else {
      const txt = lit.s;
      if (!/[А-Яа-яЁё]/.test(txt)) return;
      const lns = txt.split('\n');
      lns.forEach((one, k) => {
        const body = one.replace(/^\s*[/*]+\s?/, '').trim();
        if (body.replace(/[^А-Яа-яЁё]/g, '').length < 3) return;
        units.push(makeUnit({
          file: r, group: groupOf(r), raw: body,
          bounds: [{ start: 0, line: lineOfOffset(starts, lit.start) + k }], type: 'комментарий js'
        }));
      });
    }
  });
  return units;
}

/* --- 7.4 html: текст разметки + <script>/<style> --- */
function htmlUnits(abs) {
  const r = rel(abs);
  const src = readText(abs);
  const starts = lineIndex(src);
  const units = [];
  const lines = src.split(LINE_SPLIT);
  const scriptRanges = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) {
    if (/\ssrc\s*=/.test(m[0].slice(0, m[1].length ? m[0].indexOf('>') : m[0].length))) { /* тег с src — пустое тело */ }
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    const body = m[1];
    if (body.trim()) scriptRanges.push([bodyStart, bodyStart + body.length]);
  }
  const inScript = (a, b) => scriptRanges.some(([s, e]) => a < e && b > s);

  /* блоки текста вне <script> */
  let para = [];
  const flushBlock = () => {
    if (para.length) {
      const parts = [], bounds = [];
      let off = 0;
      para.forEach(([ln, text]) => {
        const t = text.replace(/^\s+/, '').replace(/\s+$/, '');
        bounds.push({ start: parts.length ? off + 1 : 0, line: ln });
        parts.push(t);
        off += t.length + 1;
      });
      units.push(makeUnit({
        file: r, group: 'html', raw: parts.join(' '), bounds, type: 'разметка html',
        checks: CODES.filter((c) => c !== 'unclosed-inline' && c !== 'double-space')
      }));
    }
    para = [];
  };
  let inComment = false;
  lines.forEach((line, i) => {
    const probe = line.replace(/&lt;/g, '');
    if (inComment) { if (probe.includes('-->')) inComment = false; return; }
    if (/<!--(?![\s\S]*-->)/.test(probe)) { flushBlock(); inComment = true; return; }
    const clean = line.replace(/<!--[\s\S]*?-->/g, ' ');
    const a = starts[i], b = a + line.length;
    if (inScript(a, b) || /<script|<style|<\/script|<\/style/i.test(clean)) { flushBlock(); return; }
    if (!clean.trim()) { flushBlock(); return; }
    para.push([i + 1, clean]);
  });
  flushBlock();

  /* содержимое <script> — как js */
  scriptRanges.forEach(([s, e]) => {
    const body = src.slice(s, e);
    const st = lineIndex(src.slice(0, s).join ? body : body);
    jsLiterals(body).forEach((lit) => {
      if (lit.kind === 'comment') return;
      const txt = unescapeJs(lit.s).replace(/\n/g, ' ');
      if (txt.trim().length < 3) return;
      units.push(makeUnit({
        file: r, group: 'html', raw: txt,
        bounds: [{ start: 0, line: lineOfOffset(st, lit.start) + lineOfOffset(starts, s) - 1 }], type: 'литерал из <script>'
      }));
    });
  });

  /* сквозной баланс инлайн-тегов по всей разметке (один отчёт на файл) */
  const markup = lines.map((line, i) => {
    const a = starts[i];
    if (inScript(a, a + line.length)) return '';
    return line;
  }).join('\n');
  units.push(makeUnit({
    file: r, group: 'html', raw: markup, bounds: [{ start: 0, line: 1 }],
    type: 'разметка html (баланс тегов)', checks: ['unclosed-inline']
  }));
  return units;
}

/* ============================================================
   8. Данные дел через stub-окно (как в tools/validate.mjs)
   ============================================================ */
const SKIP_ENGINE = ['js/20-app.js'];
const PAGES = ['corp_game.html', 'Lai_CO.html'];

function loadCases() {
  let html = '';
  const present = PAGES.filter((p) => existsSync(join(ROOT, p)));
  present.forEach((p) => { html += readFileSync(join(ROOT, p), 'utf8') + '\n'; });
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g;
  const win = {};
  win.localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  win.document = { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {} }), getElementById: () => null, addEventListener() {}, body: { appendChild() {} } };
  win.addEventListener = () => {};
  win.navigator = { userAgent: 'node' };
  const loaded = [];
  let m;
  const seen = new Set();
  while ((m = re.exec(html))) {
    const file = m[1];
    if (SKIP_ENGINE.includes(file) || seen.has(file)) continue;
    seen.add(file);
    const abs = join(ROOT, file);
    if (!existsSync(abs)) continue;
    const src = readFileSync(abs, 'utf8');
    try { new Function('window', src)(win); loaded.push(file); } catch (e) { loadErrors.push(`${file}: ${e.message}`); }
  }
  return { win, loaded };
}
const loadErrors = [];

/* файлы дела (для поиска строки) */
const caseFiles = {};
fileList.filter((f) => /^cases\/case-\d+\//.test(rel(f)) && f.endsWith('.js'))
  .forEach((f) => { const g = groupOf(rel(f)); (caseFiles[g] = caseFiles[g] || []).push(f); });

let caseUnits = 0;
const dataLinesCache = {};
function fileLines(abs) {
  const key = rel(abs);
  if (!dataLinesCache[key]) dataLinesCache[key] = readText(abs).split(LINE_SPLIT);
  return dataLinesCache[key];
}
function safeNeedle(s) {
  let out = s.replace(/['"`\\]+[\s\S]*$/, '');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > 34) out = out.slice(0, 34);
  return out.length >= 8 ? out : null;
}
function locateInCaseFiles(unit, off, len) {
  if (unit._loc) return unit._loc;
  const files = (caseFiles[unit.group] || []).concat(unit.dirFiles || []);
  const plain = unit.plain;
  const needles = [];
  needles.push(safeNeedle(plain.slice(off, off + Math.max(len, 12))));
  needles.push(safeNeedle(plain.slice(Math.max(0, off - 18), off + 6)));
  needles.push(safeNeedle(unit.raw.slice(0, 34)));
  const found = [];
  for (const nd of needles) {
    if (!nd) { found.push(null); continue; }
    let hit = null;
    for (const f of files) {
      const lines = fileLines(f);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(nd)) { hit = { file: rel(f), line: i + 1 }; break; }
      }
      if (hit) break;
    }
    found.push(hit);
    if (hit) break;
  }
  unit._loc = found.find(Boolean) || { file: (files[0] ? rel(files[0]) : `cases/${unit.group}/`), line: 0 };
  return unit._loc;
}

function walkValue(v, path, caseId, dirFiles, out) {
  if (typeof v === 'string') {
    if (v.replace(/[^А-Яа-яЁё]/g, '').length >= 1 || /[«»—]/.test(v)) {
      out.push(makeUnit({
        file: `cases/${caseId}/…`, group: caseId, caseId, dirFiles,
        raw: v.replace(/\n/g, ' '), bounds: null, type: `поле ${path}`
      }));
    }
    return;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => walkValue(x, `${path}[${i}]`, caseId, dirFiles, out)); return; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (typeof v[k] === 'function') continue;
      walkValue(v[k], path ? `${path}.${k}` : k, caseId, dirFiles, out);
    }
  }
}

/* ============================================================
   9. Сбор всех юнитов
   ============================================================ */
const units = [];
const dataAllowed = ONLY ? fileList.some((f) => /^cases\/case-\d+\//.test(rel(f))) : true;
if (dataAllowed) {
  const { win, loaded } = loadCases();
  const cases = win.CASES || [];
  cases.forEach((c) => {
    if (!c || !c.id) return;
    const g = groupOf(`cases/${c.id}/x.js`);
    const files = caseFiles[g] || [];
    if (ONLY && !files.some((f) => fileList.includes(f))) return;
    const u = [];
    walkValue(c, '', c.id, files, u);
    caseUnits += u.length;
    units.push(...u);
  });
}
fileList.forEach((abs) => {
  const r = rel(abs);
  if (/^cases\/case-\d+\//.test(r)) return;              // дела — через window.CASES
  if (r.endsWith('.md')) units.push(...mdUnits(abs));
  else if (r.endsWith('.css')) units.push(...cssUnits(abs));
  else if (r.endsWith('.html')) units.push(...htmlUnits(abs));
  else if (r.endsWith('.js')) units.push(...jsFileUnits(abs));
});

/* ============================================================
   10. Прогон проверок
   ============================================================ */
units.forEach(scanUnit);

/* ============================================================
   11. Материализация находок
   ============================================================ */
const rowsAll = findings.map((f) => {
  const u = f.unit;
  let file = u.file, line;
  if (u.caseId) {
    const loc = locateInCaseFiles(u, f.start, f.len);
    file = loc.file; line = loc.line;
  } else {
    line = lineAt(u, f.start);
  }
  const ex = excerpt(u, f.start, f.len);
  return {
    code: f.code,
    severity: f.sev,
    file,
    line,
    case: u.caseId || null,
    group: u.group,
    where: u.type || '',
    field: u.caseId ? (u.raw.length < 0 ? '' : '') : '',
    excerpt: ex.frag.slice(0, 70),
    context: ex.ctx.slice(0, 150),
    message: f.message
  };
}).sort((a, b) => (CODES.indexOf(a.code) - CODES.indexOf(b.code)) ||
  String(a.file).localeCompare(String(b.file)) || (a.line - b.line));

/* 11б. Allowlist: то, что разобрать глазами поручили заранее (docs/QA-TYPOS.md §5). */
const rows = rowsAll.filter((r) => !allowedBy(r));
const allowed = rowsAll.filter((r) => allowedBy(r));

const byCode = {};
CODES.forEach((c) => { byCode[c] = 0; });
rows.forEach((x) => { byCode[x.code]++; });
const byCase = {};
rows.forEach((x) => {
  const k = x.case || (x.group === 'case-корень' ? 'дела (вне папок)' : x.group);
  byCase[k] = (byCase[k] || 0) + 1;
});
const bySeverity = { error: 0, warn: 0, info: 0 };
rows.forEach((x) => { bySeverity[x.severity]++; });

/* ============================================================
   11в. glue-concat — стык конкатенации в ИСХОДНИКЕ дела.
        Данные грузятся уже склеенными, поэтому no-space-after видит
        «правша.Одиннадцатый», но не видит «пятьдесят», разорванное пополам, и
        вообще не знает номера строки. Это правило читает файлы дел как текст и
        ругается на `'…слово' +` / `'Слово…` без пробела на стыке. Ложных
        срабатываний нет: исключены переводы \n, дефисный перенос, инициали и №.
   ============================================================ */
const glue = [];
{
  const src = fileList.filter((f) => /^cases\/case-\d+\//.test(rel(f)) && f.endsWith('.js'));
  for (const abs of src) {
    const ls = readFileSync(abs, 'utf8').split(/\r?\n/);
    for (let i = 0; i + 1 < ls.length; i++) {
      const ma = /'((?:[^'\\]|\\.)*)'\s*\+\s*$/.exec(ls[i].replace(/\s+$/, ''));
      if (!ma) continue;
      const mb = /^\s*'((?:[^'\\]|\\.)*)/.exec(ls[i + 1]);
      if (!mb) continue;
      const left = ma[1], right = mb[1];
      if (!left || !right) continue;
      if (/\\[nrt]/.test(left.slice(-4)) || /\\[nrt]$/.test(left)) continue;   // намеренный абзац
      const lc = left[left.length - 1], fc = right[0];
      if (/\s/.test(lc)) continue;                                            // пробел есть
      if (!/[А-Яа-яЁёA-Za-z]/.test(fc)) continue;                             // дальше не слово
      if (/[-\u2013\u2014]$/.test(left)) continue;                            // дефисный перенос
      if (/[А-ЯЁ]\.$/.test(left) && /[А-ЯЁ]/.test(fc)) continue;              // «И.» + фамилия
      if (!/[А-Яа-яЁёA-Za-z0-9.,;:!?)\u00BB\u2026]/.test(lc)) continue;
      if (/№/.test(left)) continue;
      glue.push({
        file: rel(abs), line: i + 1,
        text: '…' + left.slice(-26) + ' ⃓ ' + right.slice(0, 26) + '…',
        kind: /[.,;:!?)\u00BB\u2026]/.test(lc) ? `на стыке нет пробела после «${lc}»` : 'слова склеены без разделителя'
      });
    }
  }
}

/* ============================================================
   12. Вывод
   ============================================================ */
const HEAD = 'код | файл:строка | фрагмент | что не так';

if (AS_JSON) {
  process.stdout.write(JSON.stringify({
    tool: 'check-typos',
    scannedFiles: fileList.length,
    scannedUnits: units.length,
    caseStrings: caseUnits,
    loadErrors,
    bomFiles,
    totals: Object.assign({ findings: rows.length }, bySeverity),
    byCode, byCase,
    findings: Number.isFinite(BUDGET) && BUDGET === 0 ? [] :
      (Number.isFinite(BUDGET) ? Object.keys(byCode).reduce((acc, c) => acc.concat(rows.filter((x) => x.code === c).slice(0, BUDGET)), []) : rows)
  }, null, 1) + '\n');
} else {
  console.log('Проверка текстов на опечатки и механический брак');
  console.log(`файлов: ${fileList.length} | текстовых юнитов: ${units.length} (строк из данных дел: ${caseUnits})`);
  if (loadErrors.length) { console.log('\n! не загрузилось:'); loadErrors.forEach((e) => console.log('  · ' + e)); }
  if (bomFiles.length) { console.log('\n! UTF-8 BOM в файлах:'); bomFiles.forEach((e) => console.log('  · ' + e)); }
  console.log('\nуровень error : ' + CODES.filter((c) => SEVERITY[c] === 'error').join(', '));
  console.log('уровень warn  : ' + CODES.filter((c) => SEVERITY[c] === 'warn').join(', '));
  console.log('уровень info  : ' + CODES.filter((c) => SEVERITY[c] === 'info').join(', '));
  for (const code of CODES) {
    const list = rows.filter((x) => x.code === code);
    if (!list.length) continue;
    console.log(`\n── ${code} [${SEVERITY[code]}] — ${list.length}`);
    console.log(HEAD);
    const shown = Number.isFinite(BUDGET) ? list.slice(0, BUDGET) : list;
    shown.forEach((x) => console.log(
      `${x.code} | ${x.file}:${x.line || '?'} | ${x.excerpt} | ${x.message} [${x.where}]`));
    if (list.length > shown.length) console.log(`  … ещё ${list.length - shown.length} (--budget N, --json)`);
  }
  if (glue.length) {
    console.log('\n── glue-concat [error] — ' + glue.length);
    console.log(HEAD);
    glue.forEach((g) => console.log(`glue-concat | ${g.file}:${g.line} | ${g.text} | ${g.kind} [стык конкатенации]`));
  }
  console.log('\n──────── счётчики по кодам ────────');
  CODES.forEach((c) => { if (byCode[c]) console.log(`${String(byCode[c]).padStart(6)}  ${c} [${SEVERITY[c]}]`); });
  console.log(`\nИТОГО: ${rows.length}  (error ${bySeverity.error} | warn ${bySeverity.warn} | info ${bySeverity.info})`);
  console.log('\n──────── счётчики по делам и разделам ────────');
  Object.keys(byCase).sort((a, b) => byCase[b] - byCase[a]).forEach((k) => {
    console.log(`${String(byCase[k]).padStart(6)}  ${k}`);
  });
  console.log(`\nНайдено строк: ${rows.length}. Порог выхода — ${GATE ? 'error + warn (режим --gate, только дела)' : 'уровень error'}.`);
  if (allowed.length) console.log(`в allowlist (ложные, не считаются): ${allowed.length} — ${ALLOW_FILE || 'tools/typos-allowlist.txt'}`);
}

const FAILS = (GATE ? bySeverity.error + bySeverity.warn : bySeverity.error) + glue.length;
if (glue.length) console.log(`\nglue-concat: ${glue.length} — чинить в исходнике дела (стык конкатенации), allowlist здесь не помогает`);
process.exit(FAILS ? 1 : 0);
