/* Карта поступления материалов дела: что открывается на каком шаге.
   Использование: node tools/map-case.mjs [case-04 ...]
   Без аргументов — все зарегистрированные дела.  */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = ['corp_game.html', 'Lai_CO.html']
  .map((p) => readFileSync(join(root, p), 'utf8')).join('\n');
const srcs = [...new Set([...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]))];

const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
for (const s of srcs) {
  if (/20-app\.js|10-docs\.js/.test(s)) continue;
  new Function('window', readFileSync(join(root, s), 'utf8'))(win);
}
const BY_ID = {};
(win.CASES || []).forEach((c) => { BY_ID[c.id] = c; });

const want = process.argv.slice(2);
const ids = (want.length ? want : Object.keys(BY_ID)).filter((id) => {
  if (BY_ID[id]) return true;
  console.log(`!! дело ${id} не найдено: проверьте id в 01-core.js и теги <script src> в corp_game.html / Lai_CO.html`);
  return false;
});
let bad = 0;

for (const id of ids) {
  const C = BY_ID[id];
  const seeds = C.evidence.filter((e) => !(e.after || []).length && !(e.afterLink || []).length);
  const known = new Set(seeds.map((e) => e.id));
  const tiers = [];

  for (let guard = 0; guard < 40; guard++) {
    /* материал считается открываемым, если прочитано хотя бы одно основание;
       для afterLink основанием служит сама связь — её «находят» из уже открытых улик */
    const linkOk = new Set();
    (C.contradictions || []).forEach((k) => { if (known.has(k.a) && known.has(k.b)) linkOk.add(k.id); });
    const wave = C.evidence.filter((e) => {
      if (known.has(e.id)) return false;
      return (e.after || []).some((x) => known.has(x)) || (e.afterLink || []).some((x) => linkOk.has(x));
    });
    if (!wave.length) break;
    tiers.push(wave);
    wave.forEach((e) => known.add(e.id));
  }

  const never = C.evidence.filter((e) => !known.has(e.id));
  console.log(`\n=== ${C.id} — «${C.title}» · улик ${C.evidence.length}, связей ${(C.contradictions || []).length}`);
  console.log(`шаг 0 · доступно сразу (${seeds.length}):`);
  seeds.forEach((e) => console.log(`   ${e.id}  ${e.title}`));
  tiers.forEach((wave, i) => {
    console.log(`шаг ${i + 1} · поступает (${wave.length}):`);
    wave.forEach((e) => {
      const why = (e.after || []).map((x) => `прочитать ${x}`)
        .concat((e.afterLink || []).map((x) => `найти связь ${x}`)).join(' или ');
      console.log(`   ${e.id}  ${e.title}  [${e.cat}]  основание: ${why}`);
    });
  });

  if (never.length) {
    bad++;
    console.log(`!! НИКОГДА НЕ ОТКРЫВАЮТСЯ (${never.length}): ${never.map((e) => e.id + ' ' + e.title).join(' | ')}`);
  }
  if (seeds.length < 5 || seeds.length > 14) {
    bad++;
    console.log(`!! стартовых материалов ${seeds.length} — норма 5–14`);
  }
  /* «волна» — сумма по всем прочтениям; игроку материалы приходят за одно прочтение,
     поэтому проверяем самый жадный одиночный триггер */
  const fanout = {};
  C.evidence.forEach((e) => (e.after || []).forEach((x) => { fanout[x] = (fanout[x] || 0) + 1; }));
  const greedy = Object.keys(fanout).filter((x) => fanout[x] > 6);
  if (greedy.length) {
    bad++;
    console.log(`!! от одного прочтения открывается больше 6: ${greedy.map((x) => x + ' → ' + fanout[x]).join(', ')}`);
  }
  const biggest = tiers.reduce((a, w, i) => (w.length > a.n ? { n: w.length, i: i + 1 } : a), { n: 0, i: 0 });
  console.log(`крупнейшая волна: ${biggest.n} на шаге ${biggest.i} · максимальный одиночный прирост: ${Math.max(0, ...Object.values(fanout))}`);
  if (tiers.length > 7) { bad++; console.log(`!! цепочка глубина ${tiers.length} шагов — риск, что игрок не дойдёт`); }

  const byKind = {};
  C.evidence.forEach((e) => { byKind[e.kind] = (byKind[e.kind] || 0) + 1; });
  console.log('виды: ' + Object.keys(byKind).sort().map((k) => `${k}:${byKind[k]}`).join(' '));
  const chars = JSON.stringify(C.evidence).length;
  console.log(`объём: ${Math.round(chars / 1000)}k знаков данных · шагов открытия: ${tiers.length}`);
}

console.log(bad ? `\nЕсть замечания: ${bad}` : '\nOK — карта построена');
if (bad) process.exit(1);
