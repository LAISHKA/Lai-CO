#!/usr/bin/env node
/* ============================================================
   tools/status.mjs — сверка заказов бизнес-сессии (T1…T9) с кодом и dist/.

   Назначение: документы `biz/briefs/README.md` и `biz/STATE.md` пишутся людьми и
   устаревают за день. Этот файл отвечает на вопрос «что из заказанного реально
   работает» по факту репозитория, а не по памяти сессии.

   Запуск:  node tools/status.mjs
   Код возврата: 0 — всё закрытое подтвердилось; 1 — что-то заявлено закрытым,
   но в коде не подтвердилось (то есть документ врёт).
   ============================================================ */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/* ---------- загрузка дел (тот же приём, что в tools/validate.mjs) ---------- */
function loadCases() {
  const html = ['corp_game.html', 'Lai_CO.html'].map(read).join('\n');
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g;
  const win = {};
  win.localStorage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    const rel = m[1];
    if (rel === 'js/20-app.js' || seen.has(rel) || !existsSync(join(root, rel))) continue;
    seen.add(rel);
    try { new Function('window', read(rel))(win); } catch (e) { /* let validate.mjs complain */ }
  }
  return win.CASES || [];
}
const cases = loadCases();
const c21 = cases.find((c) => c.id === 'case-21') || null;
const docTextLen = (c) => c.evidence.reduce((a, e) => a + JSON.stringify(e.doc).length, 0);

/* ---------- разбор zip (STORE) без внешних зависимостей ---------- */
function zipEntries(path) {
  const buf = readFileSync(path);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    out.push({ name, size, data: buf.subarray(localOff + 30 + lNameLen + lExtraLen, localOff + 30 + lNameLen + lExtraLen + size) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const NEED = ['culprit', 'place', 'window', 'weapon', 'motive'];
const rows = [];
const row = (id, title, ok, evidence) => rows.push({ id, title, ok, evidence });
/* ok: true — закрыт и подтверждён; false — заявлен закрытым, но не подтвердился; null — не делается */

/* T1 — поля формы сдачи из конфигурации дела */
{
  const allHave = cases.length > 0 && cases.every((c) => {
    const f = (c.objective && c.objective.fields) || [];
    return NEED.every((id) => f.some((x) => x.id === id));
  });
  const appReads = /objective\.fields/.test(read('js/20-app.js'));
  const repReads = /objective\.fields/.test(read('js/30-report.js'));
  row('T1', 'форма сдачи из конфигурации дела', allHave && appReads && repReads,
    `дел с objective.fields: ${cases.filter((c) => (c.objective && c.objective.fields || []).length).length}/${cases.length}; читают: 20-app ${appReads}, 30-report ${repReads}`);
}

/* T2 — журнал отчёта */
{
  const src = existsSync(join(root, 'js/30-report.js')) ? read('js/30-report.js') : '';
  const api = /window\.REPORT\s*=|root\.REPORT\s*=/.test(src);
  const key = /sr\.journal\.v1/.test(src);
  row('T2', 'экспорт журнала решений + CSV', api && key,
    `js/30-report.js: REPORT ${api}, ключ sr.journal.v1 ${key}; живой регресс — tools/live/probe-report.cjs`);
}

/* T3 — бренд из конфига */
{
  const pages = ['corp_game.html', 'Lai_CO.html'].map(read).join('\n');
  const hardcoded = /class="brand-mark"/.test(pages) && /class="brand-sub"/.test(pages);
  const configurable = /brand(mark|title|sub)?\s*[:=]/.test(read('js/20-app.js')) || /window\.SR_BRAND/.test(pages);
  row('T3', 'название/логотип/цвет из конфига', hardcoded ? null : true,
    hardcoded
      ? `не сделано: brand-mark/brand-sub зашиты в оба входа; конфига бренда в коде нет (${configurable})`
      : 'конфиг бренда найден в коде');
}

/* T4 — короткий формат (закрыт заказом T7) */
row('T4', 'короткий формат 20–25 мин', c21 ? (c21.evidence.length <= 14 ? null : false) : false,
  c21 ? `отдельного короткого дела нет; дело № 21 = ${c21.evidence.length} материалов, паспорт ${c21.playtimeMin} мин — закрыто T7` : 'дело № 21 не загружено');

/* T5 — публичная сборка */
{
  const rep = read('js/30-report.js');
  const sw = /SR_PUBLIC/.test(rep) && /isPublic/.test(rep);
  const build = /--public/.test(read('tools/pack-demo.mjs'));
  row('T5', 'сборка public (без ФИО и отчёта)', sw && build,
    `переключатель в 30-report: ${sw}; флаг сборки --public: ${build} — закрыт вместе с T8`);
}

/* T6 — два входа, index.html удалён */
{
  const gone = !existsSync(join(root, 'index.html'));
  const corp = read('corp_game.html');
  const demo = read('Lai_CO.html');
  const corpHas21 = /src="cases\/case-21\//.test(corp);
  const demoOnly21 = (demo.match(/src="cases\/(case-\d+)\//g) || []).every((s) => s.includes('case-21'));
  row('T6', 'два входных файла, index.html удалён', gone && !corpHas21 && demoOnly21,
    `index.html удалён: ${gone}; corp_game: ${(corp.match(/src="cases\/case-\d+\//g) || []).length} тегов дел, дело 21 внутри: ${corpHas21}; Lai_CO только дело 21: ${demoOnly21}`);
}

/* T7 — сжатие дела № 21 */
{
  if (!c21) { row('T7', 'дело № 21 сжато', false, 'дело № 21 не загрузилось'); }
  else {
    const chars = docTextLen(c21);
    const ok = c21.evidence.length <= 14 && c21.contradictions.length <= 12 && chars < 15000;
    row('T7', 'дело № 21 сжато до 20–25 минут', ok,
      `материалов ${c21.evidence.length}, связей ${c21.contradictions.length}, людей ${c21.persons.length}, чтение улик ${chars} знаков (было 29 012), паспорт ${c21.playtimeMin} мин, рейтинг ${c21.rating}`);
  }
}

/* T8 — архив под Яндекс */
{
  const zp = join(root, 'dist', 'yandex.zip');
  if (!existsSync(zp)) {
    row('T8', 'dist/yandex.zip для Яндекс Игр', false, 'архива нет — node tools/pack-demo.mjs --cases case-21 --out dist/yandex.zip --name index.html --public --readme');
  } else {
    const es = zipEntries(zp);
    const index = es.find((e) => e.name === 'index.html');
    const body = index ? index.data.toString('utf8') : '';
    const badNames = es.filter((e) => !/^[\x21-\x7E]+$/.test(e.name)).length;
    const bytes = es.reduce((s, e) => s + e.size, 0);
    const links = index ? (body.match(/(?:href|src)="https?:\/\/[^"]*"/g) || []).filter((u) => !u.includes('w3.org')).length : -1;
    const ok = !!index && /window\.SR_PUBLIC = true/.test(body) && badNames === 0 && bytes <= 100000000 && links === 0;
    row('T8', 'dist/yandex.zip для Яндекс Игр', ok,
      `${es.length} записей, ${(statSync(zp).size / 1024).toFixed(0)} КБ; index.html в корне: ${!!index}; SR_PUBLIC в файле: ${/window\.SR_PUBLIC = true/.test(body)}; не-ASCII имён: ${badNames}; внешних ссылок: ${links}; в разархивированном виде ${bytes} байт (лимит 100 000 000)`);
  }
}

/* T9 — SDK и реклама: заказ ещё не открыт бизнес-сессией */
{
  const sdk = /yandex\.games|YaGames|GetGameSdk/i.test(['js/00-store.js', 'js/10-docs.js', 'js/15-hook-engine.js', 'js/20-app.js', 'js/30-report.js'].map(read).join(''));
  row('T9', 'SDK Яндекс Игр и реклама', null,
    `в коде SDK ${sdk ? 'ЕСТЬ' : 'нет — так и задумано'}; заказ откроют не раньше 4 чужих прохождений (biz/FACTS.md)`);
}

/* ---------- вывод ---------- */
const MARK = { yes: 'закрыт', no: 'НЕ ПОДТВ', todo: '—' };
let broken = 0;
for (const r of rows) {
  const st = r.ok === true ? MARK.yes : r.ok === false ? MARK.no : MARK.todo;
  if (r.ok === false) broken++;
  console.log(`${r.id}  [${st}]  ${r.title}`);
  console.log(`      ${r.evidence}`);
}
console.log(`\nЗаказов: ${rows.length}. Подтверждено закрытыми: ${rows.filter((r) => r.ok === true).length}. Не подтвердилось: ${broken}. Не открывается (пока): ${rows.filter((r) => r.ok === null).length}.`);
console.log(`Дел в репозитории: ${cases.length}.`);
if (broken) { console.log('Есть заказ, заявленный закрытым, но не подтверждённый кодом — см. строки [НЕ ПОДТВ].'); process.exit(1); }
