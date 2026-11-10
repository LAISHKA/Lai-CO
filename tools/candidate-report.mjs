#!/usr/bin/env node
/* ============================================================
   tools/candidate-report.mjs — покрытие зацепок в цифрах (ОТЧЁТ, не гейт).

   СМЫСЛ. tools/check-hook.mjs отвечает на вопрос «дело проходит или нет».
   Этот тул отвечает на другой: КАК именно игроку придётся его проходить —
   сколько кнопок в окне ходатайства на каждый документ, сколько указывающих
   слов никуда не ведут, где направление открывается «от любой цитаты» и
   какой материал нельзя выбить ходатайством в принципе.

   ПО ЧЕМУ СЧИТАЕМ (важно). В заказах по механике фигурировали поля
   hook.directions[].patterns, contradictions[].keys, afterLink и функции
   normalizeText/hookMatch из js/20-app.js. В принятом движке их НЕТ:
   направления не хранятся в данных, а собираются на лету из after + cat +
   общих слов (js/15-hook-engine.js). Отчёт считает по реальной модели:
     «направление»    = HOOKS.directions(дело, предок) — категория детей
                        одного прочитанного материала;
     «паттерн»        = указывающее слово направления (его судья ищет в цитате:
                        HOOKS.words(корпус предка) ∩ адрес ребёнка);
     «id направления» = предок + ' → ' + категория, например e04 → Камеры;
     «текст evidence.doc» = напечатанный корпус материала (DOCS.render) — то,
                        что игрок видит в читалке;
     «добывается ходатайством» = HOOKS.checkable(дело, предок, категория ребёнка):
                        у направления есть хотя бы одно указывающее слово.
   Нормализация текста — как в заказе: lowercase, ё→е, всё, что не буква, не
   цифра и не «% , . : - /», становится пробелом, пробелы схлопываются;
   совпадение — поиск подстрокой.

   Запуск:  node tools/candidate-report.mjs        — всегда exit 0
   Результат: docs/QA-HOOK-COVERAGE.md
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const OUT = join(rootDir, 'docs', 'QA-HOOK-COVERAGE.md');
const REPORT_DATE = '10.11.2026';

/* окно-загрузка — как в validate.mjs: движок не трогаем */
const SKIP = ['js/20-app.js'];
const PAGES = ['corp_game.html', 'Lai_CO.html'];

const BROAD_LIMIT = 6;      // паттерн более чем в 6 корпусах дела = «широкий»
const SHORT_REVEALS = 40;   // «reveals короче 40 знаков» — порог из заказа
const MIN_BUTTONS = 3;      // «развилка угадывания»: порог настоящей развилки
const DECOYS = 2;           // ложных категорий, которые игра подмешивает всегда

/* ---------- загрузка дел (тот же приём, что в validate.mjs) ---------- */
function elStub() {
  return {
    className: '', textContent: '', innerHTML: '', appendChild() {},
    setAttribute() {}, addEventListener() {}, style: {}
  };
}

function loadCases() {
  const html = PAGES.map((p) => readFileSync(join(rootDir, p), 'utf8')).join('\n');
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g;
  const win = {};
  win.localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  win.document = {
    createElement: elStub, createDocumentFragment: elStub, querySelector: () => null,
    querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
    documentElement: { classList: { add() {}, remove() {} } },
    head: elStub(), body: Object.assign(elStub(), { classList: { add() {}, remove() {} } })
  };
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    const rel = m[1];
    if (SKIP.includes(rel) || seen.has(rel)) continue;
    seen.add(rel);
    new Function('window', 'document', 'localStorage', readFileSync(join(rootDir, rel), 'utf8'))(win, win.document, win.localStorage);
  }
  if (!win.HOOKS) throw new Error('HOOKS не загружен — нет js/15-hook-engine.js');
  if (!(win.CASES || []).length) throw new Error('дела не загрузились');
  return { CASES: win.CASES, H: win.HOOKS };
}

/* ---------- нормализация и текст корпуса ---------- */

/* ровно как в заказе: ё→е, не-буквенно-цифровое (кроме % , . : - /) в пробел */
function normText(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я%,.:\-/\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* собрать весь текст внутри doc — запасной путь, если рендер короткого нет */
function collectStrings(v, out, depth) {
  if (depth > 6 || v == null) return out;
  if (typeof v === 'string' || typeof v === 'number') { out.push(String(v)); return out; }
  if (Array.isArray(v)) { v.forEach((x) => collectStrings(x, out, depth + 1)); return out; }
  if (typeof v === 'object') Object.keys(v).forEach((k) => collectStrings(v[k], out, depth + 1));
  return out;
}

/* что игрок реально читает в материале: напечатанный корпус DOCS.render */
function printedText(H, def, e) {
  const vis = H.renderedText(def, e);
  if (vis && vis.length > 60) return vis;
  return collectStrings(e.doc, [], 0).join(' . ');
}

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const avg = (list) => (list.length ? Math.round((10 * list.reduce((a, x) => a + x, 0)) / list.length) / 10 : 0);
const uniq = (arr) => Array.from(new Set(arr));
const md = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');
const tick = (s) => '`' + md(s) + '`';

/* ---------- разбор одного дела ---------- */
function analyseCase(def, H) {
  const evidence = def.evidence || [];
  const links = def.contradictions || [];

  /* тексты всех материалов считаем один раз: на них и мёртвые, и широкие */
  const textById = new Map(evidence.map((e) => [e.id, normText(printedText(H, def, e))]));

  /* --- источники зацепок: материалы, у которых есть дети по after --- */
  const sources = evidence.filter((e) => H.childrenOf(def, e.id).length);

  /* направления: id = «предок → категория», паттерны = указывающие слова */
  const dirs = [];
  for (const s of sources) {
    for (const d of H.directions(def, s.id)) {
      const patterns = Object.keys(d.words);
      dirs.push({
        src: s.id,
        cat: d.cat,
        id: s.id + ' → ' + d.cat,
        patterns: patterns,
        /* настоящие направления те же, что и у игры (HOOKS.checkable): слово есть */
        live: patterns.length > 0,
        /* то же слово поиском подстрокой в корпусе самого основания */
        matchedHere: patterns.some((w) => textById.get(s.id).indexOf(w) >= 0)
      });
    }
  }

  /* --- паттерны: в скольких корпусах дела встречается каждое слово --- */
  const patterns = new Map(); // pattern -> {docs: [ids], dirs: [id]}
  for (const d of dirs) {
    for (const p of d.patterns) {
      if (!patterns.has(p)) {
        const docs = evidence.filter((e) => textById.get(e.id).indexOf(p) >= 0).map((e) => e.id);
        patterns.set(p, { docs: docs, dirs: [] });
      }
      patterns.get(p).dirs.push(d.id);
    }
  }
  const dead = [];   // не встречается ни в одном корпусе дела
  const broad = [];  // встречается больше чем в BROAD_LIMIT корпусов
  for (const [p, info] of patterns) {
    if (!info.docs.length) dead.push({ pattern: p, dirs: uniq(info.dirs) });
    else if (info.docs.length > BROAD_LIMIT) broad.push({ pattern: p, count: info.docs.length, dirs: uniq(info.dirs) });
  }
  dead.sort((a, b) => a.pattern.localeCompare(b.pattern, 'ru'));
  broad.sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern, 'ru'));

  /* --- ходатайства и «добываемость» цепочных материалов --- */
  /* найденная связь приносит материал, если он её правый край (st.found → open[l.b]) */
  const linkOpens = new Set(links.map((l) => l.b));
  const chain = [];
  for (const e of evidence) {
    const preds = (e.after || []).slice();
    if (!preds.length) continue;             // корень: лежит в папке с начала дела
    const byHook = preds.filter((p) => H.checkable(def, p, e.cat));
    const byLink = linkOpens.has(e.id);
    const bySummon = e.kind === 'talk';      // протокол — только повесткой
    const noAutovalve = e.autovalve === false;
    chain.push({
      id: e.id, title: e.title, cat: e.cat, kind: e.kind, preds: preds,
      byHook: byHook, byLink: byLink, bySummon: bySummon,
      /* «не добывается ходатайством»: ни одно основание не даёт слова-указателя */
      hookless: !byHook.length,
      /* «тупик»: ни ходатайства, ни связи, ни повестки, и автоклапан закрыт */
      deadEnd: !byHook.length && !byLink && !bySummon && noAutovalve
    });
  }

  /* --- развилка угадывания: сколько настоящих кнопок на один документ --- */
  const buttonsPerSource = sources.map((s) => dirs.filter((d) => d.src === s.id && d.live).length);
  /* шанс угадать направление наугад: настоящая кнопка против двух ложных */
  const blindChance = avg(buttonsPerSource.map((n) => (1000 * n) / (n + DECOYS) / 10));

  return {
    def: def,
    evidence: evidence,
    links: links,
    sources: sources,
    dirs: dirs,
    patterns: patterns,
    dead: dead,
    broad: broad,
    chain: chain,
    /* указывающее слово есть, но подстрокой в корпусе основания не находится */
    ghosts: dirs.filter((d) => d.live && !d.matchedHere),
    /* основание, по которому нельзя обосновать ни одно направление */
    silentSources: sources.filter((s) => !H.directions(def, s.id).some((d) => Object.keys(d.words).length)),
    buttonsPerSource: buttonsPerSource,
    avgButtons: avg(buttonsPerSource),
    blindChance: blindChance,
    manySources: buttonsPerSource.filter((n) => n >= MIN_BUTTONS).length,
    roots: evidence.filter((e) => !(e.after || []).length).length,
    rows: {
      ev: evidence.length,
      evKeys: evidence.filter((e) => (e.keys || []).length).length,
      links: links.length,
      linkKeys: links.filter((l) => (l.keys || []).length).length,
      shortReveals: links.filter((l) => String(l.reveals || '').trim().length < SHORT_REVEALS).length,
      sources: sources.length,
      dirs: dirs.length,
      patterns: patterns.size,
      dead: dead.length,
      broad: broad.length,
      hookless: chain.filter((c) => c.hookless).length,
      deadEnd: chain.filter((c) => c.deadEnd).length
    }
  };
}

/* ---------- печать отчёта ---------- */
function summaryHead() {
  return '| дело | материалов | …с keys | связей | …с keys | …reveals<40 | оснований | направлений | паттернов '
    + '| мёртвых | широких | без ходатайства | тупиков | ср. кнопок | ≥3 кнопок |\n'
    + '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
}

function summaryRow(r) {
  const k = r.rows;
  return '| ' + [
    md(r.def.id), k.ev, k.evKeys, k.links, k.linkKeys, k.shortReveals, k.sources, k.dirs, k.patterns,
    k.dead, k.broad, k.hookless, k.deadEnd, r.avgButtons, pct(r.manySources, r.sources.length) + '%'
  ].join(' | ') + ' |';
}

function bulletList(items, n, f) {
  const out = items.slice(0, n).map(f);
  if (items.length > n) out.push('- …и ещё ' + (items.length - n));
  return out;
}

function buildReport(reports) {
  const L = [];
  const sum = (f) => reports.reduce((a, r) => a + f(r), 0);
  const tot = {
    ev: sum((r) => r.rows.ev), evKeys: sum((r) => r.rows.evKeys),
    links: sum((r) => r.rows.links), linkKeys: sum((r) => r.rows.linkKeys),
    short: sum((r) => r.rows.shortReveals), sources: sum((r) => r.rows.sources),
    dirs: sum((r) => r.rows.dirs), patterns: sum((r) => r.rows.patterns),
    dead: sum((r) => r.rows.dead), broad: sum((r) => r.rows.broad),
    hookless: sum((r) => r.rows.hookless), deadEnd: sum((r) => r.rows.deadEnd),
    roots: sum((r) => r.roots), many: sum((r) => r.manySources),
    ghosts: sum((r) => r.ghosts.length), silent: sum((r) => r.silentSources.length)
  };
  const allButtons = reports.flatMap((r) => r.buttonsPerSource);
  const avgAll = avg(allButtons);
  /* шанс угадать направление наугад по всему проекту: свои кнопки против ложных */
  const blindAll = avg(allButtons.map((n) => (1000 * n) / (n + DECOYS) / 10));
  /* сколько всего направлений (с пустыми тоже) выпадает на одно основание */
  const avgDirs = avg(reports.flatMap((r) => r.sources.map((s) => r.dirs.filter((d) => d.src === s.id).length)));
  const chained = tot.ev - tot.roots;
  const silentList = reports.flatMap((r) => r.silentSources.map((s) => r.def.id + ':' + s.id));

  L.push('# Покрытие зацепок: цифры по всем делам');
  L.push('');
  L.push('Дата: ' + REPORT_DATE + '. Тулза: `tools/candidate-report.mjs` (запуск `node tools/candidate-report.mjs`).');
  L.push('');
  L.push('Это **отчёт, а не гейт**: ничего не ломает, всегда выходит с кодом 0.');
  L.push('Гейт по механике зацепок — `tools/check-hook.mjs`, целостность данных — `tools/validate.mjs`.');
  L.push('');

  L.push('## Как читать этот отчёт');
  L.push('');
  L.push('В принятых делах нет полей `hook.directions[].patterns`, `contradictions[].keys` и `afterLink`:');
  L.push('направления не лежат в данных, а собираются движком на лету (`js/15-hook-engine.js`) из `after`,');
  L.push('категорий детей и общих слов предка с адресом ребёнка. Поэтому в отчёте:');
  L.push('');
  L.push('- **направление** — пара «прочитанное основание → категория его детей», id вида `e04 → Камеры`;');
  L.push('- **паттерн** — указывающее слово направления: его судья ищет в выделенной цитате;');
  L.push('- **мёртвый паттерн** — слово направления, которого нет ни в одном напечатанном корпусе дела;');
  L.push('  направление на нём держится только памятью игрока, подтвердить его цитатой нельзя (в норме 0);');
  L.push('- **широкий паттерн** — слово более чем в ' + BROAD_LIMIT + ' корпусах дела: оно отличает направление');
  L.push('  сразу от многих бумаг, так что ходатайство проходит почти от любой цитаты основания;');
  L.push('- **без ходатайства** — материал с `after`, где ни одно основание не даёт слова-указателя: такую');
  L.push('  бумагу нельзя выбить ходатайством, она приходит автоклапаном (прочитал основания — поступила);');
  L.push('- **тупик** — то же самое, но с `autovalve: false`: автоклапан закрыт, материал не придёт');
  L.push('  никогда, кроме полной выемки. Таких обязано быть 0;');
  L.push('- **ср. кнопок** — среднее число настоящих направлений, которые игра покажет в окне ходатайства по');
  L.push('  документу-основанию (сверх них игра всегда подмешивает ' + DECOYS + ' ложные категории);');
  L.push('- **≥3 кнопок** — доля таких документов, где развилка уже настоящая и направление можно угадать.');
  L.push('');
  L.push('> Сноска про поиск. Заказ просил считать совпадение подстрокой; движок (`HOOKS.words`) сравнивает');
  L.push('> целые слова от 5 знаков и отбрасывает стоп-слова и голые числа. Подстрока — проверка более мягкая,');
  L.push('> поэтому «мёртвых» паттернов здесь не может быть больше, чем насчитал бы движок.');
  L.push('');

  L.push('## Итог по проекту');
  L.push('');
  L.push('- Дел в отчёте: ' + reports.length + ' — ' + reports.map((r) => r.def.id).join(', ') + '.');
  L.push('- Материалов всего: ' + tot.ev + ', из них с непустым `keys`: ' + tot.evKeys + ' (' + pct(tot.evKeys, tot.ev) + '%).');
  L.push('- Связей всего: ' + tot.links + ', из них с непустым `keys`: ' + tot.linkKeys + '; `reveals` короче '
    + SHORT_REVEALS + ' знаков: ' + tot.short + '.');
  L.push('- Материалов с самого начала (корни): ' + tot.roots + ', поступают по цепочке `after`: ' + chained + '.');
  L.push('- Документов, по которым можно подать ходатайство (есть дети): ' + tot.sources + '; направлений в них: '
    + tot.dirs + ' (в среднем ' + avgDirs + ' на документ).');
  L.push('- Уникальных указывающих слов (паттернов) по всем делам: ' + tot.patterns + ', в среднем '
    + (tot.dirs ? Math.round((10 * tot.patterns) / tot.dirs) / 10 : 0) + ' слова на направление.');
  L.push('- Мёртвых паттернов (не матчатся ни в одном корпусе): ' + tot.dead + '.');
  L.push('- Широких паттернов (более чем в ' + BROAD_LIMIT + ' корпусов): ' + tot.broad + ' — '
    + pct(tot.broad, tot.patterns) + '% всех паттернов.');
  L.push('- Направлений, чьё слово не находится подстрокой в корпусе самого основания: ' + tot.ghosts + '.');
  L.push('- Материалов, которые не добываются ходатайством (только автоклапан или связь): ' + tot.hookless
    + ' из ' + chained + ' цепочных (' + pct(tot.hookless, chained) + '%).');
  L.push('- Тупиков (`autovalve: false` и ни одного слова-указателя): ' + tot.deadEnd + '.');
  L.push('- Оснований, где не обосновать словами ни одно направление: ' + tot.silent + ' ('
    + pct(tot.silent, tot.sources) + '% оснований)' + (silentList.length ? ': ' + silentList.join(', ') : '') + '.');
  L.push('- Среднее число настоящих кнопок в окне ходатайства: ' + avgAll + ' (плюс ' + DECOYS
    + ' ложных); документов, где кнопок ' + MIN_BUTTONS + ' и больше: ' + tot.many + ' из ' + tot.sources + ' ('
    + pct(tot.many, tot.sources) + '%).');
  L.push('- Шанс угадать направление наугад (случайная кнопка без чтения текста): в среднем ' + blindAll + '%.');
  L.push('');

  L.push('## Сводная таблица по делам');
  L.push('');
  L.push(summaryHead());
  reports.forEach((r) => L.push(summaryRow(r)));
  L.push('');

  /* --- мёртвые паттерны --- */
  L.push('## Мёртвые паттерны');
  L.push('');
  const deadCases = reports.filter((r) => r.dead.length);
  if (!deadCases.length) {
    L.push('Нет ни в одном деле: каждое указывающее слово направления игрок видит в напечатанном тексте.');
  } else {
    for (const r of deadCases) {
      L.push('**' + r.def.id + '** — ' + r.dead.length + ':');
      L.push(...bulletList(r.dead, 20, (d) => '- ' + tick(d.pattern) + ' — направления: ' + d.dirs.map(tick).join(', ')));
      L.push('');
    }
  }
  L.push('');

  /* --- широкие паттерны --- */
  L.push('## Слишком широкие паттерны (более чем в ' + BROAD_LIMIT + ' корпусах)');
  L.push('');
  const broadCases = reports.filter((r) => r.broad.length);
  if (!broadCases.length) {
    L.push('Таких нет: каждое указывающее слово отличает не больше шести материалов дела.');
  } else {
    let n = 0;
    L.push('| дело | паттерн | документов | направления |');
    L.push('|---|---|---|---|');
    broadCases.forEach((r) => r.broad.forEach((b) => {
      n++;
      L.push('| ' + md(r.def.id) + ' | ' + tick(b.pattern) + ' | ' + b.count + ' | '
        + md(b.dirs.slice(0, 5).join(', ')) + (b.dirs.length > 5 ? ', …' : '') + ' |');
    }));
    L.push('');
    L.push('Всего строк: ' + n + '.');
  }
  L.push('');

  /* --- after-цепочка --- */
  L.push('## Материалы, которые нельзя добыть ходатайством');
  L.push('');
  const hookless = reports.flatMap((r) => r.chain.filter((c) => c.hookless).map((c) => Object.assign({ case: r.def.id }, c)));
  if (!hookless.length) {
    L.push('Каждый цепочный материал в каждом деле открывается ходатайством хотя бы по одному основанию.');
  } else {
    L.push('Всего таких материалов: ' + hookless.length + '. «Приходит всё равно» — за счёт чего дело не встаёт.');
    L.push('');
    L.push('| дело | материал | категория | основания (`after`) | приходит всё равно | статус |');
    L.push('|---|---|---|---|---|---|');
    hookless.forEach((c) => {
      const via = [];
      if (c.byLink) via.push('по найденной связи');
      if (c.bySummon) via.push('по повестке (протокол)');
      if (!c.noAutovalve) via.push('автоклапан: прочитал основания — поступил');
      L.push('| ' + md(c.case) + ' | ' + tick(c.id) + ' ' + md(c.title) + ' | ' + md(c.cat) + ' | '
        + md(c.preds.join(', ')) + ' | ' + md(via.join('; ') || 'никак') + ' | '
        + (c.deadEnd ? '**ТУПИК: не придёт**' : 'ок (отчёт)') + ' |');
    });
    L.push('');
    const deadEnds = hookless.filter((c) => c.deadEnd);
    if (deadEnds.length) {
      L.push('**Тупики, которые надо чинить (' + deadEnds.length + '):** '
        + deadEnds.map((c) => c.case + ':' + c.id + ' (' + c.cat + ', основания ' + c.preds.join(', ') + ')').join('; '));
    } else {
      L.push('Тупиков нет: ни один материал не заперт наглухо — автоклапан или найденная связь доносит его до дела.');
    }
  }
  L.push('');
  L.push('Основания без единого словесного направления (дети берутся автоклапаном): '
    + (silentList.length ? silentList.join(', ') : 'нет таких'));
  L.push('');

  /* --- развилка угадывания --- */
  L.push('## Развилка угадывания');
  L.push('');
  L.push('| дело | оснований | ср. кнопок | мин | макс | доля ≥3 | доля с 1 кнопкой | шанс угадать наугад |');
  L.push('|---|---|---|---|---|---|---|---|');
  reports.forEach((r) => {
    const b = r.buttonsPerSource;
    L.push('| ' + md(r.def.id) + ' | ' + r.sources.length + ' | ' + r.avgButtons + ' | '
      + (b.length ? Math.min(...b) : 0) + ' | ' + (b.length ? Math.max(...b) : 0) + ' | '
      + pct(r.manySources, r.sources.length) + '% | ' + pct(b.filter((x) => x <= 1).length, b.length) + '% | '
      + r.blindChance + '% |');
  });
  L.push('');
  L.push('В таблице считаются только настоящие направления. Ложных категорий игра подмешивает по ' + DECOYS
    + ' на каждое окно всегда, поэтому шанс угадать наугад считаем как «настоящие / (настоящие + ' + DECOYS
      + ')» и усредняем по документам: даже при одной настоящей кнопке он не выше 33,3%.');
  L.push('');

  /* --- вывод для игрока --- */
  L.push('## Что это значит для игрока');
  L.push('');
  const shareBroad = pct(tot.broad, tot.patterns);
  const shareHookless = pct(tot.hookless, chained);
  const s = [];
  s.push('В ' + reports.length + ' делах ' + tot.ev + ' материалов и ' + tot.links
    + ' связей, а ходатайство подаётся по ' + tot.sources + ' документам; настоящая кнопка в окне обычно одна'
    + ' (в среднем ' + avgAll + '), рядом игра кладёт ' + DECOYS + ' ложные, — наугад это ' + blindAll
    + '% угадываний на ' + (100 - Math.round(blindAll)) + '% отказов прокурора.');
  s.push(tot.dead
    ? 'Мёртвых паттернов ' + tot.dead + ': столько направлений висят на словах, которых игрок в корпусах не найдёт, и подтвердить их цитатой нельзя.'
    : 'Мёртвых паттернов нет: каждое направление опирается на слово, которое правда напечатано в тексте, так что кнопки, которую невозможно пройти, в делах не встречается.');
  s.push(tot.broad
    ? 'Широких паттернов ' + tot.broad + ' (' + shareBroad + '% всех слов): такое указывающее слово повторяется в десятках корпусов дела, поэтому направление по нему открывается почти от любой цитаты — здесь игрок угадывает категорию, а не вычитывает деталь.'
    : 'Широких паттернов нет: почти каждое указывающее слово отличает один-два материала, поэтому цитату приходится подбирать, а не угадывать.');
  s.push(tot.hookless
    ? 'Материалов, которые нельзя выбить ходатайством, ' + tot.hookless + ' (' + shareHookless
      + '% цепочных): они поступают сами, как только прочитаны основания, — это страховка от тупика, а не находка игрока.'
    : 'Любой цепочный материал добывается ходатайством: автоклапан не открывает за игрока ничего важного.');
  s.push(tot.deadEnd
    ? 'Тупиков ' + tot.deadEnd + ' — это сломанные дела: материал заперт и не поступит никогда, его надо чинить.'
    : 'Тупиков нет: даже без словесного мостика материал приходит автоклапаном или по найденной связи, поэтому дело проходимо целиком и без дорогой полной выемки.');
  L.push(...s.map((x) => '- ' + x));
  L.push('');

  /* --- методика --- */
  L.push('## Примечание о методике');
  L.push('');
  L.push('- Дела загружаются тем же способом, что и в `tools/validate.mjs`: `<script src>` из `corp_game.html` и');
  L.push('  `Lai_CO.html`, файлы выполняются в stub-окне; `js/20-app.js` не задействуется, данные дел не меняются.');
  L.push('- Направления и слова-указатели берёт сам движок (`window.HOOKS.directions`, `HOOKS.checkable`),');
  L.push('  а не пересчитаны по своей логике — иначе отчёт разошёлся бы с игрой.');
  L.push('- «Нельзя добыть ходатайством» считается по всем основаниям материала сразу: если хотя бы одно');
  L.push('  основание даёт слово-указатель, ходатайство существует и материал считаем добываемым.');
  L.push('- `revealAll` (полная выемка) не учитывается: она открывает всё и штатным ходом не является.');
  L.push('- Протоколы допросов (`kind: talk`) зацепкой не приходят: зацепка выводит лицо, бумагу даёт повестка;');
  L.push('  такие материалы помечены в таблице своим способом поступления.');
  L.push('');
  L.push('_Отчёт собран автоматически: `node tools/candidate-report.mjs`, ' + REPORT_DATE + '._');
  L.push('');
  return L.join('\n');
}

/* ---------- main: отчёт, поэтому всегда exit 0 ---------- */
try {
  const { CASES, H } = loadCases();
  const reports = CASES.map((def) => analyseCase(def, H));
  writeFileSync(OUT, buildReport(reports), 'utf8');
  console.log('written docs/QA-HOOK-COVERAGE.md; cases=' + reports.length);
} catch (e) {
  console.log('отчёт не собран: ' + e.message);
}
process.exitCode = 0;
