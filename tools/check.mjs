/* Прогон всех проверок одной командой: node tools/check.mjs */
import { execFileSync } from 'node:child_process';

const steps = [
  ['целостность данных', 'tools/validate.mjs'],
  ['механика зацепок', 'tools/check-hook.mjs'],
  ['загрузка и рендер', 'tools/smoke.mjs'],
  ['обращения к DOM', 'tools/check-dom.mjs'],
  ['классы в стилях', 'tools/check-css.mjs'],
  ['артефакты текста', 'tools/check-lookalike.mjs'],
  ['опечатки в текстах дел', 'tools/check-typos.mjs', ['--gate']],
  ['плотность кандидатов выделения', 'tools/check-candidates.cjs'],
  ['целость SVG-схем', 'tools/check-svg.mjs'],
  ['обезличенность источников', 'tools/check-anon.mjs'],
  ['изолированность имён между делами', 'tools/isolation.mjs']
];

let failed = 0;
for (const [name, script, args] of steps) {
  console.log(`\n=== ${name} (${script}${args ? ' ' + args.join(' ') : ''})`);
  try {
    execFileSync(process.execPath, [script, ...(args || [])], { stdio: 'inherit' });
  } catch (e) {
    failed++;
    console.log(`!! ${name}: код ${e.status}`);
  }
}

console.log('\n' + (failed ? `ПРОВАЛЕНО ПРОВЕРОК: ${failed}` : 'все проверки пройдены'));
if (failed) process.exit(1);
