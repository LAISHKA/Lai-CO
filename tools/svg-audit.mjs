#!/usr/bin/env node
/* ============================================================
   tools/svg-audit.mjs — читаемость подписей в схемах (отчёт, не гейт).

   Считает ровно те файлы, что видит tools/check-svg.mjs:
   cases/<дело>/assets/*.svg. Все они рисуются в viewBox 1600×900 и в
   читалке сжимаются до ширины колонки, поэтому кегль из файла в пиксели
   экрана переводится так: px = font-size × (ширина_рендера / 1600).

   Ширины: 881 px — колонка читалки при широком окне; 630 px — то же при
   1600 px с боковой колонкой. Пороги: 9 px — ниже нельзя, 12 px — комфортно.

   В конце — во сколько раз пришлось бы поднять кегли в каждом файле, чтобы
   МЕДИАНА файла стала ≥ 12 px при 881 px (колонка «×нужно»). Это не план
   правок: при ×2 подписи полезут друг на друга. План правок — подъём
   заголовков и вынос мелочи из схемы в текст материала.

   Выход — stdout. Кириллица в PowerShell ломается, поэтому:
     cmd /c "node tools/svg-audit.mjs > %TEMP%\svg.txt 2>&1"
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTHS = [881, 630];
const FLOOR = 9;      // px, ниже — нечитаемо
const TARGET = 12;    // px, комфорт

const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

const rows = [];
const extras = [];
const viewBoxes = {};

(function walk(d, rel) {
  for (const f of fs.readdirSync(d)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = path.join(d, f);
    const r = rel ? rel + '/' + f : f;
    if (fs.statSync(p).isDirectory()) walk(p, r);
    else if (f.toLowerCase().endsWith('.svg') && !/^cases\/[^/]+\/assets\/[^/]+$/.test(r)) extras.push(r);
  }
})(ROOT, '');

const dir = path.join(ROOT, 'cases');
const tot = { files: 0, nodes: 0 };
for (const w of WIDTHS) tot['u9_' + w] = 0, tot['u12_' + w] = 0;

for (const c of fs.readdirSync(dir).sort()) {
  const a = path.join(dir, c, 'assets');
  if (!fs.existsSync(a)) continue;
  for (const f of fs.readdirSync(a).sort()) {
    if (!f.endsWith('.svg')) continue;
    const t = fs.readFileSync(path.join(a, f), 'utf8');
    const relPath = 'cases/' + c + '/assets/' + f;
    const vb = (t.match(/viewBox="([^"]+)"/) || [, 'нет'])[1].replace(/\s+/g, ' ');
    viewBoxes[vb] = (viewBoxes[vb] || 0) + 1;
    const vbw = Number((vb.match(/^0 0 ([\d.]+)/) || [, 1600])[1]);

    const sizes = [];
    for (const m of t.matchAll(/font-size="([\d.]+)(?:px)?"/g)) sizes.push(Number(m[1]));
    for (const m of t.matchAll(/font-size:\s*([\d.]+)px/g)) sizes.push(Number(m[1]));

    const r = { rel: relPath, vb, n: sizes.length, min: sizes.length ? Math.min(...sizes) : 0, max: sizes.length ? Math.max(...sizes) : 0 };
    tot.files++;
    tot.nodes += sizes.length;
    for (const w of WIDTHS) {
      const k = sizes.map((s) => (s * w) / vbw);
      const u9 = k.filter((x) => x < FLOOR).length;
      const u12 = k.filter((x) => x < TARGET).length;
      tot['u9_' + w] += u9;
      tot['u12_' + w] += u12;
      r['min' + w] = k.length ? +Math.min(...k).toFixed(1) : 0;
      r['med' + w] = k.length ? +med(k).toFixed(1) : 0;
      r['u9_' + w] = u9;
    }
    r.need12 = r.med881 ? +(TARGET / r.med881).toFixed(2) : 0;
    rows.push(r);
  }
}

const L = [];
L.push('ФАЙЛОВ svg в cases/*/assets: ' + tot.files);
L.push('svg ВНЕ этого набора: ' + extras.length + (extras.length ? ' — ' + extras.join(', ') : ''));
L.push('viewBox: ' + Object.entries(viewBoxes).map(([k, v]) => k + ' × ' + v).join(' | '));
L.push('текстовых узлов с font-size: ' + tot.nodes + '; медианный максимальный кегль файла: ' + med(rows.map((r) => r.max)));
for (const w of WIDTHS) {
  L.push('при ' + w + ' px: узлов < ' + FLOOR + ' px = ' + tot['u9_' + w] + ' (' + ((tot['u9_' + w] / tot.nodes) * 100).toFixed(1) + ' %) · < ' + TARGET + ' px = ' + tot['u12_' + w] + ' (' + ((tot['u12_' + w] / tot.nodes) * 100).toFixed(1) + ' %)');
}
L.push('файлов с худшим узлом < ' + FLOOR + ' px при 881 px: ' + rows.filter((r) => r.min881 < FLOOR).length + ' из ' + tot.files);
L.push('файлов с медианой < ' + TARGET + ' px при 881 px: ' + rows.filter((r) => r.med881 < TARGET).length + ' из ' + tot.files);
L.push('');
L.push('ТОП-30 по числу узлов < ' + FLOOR + ' px при 881 px');
L.push('  файл                                   узлов<9  min px  med px  max kegl  ×нужно');
rows.slice().sort((x, y) => y.u9_881 - x.u9_881).slice(0, 30).forEach((r) => {
  L.push('  ' + r.rel.padEnd(40) + String(r.u9_881 + '/' + r.n).padStart(6) + String(r.min881).padStart(8) + String(r.med881).padStart(8) + String(r.max).padStart(10) + String(r.need12).padStart(9));
});
fs.writeFileSync(path.join(ROOT, 'tools', 'live', 'out', 'svg-audit.txt'), L.join('\n') + '\n', 'utf8');
console.log(L.join('\n'));
console.log('\nОтчёт: tools/live/out/svg-audit.txt');
