/* ============================================================
   Проверка изоляции дел друг от друга.
   Дела обязаны не иметь ни общих людей, ни общих организаций,
   ни общих топонимов. Сверяем посписочно:
   1) фамилии из persons каждого дела;
   2) одиночные имена собственные в кавычках («Дубрава», «Верста») —
      так ловятся общие фирмы, посёлки и прозвища.
   Выход: 0 — изоляция в порядке, 1 — найдена коллизия фамилий.
   Запуск из корня проекта: node tools/isolation.mjs
   ============================================================ */
import fs from 'node:fs';

const dir = 'cases';
const files = ['01-core.js', '02-evidence.js', '03-evidence.js', '04-evidence.js',
  '05-evidence.js', '06-evidence.js'];
const cases = fs.readdirSync(dir).filter(d => /^case-\d+$/.test(d)).sort();

const surnames = {};
const quoted = {};

function add(map, key, c) {
  (map[key] = map[key] || new Set()).add(c);
}

for (const c of cases) {
  const win = { localStorage: { getItem: () => null, setItem: () => {} } };
  for (const f of files) {
    const p = dir + '/' + c + '/' + f;
    if (!fs.existsSync(p)) continue;
    new Function('window', fs.readFileSync(p, 'utf8'))(win);
  }
  const id = 'CASE' + c.replace('case-', '');
  const C = win[id];
  if (!C) { console.log('!! не загружен ' + id + ' (' + c + ')'); continue; }

  for (const p of C.persons || []) {
    const sur = (p.short || String(p.name || '').split(' ')[0] || '').trim();
    if (sur.length > 2) add(surnames, sur, c);
  }

  const text = files.map(f => {
    const p = dir + '/' + c + '/' + f;
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }).join('\n');

  for (const m of text.matchAll(/«([А-ЯЁ][а-яё]{2,20}(?:-[А-ЯЁа-яё]{1,12})?)»/g)) {
    add(quoted, m[1], c);
  }
}

function report(title, map, fatal) {
  const hits = Object.entries(map).filter(([, s]) => s.size > 1).sort();
  console.log('\n' + title + ': ' + (hits.length ? hits.length + ' пересечений' : 'чисто'));
  for (const [k, s] of hits) console.log('   ' + k + '  →  ' + [...s].join(', '));
  return fatal && hits.length ? 1 : 0;
}

let bad = report('Фамилии, повторяющиеся в разных делах', surnames, true);
report('Имена собственные в кавычках, общие для разных дел (оценить руками)', quoted, false);

console.log('\nпроверено дел: ' + cases.length + ' (' + cases.join(', ') + ')');
process.exit(bad);
