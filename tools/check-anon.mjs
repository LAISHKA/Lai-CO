/* Обезличенность: ни один файл проекта не должен содержать опознавательных строк
   из реальных локальных актов. Список — docs/ANON-BANNED.txt.
   Строка с ~ даёт предупреждение, без ~ — провал. Запуск: node tools/check-anon.mjs */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const LIST = 'docs/ANON-BANNED.txt';
const DIRS = ['cases', 'cases-wip', 'briefs', 'docs', 'js', 'assets', 'rules', 'outreach'];
const FILES = ['README.md', 'corp_game.html', 'Lai_CO.html', 'AGENTS.md'];
const EXT = new Set(['.js', '.md', '.html', '.css', '.svg', '.json', '.txt']);

const banned = readFileSync(join(ROOT, LIST), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => (l.startsWith('~') ? { soft: true, term: l.slice(1).trim() } : { soft: false, term: l }));

function walk(dir, acc) {
  let items;
  try {
    items = readdirSync(dir);
  } catch (e) {
    return acc;
  }
  for (const name of items) {
    const fp = join(dir, name);
    const st = statSync(fp);
    if (st.isDirectory()) walk(fp, acc);
    else if (EXT.has(extname(name).toLowerCase())) acc.push(fp);
  }
  return acc;
}

const targets = [];
for (const d of DIRS) walk(join(ROOT, d), targets);
for (const f of FILES) {
  try {
    statSync(join(ROOT, f));
    targets.push(join(ROOT, f));
  } catch (e) {
    /* нет файла — не беда */
  }
}

const hard = [];
const soft = [];
for (const fp of targets) {
  const rel = fp.slice(ROOT.length + 1).replace(/\\/g, '/');
  if (rel === LIST) continue;
  const text = readFileSync(fp, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const b of banned) {
      if (line.toLowerCase().includes(b.term.toLowerCase())) {
        const rec = `${rel}:${i + 1} — «${b.term}»`;
        (b.soft ? soft : hard).push(rec);
      }
    }
  });
}

console.log(`проверено файлов: ${targets.length}, запретов: ${banned.length}`);
for (const s of soft) console.log(`  предупреждение: ${s}`);
for (const h of hard) console.log(`  НАЙДЕНО: ${h}`);

if (hard.length) {
  console.log(`\nПРОВАЛЕНО: опознавательные строки реальных документов — ${hard.length}`);
  process.exit(1);
}
console.log('\nOK — обезличенность в норме');
