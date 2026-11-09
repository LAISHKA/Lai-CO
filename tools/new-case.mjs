#!/usr/bin/env node
/* Создаёт скелет дела из docs/ROADMAP.json: 8 js-файлов + DESIGN.md + assets/.
   В corp_game.html / Lai_CO.html ничего не вписывает — это делает интеграционный шаг (docs/PARALLEL.md).
   Использование: node tools/new-case.mjs case-08 [case-09 ...] */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const rm = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'ROADMAP.json'), 'utf8'));
const want = process.argv.slice(2).filter(a => /^case-\d\d$/.test(a));
if (!want.length) { console.log('использование: node tools/new-case.mjs case-08 [case-09 ...]'); process.exit(2); }

const WRAP = "(function (root) {\n  'use strict';\n", TAIL = "})(typeof window !== 'undefined' ? window : globalThis);\n";
function core(c, KEY) {
  return '/* Дело ' + c.num + ' «' + c.title + '» — лица, завязка, шапка. */\n' + WRAP +
    "  var C = root." + KEY + " = {\n" +
    "    id: '" + c.dir + "',\n" +
    "    num: 'Дело № " + c.num + "',\n" +
    "    title: '" + c.title + "',\n" +
    "    logline: '',\n" +
    "    difficulty: " + c.difficulty + ",\n" +
    "    playtimeMin: " + c.playtimeMin + ",\n" +
    "    rating: '" + c.rating + "',\n" +
    "    meta: {\n" +
    "      date: '',\n" +
    "      place: '',\n" +
    "      note: ''\n" +
    "    },\n" +
    "    briefing: [],\n" +
    "    persons: []\n" +
    "  };\n" +
    "  root." + KEY + " = C;\n" + TAIL;
}
function ev(c, KEY, n, first) {
  return '/* Дело ' + c.num + ' — материалы, партия ' + n + '. */\n' + WRAP +
    (first ? '  var C = root.' + KEY + ';\n' : '  var C = root.' + KEY + ';\n') +
    '  C.evidence = (C.evidence || []).concat([\n\n  ]);\n' +
    '  root.' + KEY + ' = C;\n' + TAIL;
}
const files = c => {
  const KEY = 'CASE' + String(c.num).padStart(2, '0');
  return {
    '01-core.js': core(c, KEY),
    '02-evidence.js': ev(c, KEY, 2, true),
    '03-evidence.js': ev(c, KEY, 3),
    '04-evidence.js': ev(c, KEY, 4),
    '05-evidence.js': ev(c, KEY, 5),
    '06-evidence.js': ev(c, KEY, 6),
    '07-links.js': '/* Дело ' + c.num + ' — связи: пара материалов + вывод. */\n' + WRAP +
      '  var C = root.' + KEY + ';\n  C.contradictions = [\n\n  ];\n  root.' + KEY + ' = C;\n' + TAIL,
    '08-final.js': '/* Дело ' + c.num + ' — финал: цель, подсказки, реконструкция, вердикт. */\n' + WRAP +
      "  var C = root." + KEY + ";\n\n" +
      "  C.crime = { at: '', until: '', place: '', hourHint: '' };\n\n" +
      "  C.objective = { intro: '', fields: [] };\n\n" +
      "  C.hints = [];\n\n" +
      "  C.reconstruction = [];\n\n" +
      "  C.verdict = { full: '', good: '', partial: '', lose: '' };\n\n" +
      '  if (typeof root.registerCase === \'function\') root.registerCase(C);\n' + TAIL,
    'DESIGN.md': '# Дело № ' + c.num + ' «' + c.title + '» — замысел\n\n' +
      'Профиль: **' + c.profile + '** — ' + rm.profiles[c.profile] + '\n\n' +
      'Тема: ' + c.theme + '\n\nМир: ' + c.world + '\n\nНиша: ' + c.niche + '\n\n' +
      '## Правда вечера\n\n' + c.truth + '\n\n' +
      '## Часовая сетка\n\n| Время | Что произошло | Кто видел | Где зафиксировано |\n|---|---|---|---|\n\n' +
      '## Роли\n\n| id | Кто | Что подумает на его месте | Алиби и где оно трещит |\n|---|---|---|---|\n\n' +
      '## Независимые контуры доказательства\n\n1. \n2. \n3. \n4. \n\n' +
      '## Ложные следы\n\n| След | Кто в него верит | Чем снимается (улика) |\n|---|---|---|\n\n' +
      '## Карта ' + c.shape.evidence + ' материалов\n\n| id | Категория | Вид | Что доказывает | После чего | Ложный след |\n|---|---|---|---|---|---|\n\n' +
      '## Форма сдачи\n\n- виновник: \n- место: \n- окно: \n- способ: \n- мотив: \n\n' +
      '## Связи (' + c.shape.links + ')\n\n| id | a | b | вывод (200—500 знаков) | флаги |\n|---|---|---|---|---|\n'
  };
};
want.forEach(dirName => {
  const c = rm.cases.filter(x => x.dir === dirName)[0];
  if (!c) { console.log('!! ' + dirName + ' нет в docs/ROADMAP.json'); process.exitCode = 1; return; }
  const dir = path.join(ROOT, 'cases-wip', dirName);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  Object.keys(files(c)).forEach(name => {
    const to = path.join(dir, name);
    if (fs.existsSync(to) && process.argv.indexOf('--force') < 0) { console.log('  пропущен (уже есть): ' + name); return; }
    fs.writeFileSync(to, files(c)[name], 'utf8');
    console.log('  создан: cases-wip/' + dirName + '/' + name);
  });
  console.log('  контракт: briefs/' + dirName + '.md');
  console.log('досье ' + dirName + ' готово к работе. Проверка: node tools/check-case.mjs ' + dirName);
});
