#!/usr/bin/env node
/* Проверка ОДНОГО дела без index.html — чтобы несколько сессий могли работать параллельно.
   Использование: node tools/check-case.mjs case-08 [case-09 ...]
   Проверяет: загрузку восьми файлов, структуру, числовые нормы профиля из docs/ROADMAP.json,
   достижимость материалов, флаги, уникальность имён против остальных дел, наличие SVG,
   артефакты текста в файлах дела. Выход: построчный отчёт + «все проверки пройдены» / «ПРОВАЛЕНО». */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const BOUNDS = {
  classic: { evidence: [34, 38], links: [30, 40], persons: [10, 12], victims: [1, 1], suspects: [4, 6], seeds: [5, 14], cats: [8, 8], svg: [4, 7], readK: [40, 95], playtimeMin: [45, 75], hints: [6, 6], recon: [12, 15] },
  talky: { evidence: [24, 30], links: [30, 40], persons: [13, 18], victims: [1, 3], suspects: [5, 8], seeds: [5, 14], cats: [8, 8], svg: [3, 6], readK: [38, 62], playtimeMin: [45, 65], hints: [6, 6], recon: [12, 15] },
  dense: { evidence: [40, 48], links: [36, 44], persons: [6, 9], victims: [1, 1], suspects: [3, 4], seeds: [5, 14], cats: [8, 8], svg: [5, 8], readK: [75, 110], playtimeMin: [60, 85], hints: [6, 6], recon: [12, 15] },
  mass: { evidence: [34, 42], links: [34, 44], persons: [10, 14], victims: [2, 4], suspects: [4, 6], seeds: [5, 14], cats: [8, 8], svg: [4, 7], readK: [68, 100], playtimeMin: [58, 78], hints: [6, 6], recon: [12, 15] },
  demo: { evidence: [26, 30], links: [30, 40], persons: [12, 18], victims: [1, 3], suspects: [4, 6], seeds: [5, 14], cats: [8, 8], svg: [3, 6], readK: [22, 30], playtimeMin: [15, 25], hints: [4, 6], recon: [12, 15] }
};
const FILES = ['01-core.js', '02-evidence.js', '03-evidence.js', '04-evidence.js', '05-evidence.js', '06-evidence.js', '07-links.js', '08-final.js'];
const AUTHORIAL = /(по сути|получается,|вывод таков|это значит, что|очевидно,|как мы видим|несомненно|становится ясно)/;

function loadCase(dir) {
  const files = FILES.map(f => path.join(dir, f)).filter(f => fs.existsSync(f));
  if (files.length !== FILES.length) throw new Error('не хватает файлов: есть ' + files.length + ' из ' + FILES.length);
  const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, CASES: [] };
  win.registerCase = function (C) { if (win.CASES.indexOf(C) < 0) win.CASES.push(C); };
  for (const f of files) vm.runInNewContext(fs.readFileSync(f, 'utf8'), win, { filename: f });
  const C = win.CASES[0];
  if (!C) throw new Error('дело не зарегистрировано (нет registerCase в 08-final.js)');
  return C;
}
function allCasesExcept(id) {
  const out = [];
  for (const base of ['cases', 'cases-wip']) {
    const rootDir = path.join(ROOT, base);
    if (!fs.existsSync(rootDir)) continue;
    for (const d of fs.readdirSync(rootDir)) {
      if (!/^case-\d\d$/.test(d) || d === id) continue;
      try { out.push(loadCase(path.join(rootDir, d))); } catch (e) { /* чужое дело может быть незавершённым */ }
    }
  }
  return out;
}

function check(id, roadmap) {
  const problems = [];
  const notes = [];
  const dir = fs.existsSync(path.join(ROOT, 'cases-wip', id)) ? path.join(ROOT, 'cases-wip', id) : path.join(ROOT, 'cases', id);
  const spec = roadmap && roadmap.cases ? roadmap.cases.filter(c => c.dir === id)[0] : null;
  const profile = spec ? spec.profile : 'classic';
  const limits = (roadmap && roadmap.limits && roadmap.limits[profile]) || {};
  const B = Object.assign({}, BOUNDS[profile], limits);
  notes.push('профиль: ' + profile);

  let C = null;
  try { C = loadCase(dir); } catch (e) { problems.push('загрузка: ' + e.message); }
  if (!C) return { problems, notes };

  ['title', 'logline', 'briefing', 'persons', 'evidence', 'contradictions', 'objective', 'hints', 'reconstruction', 'crime'].forEach(k => {
    if (C[k] == null || (Array.isArray(C[k]) && !C[k].length)) problems.push('поле ' + k + ' пусто');
  });
  const persons = C.persons || [];
  const ev = C.evidence || [];
  const links = C.contradictions || [];
  const ids = {};
  persons.forEach(p => { ids[p.id] = p; });
  ev.forEach(e => { ids[e.id] = e; });

  const victims = persons.filter(p => p.kind === 'victim').length;
  const suspects = persons.filter(p => p.kind === 'suspect').length;
  if (!victims) problems.push('нет ни одной жертвы');
  const inB = (key, val) => { const [lo, hi] = B[key]; if (val < lo || val > hi) problems.push(key + ' = ' + val + ', норма ' + lo + '—' + hi + ' (' + profile + ')'); };
  inB('evidence', ev.length); inB('links', links.length); inB('persons', persons.length);
  inB('victims', victims); inB('suspects', suspects); inB('playtimeMin', C.playtimeMin || 0);
  inB('hints', (C.hints || []).length); inB('recon', (C.reconstruction || []).length);
  const cats = {};
  ev.forEach(e => { cats[e.cat] = 1; });
  inB('cats', Object.keys(cats).length);
  const seeds = ev.filter(e => !e.after || !e.after.length);
  inB('seeds', seeds.length);
  const chars = ev.reduce((s, e) => s + JSON.stringify(e.doc || {}).length, 0);
  inB('readK', Math.round(chars / 1000));

  const svgUsed = {};
  ev.forEach(e => {
    if (e.at && !/^\d\d:\d\d$/.test(String(e.at))) problems.push(e.id + ': at не ЧЧ:ММ — ' + e.at);
    if (!e.title && !(e.doc && e.doc.title)) problems.push(e.id + ': нет заголовка');
    (e.after || []).forEach(a => { if (!ids[a]) problems.push(e.id + ': after ссылается на ' + a); });
    if (!(e.tags || []).length && !(e.keys || []).length) problems.push(e.id + ': ни tags, ни keys');
    const imgPath = e.img || (e.doc && e.doc.img);
    if (imgPath) {
      const base = path.basename(String(imgPath));
      svgUsed[base] = (svgUsed[base] || []).concat(e.id);
      if (!fs.existsSync(path.join(dir, 'assets', base))) problems.push(e.id + ': img ' + imgPath + ' нет на диске');
      if (['photo', 'cctv', 'shot'].indexOf(e.kind) < 0) problems.push(e.id + ': схема висит на kind=' + e.kind + ', а движок рисует img только у photo/cctv/shot');
      if (String(imgPath).indexOf('cases/' + id + '/') !== 0) notes.push(e.id + ': путь схемы ' + imgPath + ' — приведу к cases/' + id + '/ при приёмке');
    }
    (e.tags || []).forEach(t => { if (!ids[t]) problems.push(e.id + ': tag ' + t + ' не найден среди людей/улик'); });
    if (e.kind !== 'note' && e.kind !== 'chat' && e.kind !== 'talk') {
      const body = JSON.stringify(e.doc || {});
      if (AUTHORIAL.test(body)) problems.push(e.id + ': голос автора в материале (' + (body.match(AUTHORIAL) || [])[0] + ')');
    }
    (Array.isArray(e.doc && e.doc.body) ? e.doc.body : []).forEach(b => {
      if (b.p && /\[[А-ЯЁа-яё]{2,}\]/.test(b.p) && !b.p.replace(/\[[^\]]+\]/g, '').match(/\[[А-ЯЁа-яё]{2,}\]/)) { /* теги людей проверены выше */ }
    });
  });

  const reach = {};
  seeds.forEach(e => { reach[e.id] = 0; });
  for (let pass = 0; pass < 12; pass++) ev.forEach(e => {
    if (reach[e.id] != null) return;
    const ok = (e.after || []).every(a => reach[a] != null);
    if (ok) reach[e.id] = Math.max.apply(null, [0].concat((e.after || []).map(a => reach[a] + 1)));
  });
  ev.forEach(e => { if (reach[e.id] == null) problems.push(e.id + ': недостижим (после чего выдаётся?)'); });
  const depth = Math.max.apply(null, Object.keys(reach).map(k => reach[k]));
  if (depth > 7) problems.push('цепочка глубже 7 шагов: ' + depth);
  const waves = {};
  Object.keys(reach).forEach(k => { waves[reach[k]] = (waves[reach[k]] || 0) + 1; });
  const fan = {};
  ev.forEach(e => (e.after || []).forEach(a => { fan[a] = (fan[a] || 0) + 1; }));
  Object.keys(fan).forEach(a => { if (fan[a] > 6) notes.push('после ' + a + ' открывается ' + fan[a] + ' улик за один шаг — проверь, не стоит ли разнести'); });
  notes.push('волны: ' + Object.keys(waves).sort((x, y) => x - y).map(w => w + ':' + waves[w]).join(' ') + ' · материалов ' + ev.length + ' · связей ' + links.length + ' · людей ' + persons.length + ' (жертв ' + victims + ', подозреваемых ' + suspects + ') · семян ' + seeds.length + ' · чтение ' + Math.round(chars / 1000) + 'k · глубина ' + depth);

  const byLink = {};
  links.forEach(l => {
    ['a', 'b'].forEach(k => {
      if (!ids[l[k]]) problems.push((l.id || '?') + ': нет материала ' + l[k]);
      else byLink[l[k]] = (byLink[l[k]] || 0) + 1;
    });
    const r = String(l.reveals || '');
    if (r.length < 200) problems.push((l.id || '?') + ': reveals ' + r.length + ' знаков (минимум 200)');
    if (r.length > 500) problems.push((l.id || '?') + ': reveals ' + r.length + ' знаков (максимум 500)');
    const A = ids[l.a], Bm = ids[l.b];
    if (A && Bm) {
      const ta = (A.tags || []).concat(A.keys || []), tb = (Bm.tags || []).concat(Bm.keys || []);
      if (!ta.some(x => tb.indexOf(x) >= 0)) problems.push((l.id || '?') + ': у пары нет общих tags/keys');
    }
    if (!/^c\d\d$/.test(String(l.id || ''))) problems.push('id связи должен быть вида c01: ' + l.id);
  });
  ev.forEach(e => { if (!byLink[e.id]) problems.push(e.id + ': участвует ни в одной связи'); });

  const flags = {};
  persons.forEach(p => { flags[p.id] = { watch: 0, clear: 0 }; });
  links.forEach(l => { Object.keys(l.flags || {}).forEach(p => { if (!flags[p]) problems.push((l.id || '?') + ': флаг про несуществующего ' + p); else flags[p][l.flags[p]] = (flags[p][l.flags[p]] || 0) + 1; }); });
  const obj = C.objective || {};
  const culprit = obj.fields && obj.fields.filter(f => f.id === 'culprit')[0];
  if (!culprit) problems.push('в objective нет поля culprit');
  else {
    const w = (flags[culprit.correct] || {}).watch || 0;
    if (w < 12) problems.push('у виновника ' + culprit.correct + ' флагов watch ' + w + ' (нужно ≥ 12)');
    persons.filter(p => p.kind === 'suspect' && p.id !== culprit.correct).forEach(p => {
      if (!((flags[p.id] || {}).watch || 0)) problems.push('у подозреваемого ' + p.id + ' нет ни одного watch');
      if (!((flags[p.id] || {}).clear || 0)) problems.push('у подозреваемого ' + p.id + ' нет ни одного clear');
    });
  }

  const svg = fs.existsSync(path.join(dir, 'assets')) ? fs.readdirSync(path.join(dir, 'assets')).filter(f => /\.svg$/.test(f)) : [];
  if (svg.length < B.svg[0] || svg.length > B.svg[1]) problems.push('SVG-схем ' + svg.length + ', норма ' + B.svg[0] + '—' + B.svg[1]);
  svg.forEach(f => {
    const s = fs.readFileSync(path.join(dir, 'assets', f), 'utf8');
    if (!/<svg[\s>]/i.test(s)) problems.push('svg ' + f + ': нет корня <svg>');
    if (/[а-яёА-ЯЁ][A-Za-z]{2,}|[\u3040-\u9fff]/.test(s.replace(/<text[^>]*>[^<]*<\/text>/g, ''))) problems.push('svg ' + f + ': артефакты текста');
    if (!svgUsed[f]) problems.push('svg ' + f + ': ни один материал на неё не ссылается — игрок схему не увидит');
  });

  FILES.forEach(f => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    const bad = s.match(/[а-яё][A-Za-z]{2,}|[\u3040-\u9fff\uac00-\ud7af]/g);
    if (bad) problems.push(f + ': артефакты ' + bad.slice(0, 6).join(', '));
  });

  const others = allCasesExcept(id);
  const shorts = {};
  others.forEach(o => (o.persons || []).forEach(p => { const s = p.short || String(p.name).split(' ')[0]; if (s && s.length > 2) shorts[s] = o.id; }));
  persons.forEach(p => { const s = p.short || String(p.name).split(' ')[0]; if (s && shorts[s]) problems.push('фамилия «' + s + '» повторяется с делом ' + shorts[s]); });
  if (roadmap && roadmap.cases) {
    const reserved = {};
    roadmap.cases.forEach(c => {
      if (c.dir === id) return;
      (c.identity.surnames || []).forEach(s => { reserved[s] = c.dir; });
    });
    persons.forEach(p => {
      const s = String(p.name).split(' ')[0];
      if (s && reserved[s]) problems.push('фамилия «' + s + '» зарезервирована за делом ' + reserved[s]);
    });
  }
  if (spec) {
    const mech = fs.existsSync(path.join(ROOT, 'docs', 'MECHANICS.md')) ? fs.readFileSync(path.join(ROOT, 'docs', 'MECHANICS.md'), 'utf8') : '';
    (spec.identity.surnames || []).forEach(s => { if (mech.indexOf(s) >= 0) problems.push('фамилия ' + s + ' уже в реестре docs/MECHANICS.md'); });
    if (spec.shape.persons !== persons.length && persons.length) notes.push('в ROADMAP людей ' + spec.shape.persons + ', в файле ' + persons.length);
  }
  return { problems, notes };
}

const ids = process.argv.slice(2).filter(a => /^case-\d\d$/.test(a));
if (!ids.length) { console.log('использование: node tools/check-case.mjs case-08 [case-09 ...]'); process.exit(2); }
let roadmap = null;
try { roadmap = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'ROADMAP.json'), 'utf8')); } catch (e) { console.log('!! docs/ROADMAP.json не читается: ' + e.message); }
let failed = 0;
ids.forEach(id => {
  const r = check(id, roadmap);
  console.log('\n=== ' + id + ' ===');
  r.notes.forEach(n => console.log('  ' + n));
  if (r.problems.length) { failed++; r.problems.forEach(p => console.log('  !! ' + p)); console.log('  ИТОГО: провалов ' + r.problems.length); }
  else console.log('  OK — все проверки по делу пройдены');
});
console.log('\n' + (failed ? 'ПРОВАЛЕНО ПРОВЕРОК: ' + failed : 'все проверки пройдены'));
process.exit(failed ? 1 : 0);
