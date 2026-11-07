#!/usr/bin/env node
/* ============================================================
   tools/validate.mjs — проверка данных дел без браузера и без npm.

   Загрузка: читает index.html, берёт <script src="…"> по порядку
   (кроме движка js/20-app.js) и выполняет каждый файл в stub-объекте
   вместо window. Дальше — проверки целостности дела.

   Запуск:  node tools/validate.mjs
   ============================================================ */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const SKIP = ['js/20-app.js'];

const problems = [];
const warnings = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

/* ---------- загрузка ---------- */
function loadScripts() {
  const html = readFileSync(join(rootDir, 'index.html'), 'utf8');
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g;
  const win = {};
  win.localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  let m, count = 0;
  while ((m = re.exec(html))) {
    const rel = m[1];
    if (SKIP.includes(rel)) continue;
    const src = readFileSync(join(rootDir, rel), 'utf8');
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', src)(win);
      count++;
    } catch (e) {
      fail(rel, `файл не выполняется: ${e.message}`);
    }
  }
  return { win, count };
}

const { win, count } = loadScripts();
const cases = win.CASES || [];

/* ---------- проверки дела ---------- */
for (const c of cases) {
  const at = (id) => `дело ${c.id} / ${id}`;

  ['title', 'logline', 'briefing', 'persons', 'evidence', 'contradictions', 'objective', 'hints', 'reconstruction', 'crime']
    .forEach((k) => { if (!c[k]) fail(at(k), 'обязательное поле отсутствует'); });
  if (!Array.isArray(c.evidence) || !c.evidence.length) { console.log('— дело не загружено'); continue; }

  const evIds = new Set();
  const cats = [];
  for (const e of c.evidence) {
    const w = at(e.id || 'без id');
    if (!e.id) fail(w, 'улика без id');
    if (evIds.has(e.id)) fail(w, 'дубликат id улики');
    evIds.add(e.id);
    if (!e.cat) fail(w, 'нет cat (категория для фильтра)');
    else if (!cats.includes(e.cat)) cats.push(e.cat);
    if (!e.title) fail(w, 'нет title');
    if (!e.kind) fail(w, 'нет kind (тип рендера)');
    if (!e.doc) fail(w, 'нет doc — показывать нечего');
    if (e.at !== null && e.at !== undefined && !/^\d{1,2}:\d{2}$/.test(String(e.at)))
      warn(w, `поле at="${e.at}" не похоже на ЧЧ:ММ — таймлайн не отсортируется`);
    (e.tags || []).forEach((t) => {
      if (!c.persons.some((p) => p.id === t)) fail(w, `тег "${t}" не является id человека`);
    });
  }

  const persons = new Set(c.persons.map((p) => p.id));
  c.persons.forEach((p) => {
    if (!p.id || !p.name || !p.role || !p.bio) fail(at(p.id || 'person'), 'не заполнена карточка человека');
    if (!['victim', 'suspect', 'npc'].includes(p.kind)) fail(at(p.id), `kind="${p.kind}" — должно быть victim|suspect|npc`);
  });
  if (!c.persons.some((p) => p.kind === 'victim')) fail(at('persons'), 'нет потерпевшего');

  /* связи */
  const linkIds = new Set();
  const touched = new Map();
  for (const k of c.contradictions) {
    const w = at(k.id || 'связь');
    if (!k.id) fail(w, 'связь без id');
    if (linkIds.has(k.id)) fail(w, 'дубликат id связи');
    linkIds.add(k.id);
    for (const side of ['a', 'b']) {
      if (!k[side]) fail(w, `нет ссылки ${side}`);
      else if (!evIds.has(k[side])) fail(w, `${side}="${k[side]}" — такой улики нет`);
    }
    if (k.a && k.a === k.b) fail(w, 'a и b — одна и та же улика');
    if (!k.reveals || String(k.reveals).trim().length < 40) fail(w, 'reveals пустой или слишком короткий');
    [k.a, k.b].forEach((id) => touched.set(id, (touched.get(id) || 0) + 1));

    const ea = c.evidence.find((e) => e.id === k.a);
    const eb = c.evidence.find((e) => e.id === k.b);
    if (ea && eb) {
      const common = (ea.tags || []).filter((t) => (eb.tags || []).includes(t))
        .concat((ea.keys || []).filter((t) => (eb.keys || []).includes(t)));
      if (!common.length) warn(w, `у пары ${k.a}+${k.b} нет ни общих людей, ни общих следов (keys) — игрок не догадается, что их сравнивать`);
    }
    Object.keys(k.flags || {}).forEach((pid) => {
      if (!persons.has(pid)) fail(w, `flags: человека "${pid}" нет в составе`);
      if (!['watch', 'clear'].includes(k.flags[pid])) fail(w, `flags.${pid}="${k.flags[pid]}" — должно быть watch|clear`);
    });
  }

  /* изолированные улики */
  const isolated = c.evidence.filter((e) => !touched.has(e.id));
  if (isolated.length) warn(at('contradictions'), `улики без единой связи: ${isolated.map((e) => e.id).join(', ')} (фон или недосмотр)`);

  /* ---------- прогрессивное открытие материалов ----------
     Улика обязана приходить в дело по цепочке: поле after:[id…] — «после того
     как прочитана ЛЮБАЯ из перечисленных». Без after/afterLink — материал seed. */
  const linkIdSet = new Set(c.contradictions.map((k) => k.id));
  const seeds = c.evidence
    .filter((e) => !(e.after || []).length && !(e.afterLink || []).length)
    .map((e) => e.id);
  if (seeds.length < 5) fail(at('evidence'), `материалов с самого начала: ${seeds.length} — нужно 5–14`);
  if (seeds.length > 14) fail(at('evidence'), `материалов с самого начала: ${seeds.length} — дело вываливают на игрока целиком, разбейте на цепочки`);
  for (const e of c.evidence) {
    for (const key of ['after', 'afterLink']) {
      const req = e[key];
      if (req === undefined) continue;
      if (!Array.isArray(req)) { fail(at(e.id), `${key} должно быть массивом`); continue; }
      for (const r of req) {
        if (r === e.id) fail(at(e.id), `${key}: ссылка на саму себя`);
        else if (key === 'after' && !evIds.has(r)) fail(at(e.id), `after="${r}" — такой улики нет в деле`);
        else if (key === 'afterLink' && !linkIdSet.has(r)) fail(at(e.id), `afterLink="${r}" — такой связи нет в деле`);
      }
    }
  }
  /* имитируем игрока, который дочитывает всё доступное: так видны тупики */
  const openSet = new Set(seeds);
  const tierOf = {};
  seeds.forEach((id) => { tierOf[id] = 0; });
  let grew = true, round = 0;
  while (grew && round++ < 80) {
    grew = false;
    for (const e of c.evidence) {
      if (openSet.has(e.id)) continue;
      const byRead = (e.after || []).some((r) => openSet.has(r));
      const byLink = (e.afterLink || []).some((id) => {
        const k = c.contradictions.find((x) => x.id === id);
        return k && openSet.has(k.a) && openSet.has(k.b);
      });
      if (byRead || byLink) {
        openSet.add(e.id);
        tierOf[e.id] = 1 + Math.min(...(e.after || []).filter((r) => openSet.has(r)).map((r) => tierOf[r] ?? 0));
        grew = true;
      }
    }
  }
  const unreachable = c.evidence.filter((e) => !openSet.has(e.id)).map((e) => e.id);
  if (unreachable.length) fail(at('evidence'), `никогда не поступят в дело (нет пути от первых материалов): ${unreachable.join(', ')}`);
  const maxTier = Math.max(0, ...Object.values(tierOf));
  if (maxTier > 7) warn(at('evidence'), `цепочка открытия местами глубже 7 шагов (макс ${maxTier}) — есть риск, что игрок до материала не дойдёт`);

  /* ---------- запрет «выжимок» внутри улик ----------
     Документ не имеет права сам себе подводить итог и объяснять, что он значит
     для дела: это работа связей (reveals). Проверяем блоки body/note/cap.
     Живой голос человека (допрос, записка, чат) и цитаты — вне правила. */
  const VOICE_KINDS = new Set(['note', 'chat', 'talk']);
  const SUMMARY_MARKERS = [
    /^важно\b/i, /^важное\b/i, /^внимание[,:]/i, /^обратите внимание/i,
    /^ключев(ой|ое|ым|ые)\b/i, /^смысл\b/i, /^суть\b/i, /^совокупно/i,
    /^что отсюда/i, /^что это (значит|даёт|следует)/i, /^что следует из/i, /^что даёт\b/i,
    /^это (значит|означает)/i, /^значит,/i, /^теперь видно/i, /^вывод для следствия/i,
    /^таким образом,? это\b/i, /даёт (ей|ему|им)? ?(непрерывное|полное)? ?алиби/i,
    /^это и есть (улика|ответ)/i, /^именно поэтому\b.*(?:убий|подож|похит)/i
  ];
  const markerHit = (s) => SUMMARY_MARKERS.find((re) => re.test(String(s).replace(/<[^>]+>/g, '').trim()));
  for (const e of c.evidence) {
    if (VOICE_KINDS.has(e.kind) || !e.doc) continue;
    const blocks = Array.isArray(e.doc.body) ? e.doc.body : [];
    blocks.forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      const texts = [];
      if (b.p) texts.push(b.p);
      if (b.note) texts.push(b.note);
      if (b.h) texts.push(b.h);
      if (b.list) texts.push(...b.list);
      /* quote — чужие слова, их не проверяем */
      texts.forEach((t) => {
        const hit = markerHit(t);
        if (hit) fail(at(e.id), `блок body[${i}] пересказывает вывод улики (${hit}): документ не должен объяснять своё значение для дела`);
      });
    });
    for (const key of ['note', 'cap']) {
      if (!e.doc[key] || typeof e.doc[key] !== 'string') continue;
      const hit = markerHit(e.doc[key]);
      if (hit) fail(at(e.id), `поле ${key} начинается с подытоживания (${hit}) — перенесите мысль в связь`);
    }
  }

  /* форма сдачи */
  const fields = c.objective.fields || [];
  ['culprit', 'place', 'window', 'weapon', 'motive'].forEach((need) => {
    if (!fields.some((f) => f.id === need)) fail(at('objective'), `нет поля ${need}`);
  });
  for (const f of fields) {
    const w = at(`objective.${f.id}`);
    if (!f.label) fail(w, 'нет label');
    if (!f.options || f.options.length < 3) fail(w, 'мало вариантов ответа');
    const values = (f.options || []).map((o) => o[0]);
    if (new Set(values).size !== values.length) fail(w, 'дубли вариантов');
    if (!values.includes(f.correct)) fail(w, `correct="${f.correct}" нет в options`);
    (f.near || []).forEach((n) => { if (!values.includes(n)) fail(w, `near="${n}" нет в options`); });
    if (f.near && f.near.includes(f.correct)) fail(w, 'near совпадает с correct');
    if (!f.explain) fail(w, 'нет explain — вердикт будет без объяснения');
  }

  /* подсказки и реконструкция */
  if (!c.hints || c.hints.length < 3) fail(at('hints'), 'мало подсказок (минимум 3)');
  (c.hints || []).forEach((h, i) => { if (!h.title || !h.text) fail(at(`hints[${i}]`), 'пустая подсказка'); });
  if (!c.reconstruction || c.reconstruction.length < 3) fail(at('reconstruction'), 'реконструкция слишком короткая');
  if (!c.crime || !c.crime.at || !c.crime.until) fail(at('crime'), 'не задано окно смерти');

  /* виновник должен быть подсказан хотя бы одной связью «watch» */
  const culpritField = fields.find((f) => f.id === 'culprit');
  if (culpritField) {
    const cid = culpritField.correct;
    if (!persons.has(cid)) fail(at('objective.culprit'), 'correct ссылается на несуществующего человека');
    else {
      const any = c.contradictions.some((k) => k.flags && k.flags[cid]);
      if (!any) warn(at('contradictions'), 'виновник ни в одной связи не помечен флагом');
    }
    c.persons.filter((p) => p.kind === 'suspect').forEach((p) => {
      const marks = c.contradictions.filter((k) => k.flags && k.flags[p.id]);
      if (!marks.length) warn(at('contradictions'), `подозреваемый ${p.id} ни в одном выводе не участвует`);
      else if (p.id !== cid && !marks.some((k) => k.flags[p.id] === 'clear'))
        warn(at('contradictions'), `${p.id} — ложный след, но ни одна связь его не снимает`);
    });
  }

  /* картинка: img — это слот; файл может появиться позже, тогда просто подхватится */
  c.evidence.forEach((e) => {
    const img = e.doc && e.doc.img;
    if (img && !/^https?:/.test(img)) {
      try { readFileSync(resolve(rootDir, img)); }
      catch { warn(at(e.id), `файл ${img} ещё не на месте — в игре показывается описание кадра`); }
    }
  });

  console.log(`\nДело ${c.id} — «${c.title}»`);
  console.log(`  улик: ${c.evidence.length} | категорий: ${cats.join(', ')}`);
  console.log(`  связей: ${c.contradictions.length} | людей: ${c.persons.length} | подсказок: ${c.hints.length}`);
  const hist = {};
  c.evidence.forEach((e) => { const t = tierOf[e.id] ?? 0; hist[t] = (hist[t] || 0) + 1; });
  console.log(`  поступление материалов: ${Object.keys(hist).sort().map((t) => 'шаг ' + t + ': ' + hist[t]).join(' | ')}`);
  console.log(`  чтение улик: ${Math.round(c.evidence.reduce((a, e) => a + JSON.stringify(e.doc).length, 0) / 1000)}k знаков`);
}

/* ---------- итог ---------- */
console.log(`\nЗагружено скриптов: ${count}. Дел: ${cases.length}.`);
if (warnings.length) {
  console.log(`\n⚠ предупреждений: ${warnings.length}`);
  warnings.forEach((x) => console.log('  · ' + x));
}
if (problems.length) {
  console.log(`\n✕ ошибок: ${problems.length}`);
  problems.forEach((x) => console.log('  · ' + x));
  process.exit(1);
}
console.log('\nOK — данные целостны.');
