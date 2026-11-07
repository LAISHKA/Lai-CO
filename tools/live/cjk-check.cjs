/* Поиск азиатских артефактов в кириллических файлах + проверка синтаксиса js/cjs/mjs.
   Использование: node tools/live/cjk-check.cjs index.html assets/styles.css js/20-app.js */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const T = path.join(__dirname, 'out') + path.sep;
const cjk = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const JS_EXT = new Set(['.js', '.cjs', '.mjs']);
const out = [];
let bad = 0;
for (const f of process.argv.slice(2)) {
  let s;
  try { s = fs.readFileSync(f, 'utf8'); } catch (e) { out.push('НЕТ ФАЙЛА ' + f); bad++; continue; }
  s.split(/\r?\n/).forEach((l, i) => { if (cjk.test(l)) { out.push('CJK ' + f + ':' + (i + 1) + ' ' + l.trim().slice(0, 80)); bad++; } });
  if (JS_EXT.has(path.extname(f))) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) { out.push('SYNTAX ' + f + '\n' + (r.stderr || '').split(/\r?\n/).slice(0, 6).join('\n')); bad++; }
  }
}
fs.mkdirSync(T, { recursive: true });
fs.writeFileSync(T + 'cjk.txt', out.length ? out.join('\n') : 'чисто', 'utf8');
console.log(bad === 0 ? 'OK — 0 проблем' : bad + ' проблем(ы) — см. ' + T + 'cjk.txt');
process.exit(bad === 0 ? 0 : 1);
