/* Проверка, что все id, которые читает js/20-app.js, есть в обоих входных файлах
   (corp_game.html — дела 1—20, Lai_CO.html — дело 21; id объединяем).
   Запуск: node tools/check-dom.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = ['corp_game.html', 'Lai_CO.html']
  .map((p) => readFileSync(join(root, p), 'utf8')).join('\n');
const app = readFileSync(join(root, 'js/20-app.js'), 'utf8');

const have = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const used = new Set();
for (const m of app.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) used.add(m[1]);

const missing = [...used].filter((id) => !have.has(id));
console.log(`id в corp_game.html + Lai_CO.html: ${have.size} | использует app: ${used.size}`);
if (missing.length) {
  console.log('НЕТ В РАЗМЕТКЕ: ' + missing.join(', '));
  process.exit(1);
}
console.log('OK — все обращения к DOM разрешимы.');
