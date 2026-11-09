/* Сверяет классы, которые генерирует код, с классами, описанными в стилях.
   Ловит «элемент есть, а выглядит как голый текст».
   Использование: node tools/check-css.mjs */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync('assets/styles.css', 'utf8');
const defined = new Set();
for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);

function walk(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f), out);
  else if (/\.(js|html)$/.test(f)) out.push(p);
  return out;
}

const used = new Map(); // class -> [где]
/* список файлов берём из папки js/, чтобы новый файл движка не остался без контроля */
const files = ['corp_game.html', 'Lai_CO.html'].concat(readdirSync('js').filter((f) => /\.js$/.test(f)).map((f) => join('js', f)));
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    // class="..." в разметке и строковых конкатенациях
    for (const m of line.matchAll(/class="([^"{}$+'`]*)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c) push(c, `${f}:${i + 1}`);
    }
    // classList.add/remove/toggle('x') и className = '...'
    for (const m of line.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*'([\w-]+)'/g)) push(m[1], `${f}:${i + 1}`);
    for (const m of line.matchAll(/class=\\?['"]([^'"]+)\\?['"]/g)) {
      for (const c of m[1].split(/\s+/)) if (c && /^[\w-]+$/.test(c)) push(c, `${f}:${i + 1}`);
    }
  });
}

function push(c, at) {
  if (!used.has(c)) used.set(c, []);
  const list = used.get(c);
  if (list.length < 3 && !list.includes(at)) list.push(at);
}

const missing = [...used.keys()].filter((c) => !defined.has(c)).sort();
const unused = [...defined].filter((c) => !used.has(c)).sort();

console.log(`классов в стилях: ${defined.size} | используется в коде: ${used.size}`);
if (missing.length) {
  console.log('\nНЕ ОПИСАНЫ В CSS:');
  for (const c of missing) console.log(`  .${c}  <- ${used.get(c).join(', ')}`);
}
if (unused.length) {
  console.log(`\nв CSS есть, но кодом не используется (${unused.length}):`);
  console.log('  ' + unused.join(', '));
}
console.log(missing.length ? `\nпроблем: ${missing.length}` : '\nOK — все генерируемые классы описаны.');
