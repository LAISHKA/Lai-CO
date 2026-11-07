#!/usr/bin/env node
/* Рисует cases/case-NN/BRIEF.md из docs/ROADMAP.json.
   BRIEF.md — контракт одной сессии: всё, что нужно, чтобы сделать дело, не читая переписку.
   Использование: node tools/make-briefs.mjs [case-08 ...]  (без аргументов — все дела из ROADMAP) */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const rm = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'ROADMAP.json'), 'utf8'));
const want = process.argv.slice(2).filter(a => /^case-\d\d$/.test(a));
const B = rm.limits;

function render(c) {
  const s = c.shape, l = B[c.profile];
  const rng = a => a[0] + '—' + a[1];
  const rows = [
    ['Профиль', c.profile + ' — ' + rm.profiles[c.profile]],
    ['Материалов', s.evidence + ' (норма профиля ' + rng(l.evidence) + ')'],
    ['из них стартовых', s.seeds + ' (валидатор требует 5—14)'],
    ['из них допросов (talk)', s.talk],
    ['Категорий', s.categories],
    ['Связей', s.links + ' (норма ' + rng(l.links) + ')'],
    ['Людей', s.persons + ' = ' + s.victims + ' жертва(ы) + ' + s.suspects + ' подозреваемых + ' + s.npc + ' npc (норма ' + rng(l.persons) + ')'],
    ['Подсказок', 6],
    ['Реконструкция', '12—15 абзацев'],
    ['Полей сдачи', 'ровно 5: culprit, place, window, weapon, motive'],
    ['Чтение улик', '~' + s.readK + ' тыс. знаков (норма ' + rng(l.readK) + ')'],
    ['playtimeMin', s.playtimeMin || c.playtimeMin + ' (норма ' + rng(l.playtimeMin) + ')'],
    ['SVG-схем', s.svg + ' (норма ' + rng(l.svg) + ')'],
    ['Рейтинг / тон', c.rating + ' / ' + c.tone],
    ['Сложность', c.difficulty]
  ];
  const idn = c.identity;
  const out = [];
  out.push('# BRIEF: дело № ' + c.num + ' «' + c.title + '»');
  out.push('');
  out.push('Этот файл — контракт. Он самодостаточен: читать переписку не нужно. Не редактируй его и не переноси в другое дело.');
  out.push('');
  out.push('- Каталог: `cases-wip/' + c.dir + '/`');
  out.push('- Тема: ' + c.theme);
  out.push('- Мир: ' + c.world);
  out.push('- Ниша (способ добычи вывода): ' + c.niche);
  out.push('');
  out.push('## Нормы этого дела');
  out.push('');
  out.push('| Параметр | Значение |');
  out.push('| --- | --- |');
  rows.forEach(r => out.push('| ' + r[0] + ' | ' + r[1] + ' |'));
  out.push('');
  out.push('Числа выше — закон для этого дела. `node tools/check-case.mjs ' + c.dir + '` сверит их с профилем `' + c.profile + '`.');
  out.push('');
  out.push('## Правда вечера (известна только тебе)');
  out.push('');
  out.push(c.truth);
  out.push('');
  out.push('В игре этого текста нет ни в одном материале: правда собирается игроком из `reveals` связей. Ни один материал не должен её пересказывать целиком — иначе пропадает расследование.');
  out.push('');
  out.push('## Зарезервированные имена (никто больше их не берёт)');
  out.push('');
  out.push('- Город / посёлок: ' + idn.city);
  out.push('- Places: ' + idn.places.join('; '));
  out.push('- Фирмы: ' + idn.firms.join('; '));
  out.push('- Транспорт: ' + idn.vehicles.join('; '));
  out.push('- Фамилии: ' + idn.surnames.join(', '));
  out.push('');
  out.push('Брать фамилии, улицы, номера машин, названия фирм и городов из `docs/MECHANICS.md` §2 и из чужих `cases/case-*/` **запрещено**. Если своих не хватает — придумывай новые, не подглядывая в соседние дела. Проверка: `node tools/check-case.mjs ' + c.dir + '` (сверяет с реестром) и `node tools/isolation.mjs`.');
  out.push('');
  out.push('## Три закона (правила репозитория, нарушение = переделка)');
  out.push('');
  out.push('1. В бумагах нет автора. Material — документ, запись, кадр, объяснение: у него есть подписант, бланк, штамп, дата. Никаких подытоживаний, оценок и «очевидно, что...». Вывод живёт только в `reveals` связей (`kind: note, chat, talk` — единственные места, где человек может рассуждать).');
  out.push('2. Материалы поступают постепенно: у каждого `after` — список улик, после прочтения которых он выдаётся; 5—14 стартовых; ни одной недостижимой; глубина ≤ 7; на одном шаге не больше 6 новых.');
  out.push('3. Мысль только в `reveals`: 200—500 знаков, связка двух конкретных материалов, без пересказа правды вечера целиком.');
  out.push('');
  out.push('## Порядок работы');
  out.push('');
  out.push('1. `node tools/new-case.mjs ' + c.dir + '` — скелет восьми файлов и папка `assets/` (если ещё не сделан).');
  out.push('2. `cases-wip/' + c.dir + '/DESIGN.md` — жертва, подозреваемые, правда вечера по часам, чем каждый подозреваемый подумает вместо виновника, что опровергает ложные следы, где алиби держится на минуте, из каких четырёх независимых источников складывается доказательство.');
  out.push('3. Карта улик: список из ' + s.evidence + ' материалов по ' + s.categories + ' категориям, у каждого — вид (`kind`), что доказывает, после чего выдаётся, ложные следы. Сперва карта, потом текст.');
  out.push('4. Восемь файлов: `01-core.js`, `02..06-evidence.js`, `07-links.js`, `08-final.js` по образцу `cases/case-07/`.');
  out.push('5. SVG-схемы в `assets/` (только руками, `viewBox`, `role=img`, `<title>`, `aria-label`); в `doc` только rel-путь.');
  out.push('6. Проверки: `node tools/check-case.mjs ' + c.dir + '` — обязано быть «все проверки пройдены». Затем `node tools/check-lookalike.mjs cases-wip/' + c.dir + '`.');
  out.push('7. Плейтест глазами: прочитай текст дела целиком и посчитай, сколько часов игрок потратит впустую на ложный след. Тулза карты дела заработает только после приёмки, когда дело попадёт в главную страницу.');
  out.push('8. Отчёт в чат: что сделано, результаты проверок, логлайн, форма сдачи (кто/где/когда/чем/зачем), что добавить в реестры на интеграции. Больше ничего.');
  out.push('');
  out.push('## Чего не трогать');
  out.push('');
  out.push('- `index.html`, `js/`, `css/`, `README.md`, `docs/` — их правит один интеграционный шаг после приёмки.');
  out.push('- `cases/` — там лежат принятые дела; свой черновик держи в `cases-wip/' + c.dir + '/`. Чужие дела не читай и не трогай (в том числе ради имён — фамилии бери из списка выше).');
  out.push('- `tools/` — если проверке не хватает правила, напиши об этом в отчёте, не правь чужой инструмент.');
  out.push('- git: никаких `init`, `add`, `commit`.');
  out.push('');
  out.push('## Приёмы, которые экономят часы');
  out.push('');
  out.push('- Время: все часы в деле должны сходиться до секунды. Одно расхождение — одна улика, а не атмосферная деталь.');
  out.push('- Одно число = один предмет (например «41» — только номер колодца, нигде больше).');
  out.push('- Терминология: 1—2 нишевых термина на весь текст, дальше по-русски.');
  out.push('- Артефакты: после каждой крупной записи прогоняй `node tools/check-lookalike.mjs cases-wip/' + c.dir + '` — в кириллический текст лезет латиница и иероглифы.');
  out.push('- Русские регулярки в терминале ломаются: временные скрипты клади в свою папку `%TEMP%\\opencode\\lane' + c.num + '` с расширением `.cjs`, файл пиши из узла через `fs.writeFileSync(..., "utf8")`, читай результат у себя в сессии инструментом файла, а не потоком терминала.');
  out.push('- Скрипты проверки не плоди: один `.cjs` на задачу, перезаписывай его.');
  out.push('');
  out.push('## Готовность к интеграции');
  out.push('');
  out.push('- [ ] `node tools/check-case.mjs ' + c.dir + '` → «все проверки пройдены»');
  out.push('- [ ] `node tools/check-lookalike.mjs cases-wip/' + c.dir + '` → 0');
  out.push('- [ ] файлов 8 + `DESIGN.md` + ' + s.svg + ' SVG в `assets/`');
  out.push('- [ ] в отчёте: 8 тегов `<script src>` для `index.html`, строка в таблицу `README.md`, строки в `docs/MECHANICS.md` §1 и §2, снимаемые строки в §3/§3.1');
  out.push('- [ ] прочитанное время уложилось в ' + (s.playtimeMin || c.playtimeMin) + ' ± 15 минут');
  out.push('');
  return out.join('\n') + '\n';
}

rm.cases.filter(c => !want.length || want.indexOf(c.dir) >= 0).forEach(c => {
  const dir = path.join(ROOT, 'briefs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, c.dir + '.md'), render(c), 'utf8');
  console.log('briefs/' + c.dir + '.md — профиль ' + c.profile + ', улик ' + c.shape.evidence + ', людей ' + c.shape.persons + ', жертв ' + c.shape.victims);
});
