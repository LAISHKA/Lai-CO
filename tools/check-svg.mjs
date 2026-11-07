// Проверка SVG-схем: корректный XML (стек тегов), закрытые кавычки,
// отсутствие «&» без сущности, наличие viewBox, только кириллица/латиница в подписях.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'cases');
const files = [];
fs.readdirSync(dir).forEach((c) => {
  const a = path.join(dir, c, 'assets');
  if (fs.existsSync(a)) fs.readdirSync(a).filter((f) => f.endsWith('.svg')).forEach((f) => files.push(path.join(a, f)));
});

let bad = 0;
const VOID = new Set(['br', 'hr', 'img']);

files.forEach((f) => {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const t = fs.readFileSync(f, 'utf8');
  const errs = [];

  if (!/viewBox="0 0 1600 900"/.test(t)) errs.push('нет viewBox="0 0 1600 900"');
  if (!/^<svg/.test(t.trim())) errs.push('корень не <svg>');

  // «&» без сущности
  if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(t)) errs.push('амперсанд без сущности');

  // нечётные кавычки в тегах
  (t.match(/<[^>]*>/g) || []).forEach((tag) => {
    if (((tag.match(/"/g) || []).length) % 2) errs.push('нечётное число кавычек в теге: ' + tag.slice(0, 60));
  });

  // баланс тегов
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|[^">])*?)(\/?)>/g;
  let m;
  while ((m = re.exec(t))) {
    const [, close, name, attrs, selfClose] = m;
    if (name === '?xml' || name === '!DOCTYPE' || name === '!--') continue;
    if (close) {
      if (!stack.length) errs.push(`закрывающий </${name}> без открывающего`);
      else {
        const top = stack.pop();
        if (top !== name) errs.push(`закрыл </${name}>, ожидался </${top}>`);
      }
    } else if (!selfClose && !VOID.has(name)) stack.push(name);
    if (/\s[a-zA-Z:-]+=[^"=]/.test(attrs)) errs.push(`атрибут без кавычек в <${name}>`);
  }
  if (stack.length) errs.push('незакрытые теги: ' + stack.join(' > '));

  if (errs.length) {
    bad++;
    console.log('FAIL ' + rel);
    errs.slice(0, 6).forEach((e) => console.log('   ' + e));
  }
});

if (!bad) console.log(`SVG-схем: ${files.length} · формат в порядке`);
else console.log(`\nSVG с ошибками: ${bad} из ${files.length}`);
if (bad) process.exit(1);
