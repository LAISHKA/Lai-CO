/* Страховка от брака генерации в текстах игры:
   1) символ чужой письменности (иероглиф и т.п.) — проверяется везде;
   2) английское слово, вставленное в русскую прозу («в journal появилась») —
      проверяется в художественных .md (README) и в прозе дел; технические
      AGENTS.md и docs/ под это правило не попадают, но символы чужих
      письменностей там всё равно запрещены.
   Использование: node tools/check-lookalike.mjs [путь...] */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const CYR = /[а-яёА-ЯЁ]/;
const LATIN_WORD = /^[A-Za-z][A-Za-z0-9_.\-]{2,}$/;
const OK_WORDS = new Set(['node', 'javascript', 'typescript', 'npm', 'file', 'html', 'css', 'cctv', 'md']);
// Символы, которые встречаются в оформлении и считаются нормой.
const OK_CHARS = new Set(('«»‹›“”‘’—–…·•°±×÷²³′″№§©®→←↑↓↔⇄≥≤≠≈★☆✓✔✕✖✗✘⚖' +
  '◐◑◒◓☰☱☲⌀⌂■□▪▫●○◌◍◎◇◆□△▽※§¶†‡‰µΩ€$£¥₽₴−').split(''));
const OK_EMOJI = ['🔗', '🔎', '🔍', '⏱', '⏲', '⌛', '⏳', '🗑', '📁', '📄', '📌', '🧾', '🕒', '🔒', '🔓', '💡'];

function walk(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f), out);
  else if (['.js', '.html', '.css', '.md'].includes(extname(p))) out.push(p);
  return out;
}

const targets = process.argv.slice(2);
const roots = targets.length ? targets : ['index.html', 'assets', 'js', 'cases', 'README.md', 'AGENTS.md', 'docs'];
const files = roots.flatMap((f) => walk(f, [])).filter((f) => !f.includes('check-lookalike'));
/* Служебные md (AGENTS.md, docs/) — техническая проза, там английские термины
   законны. Для них остаётся только проверка на символы чужих письменностей. */
const TECH_DOC = /^(AGENTS\.md|docs[\\/])/i;
let hits = 0;

for (const file of files) {
  const isMd = file.endsWith('.md');
  const checkLatin = isMd && !TECH_DOC.test(file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inFence = false;

  lines.forEach((raw, i) => {
    if (isMd) {
      if (/^\s*```/.test(raw)) { inFence = !inFence; return; }
      if (inFence) return;
    }
    const line = isMd ? raw.replace(/`[^`]*`/g, ' ') : raw;
    if (!CYR.test(line)) return;

    if (checkLatin) {
      const t = line.split(/(\s+)/);
      for (let k = 0; k < t.length; k++) {
        const w = t[k].replace(/[«».,:;!?()"'…-]+/g, '');
        if (!LATIN_WORD.test(w) || OK_WORDS.has(w.toLowerCase())) continue;
        const before = t.slice(0, k).reverse().find((x) => x.trim());
        const after = t.slice(k + 1).find((x) => x.trim());
        if (CYR.test(before || '') && CYR.test(after || '')) {
          console.log(`${file}:${i + 1}: английское слово в русской фразе «${w}»`);
          hits++;
        }
      }
    }

    for (const ch of new Set(line)) {
      const c = ch.codePointAt(0);
      if (c < 128) continue;
      if (c >= 0x0400 && c <= 0x04FF) continue;           // кириллица
      if (c >= 0x2500 && c <= 0x25FF) continue;           // псевдографика
      if (c >= 0x1F000) continue;                          // эмодзи (белый список ниже не обязателен)
      if (OK_CHARS.has(ch)) continue;
      if (OK_EMOJI.some((e) => e.includes(ch))) continue;
      console.log(`${file}:${i + 1}: символ вне кириллицы U+${c.toString(16).toUpperCase()} «${ch}» :: ${line.trim().slice(0, 90)}`);
      hits++;
    }
  });
}

console.log(hits ? `\nнайдено вхождений: ${hits}` : 'артефактов в текстах нет');
if (hits) process.exit(1);
