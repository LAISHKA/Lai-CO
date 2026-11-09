/* ============================================================
   30-report.js — ЖУРНАЛ ОТЧЁТА (заказ T2, biz/briefs/T2-export-zhurnala.md)

   Товар — журнал решений, а не балл. Файл делает три вещи:
   1) дописывает таймкоды туда, чего нет в сейве дела: открытие материала
      (в том числе повторное), отметка на доске, подсказка, смена ответа в
      бланке, уход со страницы, сдача;
   2) склеивает их с готовым `protocol` сейва (`js/20-app.js` уже пишет
      ходатайства / повестки / связи / выемку) в единую хронологию;
   3) отдаёт её наружу: CSV на группу и печатную карточку на человека.

   Хранение: отдельный ключ `sr.journal.v1` (ФИО, группа, таймкоды). Сейв
   дела `sr.save.v1` не меняется — `js/00-store.js` и `cases/**` не тронуты.
   Публичная сборка (заказ T5): `window.SR_PUBLIC = true` или `?public=1` —
   тогда имён не собираем и выгрузку не отдаём.

   Файл обязан грузиться без DOM: tools/validate.mjs выполняет все
   <script src> из входных страниц (corp_game.html, Lai_CO.html) в заглушке окна.
   ============================================================ */
(function (root) {
  'use strict';

  var KEY = 'sr.journal.v1';
  var MAX_RUNS = 80;      // проходов на одной машине
  var MAX_EVENTS = 600;   // событий на проход
  var IDLE = 60000;       // пауза дольше минуты = «встал»

  /* ============================================================
     окружение и мелочи
     ============================================================ */
  function hasDom() {
    return typeof document !== 'undefined' && !!document
      && typeof document.getElementById === 'function';
  }
  function isPublic() {
    if (root.SR_PUBLIC === true) return true;
    try {
      return /[?&]public=1/.test((root.location && root.location.search) || '');
    } catch (e) { return false; }
  }
  var PUBLIC = isPublic();

  function x(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clockOf(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function dateOf(ts) {
    var d = new Date(ts);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function dur(ms) {
    var t = Math.max(0, Math.round((ms || 0) / 1000));
    var m = Math.floor(t / 60), s = t % 60;
    if (m >= 60) return Math.floor(m / 60) + ' ч ' + pad(m % 60) + ' мин';
    return m ? m + ' мин ' + pad(s) + ' с' : s + ' с';
  }
  /* минуты одной цифрой, запятая — под русскую Excel */
  function mins(ms) {
    if (!ms || ms < 0) return '';
    return (Math.round(ms / 6000) / 10).toString().replace('.', ',');
  }
  function median(list) {
    var a = list.slice().sort(function (p, q) { return p - q; });
    if (!a.length) return 0;
    var h = Math.floor(a.length / 2);
    return a.length % 2 ? a[h] : Math.round((a[h - 1] + a[h]) / 2);
  }

  /* ============================================================
     хранилище журнала
     ============================================================ */
  function blank() { return { who: { name: '', group: '' }, runs: [] }; }

  function load() {
    var j = blank();
    try {
      var raw = root.localStorage ? root.localStorage.getItem(KEY) : null;
      if (!raw) return j;
      var p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return j;
      if (p.who && typeof p.who === 'object') {
        j.who = { name: String(p.who.name || ''), group: String(p.who.group || '') };
      }
      if (Array.isArray(p.runs)) {
        j.runs = p.runs.filter(function (r) {
          return r && r.caseId && Array.isArray(r.events) && r.events.length;
        });
      }
    } catch (e) { /* пустой журнал — не беда */ }
    return j;
  }
  function save(j) {
    try {
      if (j.runs.length > MAX_RUNS) j.runs = j.runs.slice(j.runs.length - MAX_RUNS);
      if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(j));
    } catch (e) { /* переполнение приватного хранилища: отчёт просто не сохранится */ }
  }

  /* ============================================================
     доступ к делу и сейву (только чтение)
     ============================================================ */
  function defOf(id) {
    var cs = root.CASES || [];
    for (var i = 0; i < cs.length; i++) if (cs[i] && cs[i].id === id) return cs[i];
    return null;
  }
  function stateOf(id) {
    try {
      var st = root.STORE && root.STORE.load();
      return (st && st.cases && st.cases[id]) || null;
    } catch (e) { return null; }
  }
  function evTitle(def, id) {
    if (!id) return '';
    var list = (def && def.evidence) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title || id;
    return id;
  }
  function personName(def, pid) {
    if (!pid) return '';
    var list = (def && def.persons) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === pid) return list[i].short || list[i].name || pid;
    return pid;
  }
  function linkTitle(def, id) {
    var list = (def && def.contradictions) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title || id;
    return id || '';
  }
  function fieldsOf(def) { return (def && def.objective && def.objective.fields) || []; }
  function fieldLabel(def, fid) {
    var f = fieldsOf(def);
    for (var i = 0; i < f.length; i++) if (f[i].id === fid) return f[i].label || fid;
    return fid;
  }
  function optionLabel(def, fid, val) {
    var f = fieldsOf(def);
    for (var i = 0; i < f.length; i++) {
      if (f[i].id !== fid) continue;
      var o = f[i].options || [];
      for (var k = 0; k < o.length; k++) if (o[k][0] === val) return o[k][1];
    }
    return val || '';
  }
  /* верный виновник — из конфигурации дела, не из головы */
  function culpritId(def) {
    var f = fieldsOf(def);
    for (var i = 0; i < f.length; i++) if (f[i].id === 'culprit') return f[i].correct || null;
    return (def && def.crime && (def.crime.culprit || def.crime.person)) || null;
  }

  /* ============================================================
     сбор событий (вызывается из js/20-app.js)
     ============================================================ */
  var curCase = null;

  function lastRun(j, caseId) {
    for (var i = j.runs.length - 1; i >= 0; i--) if (j.runs[i].caseId === caseId) return j.runs[i];
    return null;
  }
  function newRun(j, caseId, startedAt) {
    var st = stateOf(caseId);
    var start = startedAt || (st && st.started) || Date.now();
    var r = {
      caseId: caseId,
      start: start,
      finish: 0,
      who: { name: j.who.name || '', group: j.who.group || '' },
      events: [{ t: 'start', ts: start }]
    };
    j.runs.push(r);
    return r;
  }
  function addEvent(run, e) {
    run.events.push(e);
    if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
  }

  function act(caseId, type, data) {
    try {
      if (!caseId || !type) return;
      var j = load();
      var run = lastRun(j, caseId);
      if (type === 'start') {
        curCase = caseId;
        if (run && !run.finish) {
          if (!run.who || (!run.who.name && !run.who.group)) run.who = { name: j.who.name, group: j.who.group };
          /* возврат в незавершённый проход: отдельное событие, только если отсутствовал дольше минуты */
          var gap = run.left ? Date.now() - run.left : 0;
          if (gap > IDLE) addEvent(run, { t: 'resume', ts: Date.now(), gap: gap });
          run.left = 0;
        } else {
          run = newRun(j, caseId);        /* newRun уже пишет событие start */
        }
        save(j);
        if (!PUBLIC && !(run.who && run.who.name)) askWho();
        return;
      }
      if (!run) run = newRun(j, caseId);
      if (type === 'pause') curCase = null;
      var e = { t: type, ts: Date.now() };
      if (data && typeof data === 'object') {
        for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) e[k] = data[k];
      } else if (data !== undefined && data !== null) {
        e.v = data;
      }
      /* повторное открытие того же материала подряд не плодим */
      var prev = run.events[run.events.length - 1];
      if (!(type === 'doc' && prev && prev.t === 'doc' && prev.v === e.v && e.ts - prev.ts < 1500)) addEvent(run, e);

      if (type === 'submit') run.finish = e.ts;
      if (type === 'pause') run.left = e.ts;
      save(j);

      if (type === 'start' && !PUBLIC && !(run.who && run.who.name)) askWho();
    } catch (err) { /* журнал не должен уронить игру ни при каких данных */ }
  }

  function forget(caseId) {
    try {
      var j = load();
      j.runs = j.runs.filter(function (r) { return r.caseId !== caseId; });
      save(j);
      if (curCase === caseId) curCase = null;
    } catch (e) { }
  }
  function wipeAll() {
    try { save(blank()); } catch (e) { }
  }
  function setWho(name, group) {
    var j = load();
    j.who = { name: String(name || '').slice(0, 80), group: String(group || '').slice(0, 80) };
    for (var i = 0; i < j.runs.length; i++) {
      if (!j.runs[i].finish) j.runs[i].who = { name: j.who.name, group: j.who.group };
    }
    save(j);
    if (hasDom() && isMine()) openReport();
  }

  /* ============================================================
     метрики прохода
     ============================================================ */
  function timeline(run, st) {
    var out = [];
    var i;
    for (i = 0; i < run.events.length; i++) out.push(run.events[i]);
    var pr = (st && st.protocol) || [];
    for (i = 0; i < pr.length; i++) if (pr[i] && pr[i].ts && pr[i].t !== 'submit') out.push(pr[i]);
    if (st && st.verdict && st.verdict.at) {
      var hasSubmit = out.some(function (e) { return e.t === 'submit'; });
      if (!hasSubmit) out.push({ t: 'submit', ts: st.verdict.at });
    }
    var seen = {}, ded = [];
    for (i = 0; i < out.length; i++) {
      var e = out[i];
      var key = [e.t, e.ts, e.ev || '', e.pid || '', e.id || '', e.n || '', e.field || '', e.v || ''].join('|');
      if (!seen[key]) { seen[key] = 1; ded.push(e); }
    }
    ded.sort(function (a, b) { return a.ts - b.ts; });
    return ded;
  }

  var FLAG_WORD = { watch: 'на наблюдении', clear: 'снята с подозрений', accused: 'обвиняется', '': 'отметка снята' };

  function label(def, e) {
    switch (e.t) {
      case 'start': return 'Взял в работу ' + ((def && def.num) || 'дело');
      case 'doc': return 'Открыл материал: ' + evTitle(def, e.v);
      case 'hook': return 'Ходатайство по «' + evTitle(def, e.ev) + '» → ' + (e.dir || '')
        + (e.who ? ' (на кого: ' + personName(def, e.who) + ')' : '');
      case 'summon': return 'Повестка на допрос: ' + personName(def, e.pid);
      case 'link': return 'Нашёл связь: ' + linkTitle(def, e.id);
      case 'reveal': return 'Вытребовал все материалы дела';
      case 'flag': return 'Доска: ' + personName(def, e.pid) + ' — ' + (FLAG_WORD[e.v] || e.v);
      case 'hint': return 'Взял подсказку № ' + (e.n || 1);
      case 'answer': return 'Бланк: ' + fieldLabel(def, e.field) + ' → ' + (optionLabel(def, e.field, e.value) || 'не установлено');
      case 'submit': return 'Сдал постановление';
      case 'away': return 'Ушёл со страницы';
      case 'back': return 'Вернулся на страницу';
      case 'pause': return 'Вышел в меню';
      case 'resume': return 'Вернулся к делу после перерыва ' + dur(e.gap || 0);
      default: return e.t;
    }
  }
  function shortLabel(def, e) {
    if (e.t === 'doc') return 'материале «' + evTitle(def, e.v) + '»';
    if (e.t === 'hint') return 'подсказке';
    if (e.t === 'submit') return 'сдаче';
    return label(def, e);
  }
  function docBefore(def, tl, idx) {
    for (var i = idx; i >= 0; i--) if (tl[i].t === 'doc') return evTitle(def, tl[i].v);
    return '';
  }

  /* «Где встал»: самая длинная пауза между реальными действиями.
     Время со скрытой вкладкой (ушёл из браузера) залипанием не считается. */
  function findStall(def, tl, endTs) {
    var pts = tl.slice();
    pts.push({ t: '__end', ts: endTs || Date.now() });
    var best = null;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (a.t === 'away' || a.t === 'pause') continue;   // уход из дела/со страницы — не «встал у материала»
      var gap = b.ts - a.ts;
      if (!(gap > 0)) continue;
      if (!best || gap > best.gap) best = { gap: gap, from: a, to: b, at: a.ts, idx: i };
    }
    if (!best || best.gap < IDLE) return { ms: best ? best.gap : 0, text: 'пауз дольше минуты не было' };
    var tail;
    if (best.to.t === '__end') tail = 'проход на этом закончен';
    else if (best.to.t === 'hint') tail = 'потом взял подсказку';
    else if (best.to.t === 'away') tail = 'потом закрыл вкладку';
    else if (best.to.t === 'submit') tail = 'потом сдал постановление';
    else tail = 'потом ' + shortLabel(def, best.to);
    var where = docBefore(def, pts, best.idx);
    var text = dur(best.gap) + ' — ' + (where ? 'материал «' + where + '»' : 'после: ' + shortLabel(def, best.from)) + '; ' + tail;
    return { ms: best.gap, text: text, where: where };
  }

  function metrics(run) {
    var def = defOf(run.caseId) || { id: run.caseId };
    var st = stateOf(run.caseId) || {};
    var tl = timeline(run, st);
    var start = (st.started && st.started < run.start) ? st.started : (run.start || (st.started || Date.now()));
    var verdict = st.verdict || null;
    var culprit = culpritId(def);

    /* время до ядра — первый момент, когда человек назвал ВЕРНОГО виновника:
       метка «обвиняется» на доске, выбор в бланке или сдача постановления */
    var coreTs = 0;
    for (var i = 0; i < tl.length; i++) {
      var e = tl[i];
      if (e.t === 'flag' && e.v === 'accused' && culprit && e.pid === culprit) { coreTs = e.ts; break; }
      if (e.t === 'answer' && e.field === 'culprit' && culprit && e.value === culprit) { coreTs = e.ts; break; }
      if (e.t === 'submit' && verdict && culprit && verdict.answer && verdict.answer.culprit === culprit) { coreTs = e.ts; break; }
    }

    var fields = fieldsOf(def);
    var near = 0;
    if (verdict && verdict.answer) {
      for (var k = 0; k < fields.length; k++) {
        var f = fields[k], g = verdict.answer[f.id];
        if (!g || g === f.correct) continue;
        if ((f.near || []).indexOf(g) >= 0) near++;
      }
    }

    /* конец прохода: сдача → уход в меню → оборванная сессия (в пустоту считаем не больше получаса) */
    var lastTs = tl.length ? tl[tl.length - 1].ts : start;
    var finish = run.finish || (verdict && verdict.at) || run.left || 0;
    var endTs = finish || Math.min(Date.now(), lastTs + 30 * 60000);
    var clockMs = st.clockMs || Math.max(0, endTs - start);
    var stall = findStall(def, tl, endTs);

    return {
      run: run, def: def, st: st, tl: tl,
      caseId: run.caseId,
      caseNum: def.num || run.caseId,
      caseTitle: def.title || '',
      name: (run.who && run.who.name) || '',
      group: (run.who && run.who.group) || '',
      start: start, finish: finish,
      clockMs: clockMs,
      reached: !!coreTs,
      coreMs: coreTs ? coreTs - start : 0,
      submitMs: verdict ? verdict.at - start : 0,
      submitted: !!verdict,
      win: !!(verdict && verdict.win),
      read: (st.read || []).length,
      total: (def.evidence || []).length,
      linksFound: (st.found || []).length,
      linksTotal: (def.contradictions || []).length,
      hooks: (st.hooks || []).length,
      summons: (st.calls || []).length,
      hints: st.hints || 0,
      hits: verdict ? verdict.hits : 0,
      fields: fields.length,
      near: near,
      score: verdict ? verdict.score : null,
      stallMs: stall.ms,
      stall: stall.text,
      hasDocTimes: tl.some(function (q) { return q.t === 'doc'; })
    };
  }

  function allMetrics() {
    var j = load(), out = [];
    for (var i = 0; i < j.runs.length; i++) out.push(metrics(j.runs[i]));
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  /* ============================================================
     CSV на группу
     ============================================================ */
  var CSV_HEAD = ['Сотрудник', 'Группа', 'Дело', 'Старт', 'Финиш', 'Время в деле, мин',
    'Дошёл до ядра', 'Время до ядра, мин', 'Где встал', 'Материалов прочитано', 'Материалов в деле',
    'Связей найдено', 'Связей в деле', 'Ходатайств', 'Повесток', 'Подсказок',
    'Полей верно', 'Полей близко', 'Балл'];

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvText(rows) {
    var lines = [CSV_HEAD.join(';')];
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i];
      lines.push([
        PUBLIC ? '' : m.name,
        PUBLIC ? '' : m.group,
        m.caseNum + ' «' + m.caseTitle + '»',
        dateOf(m.start),
        m.finish ? dateOf(m.finish) : '',
        mins(m.clockMs),
        m.reached ? 'да' : 'нет',
        mins(m.coreMs),
        m.stall,
        m.read, m.total,
        m.linksFound, m.linksTotal,
        m.hooks, m.summons, m.hints,
        m.submitted ? m.hits : '',
        m.submitted ? m.near : '',
        m.score === null ? '' : m.score
      ].map(csvCell).join(';'));
    }
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }
  function csvName() {
    var d = new Date();
    return 'zhurnal-otcheta-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.csv';
  }
  function downloadCsv(text) {
    var ok = false;
    try {
      var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = csvName();
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) { }
      }, 800);
      ok = true;
    } catch (e) { ok = false; }
    return ok;
  }

  /* ============================================================
     печатная карточка на человека
     ============================================================ */
  function kpiBlock(m) {
    return '<div class="rp-kpi">'
      + '<div class="rp-kpi-i"><b>' + (m.reached ? mins(m.coreMs) + ' мин' : 'не дошёл') + '</b><span>время до ядра</span></div>'
      + '<div class="rp-kpi-i"><b>' + m.read + ' / ' + m.total + '</b><span>материалов прочитано</span></div>'
      + '<div class="rp-kpi-i"><b>' + (m.stallMs >= IDLE ? dur(m.stallMs) : '—') + '</b><span>самая длинная пауза</span></div>'
      + '<div class="rp-kpi-i"><b>' + dur(m.clockMs) + '</b><span>время в деле</span></div>'
      + '</div>';
  }
  function factsBlock(m) {
    var rows = [
      ['Связей найдено', m.linksFound + ' из ' + m.linksTotal],
      ['Ходатайств подано', String(m.hooks)],
      ['Повесток выдано', String(m.summons)],
      ['Подсказок взято', String(m.hints)],
      ['Полей верно', m.submitted ? (m.hits + ' из ' + m.fields) : 'не сдано'],
      ['Полей близко', m.submitted ? String(m.near) : '—'],
      ['Балл', m.score === null ? '—' : String(m.score)],
      ['Итог', m.submitted ? (m.win ? 'дело раскрыто' : 'дело не раскрыто') : 'постановление не сдано']
    ];
    return '<table class="rp-facts">' + rows.map(function (r) {
      return '<tr><th>' + x(r[0]) + '</th><td>' + x(r[1]) + '</td></tr>';
    }).join('') + '</table>';
  }
  function chronoBlock(m) {
    if (!m.tl.length) return '<p class="rp-none">Событий нет.</p>';
    var def = m.def;
    return '<ol class="rp-tl">' + m.tl.map(function (e) {
      var extra = '';
      if (e.t === 'hook' && e.quote) extra = '<blockquote>' + x(String(e.quote).slice(0, 200)) + '</blockquote>';
      return '<li class="rp-tl-i">'
        + '<span class="rp-tl-c">' + clockOf(e.ts) + '</span>'
        + '<span class="rp-tl-m">+' + mins(e.ts - m.start) + ' мин</span>'
        + '<span class="rp-tl-x">' + x(label(def, e)) + extra + '</span>'
        + '</li>';
    }).join('') + '</ol>';
  }
  function cardHTML(m) {
    var meta = (m.def.meta || {});
    return '<article class="rp-card">'
      + '<header class="rp-head">'
      + '<div class="rp-org">' + x(meta.org || 'Служебное расследование') + '</div>'
      + '<h2 class="rp-h">Журнал отчёта</h2>'
      + '<div class="rp-sub">' + x(m.caseNum) + ' «' + x(m.caseTitle) + '»</div>'
      + '</header>'
      + '<div class="rp-who">'
      + '<div><span class="rp-l">Сотрудник:</span> <b>' + (x(m.name) || '<span class="rp-none">не указан</span>') + '</b></div>'
      + '<div><span class="rp-l">Группа:</span> <b>' + (x(m.group) || '<span class="rp-none">не указана</span>') + '</b></div>'
      + '<div><span class="rp-l">Начал:</span> ' + x(dateOf(m.start)) + '</div>'
      + '<div><span class="rp-l">Закончил:</span> ' + (m.finish ? x(dateOf(m.finish)) : 'в процессе') + '</div>'
      + '</div>'
      + kpiBlock(m)
      + '<h3 class="rp-h3">Где встал</h3>'
      + '<p class="rp-stall">' + x(m.stall) + '</p>'
      + '<h3 class="rp-h3">Итог работы с материалами</h3>'
      + factsBlock(m)
      + (m.hasDocTimes ? '' : '<p class="rp-note">Порядок открытия материалов записывается с версии движка 30-report; '
        + 'в этом проходе доступны только ходатайства, повестки и связи.</p>')
      + '<h3 class="rp-h3">Хронология решений</h3>'
      + chronoBlock(m)
      + '<footer class="rp-foot"><span>Журнал собран игрой локально, данные не покидают этот компьютер.</span>'
      + '<span class="rp-sign">Подпись проверяющего _______________</span></footer>'
      + '</article>';
  }

  function printCard(m) {
    var host = document.getElementById('rp-print');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rp-print';
      document.body.appendChild(host);
    }
    host.innerHTML = cardHTML(m);
    document.body.classList.add('rp-print');
    var done = function () {
      document.body.classList.remove('rp-print');
      try { root.removeEventListener('afterprint', done); } catch (e) { }
    };
    try { root.addEventListener('afterprint', done); } catch (e) { }
    setTimeout(function () {
      try { root.print(); } catch (e) { }
      setTimeout(done, 1500);
    }, 60);
  }

  /* ============================================================
     экраны (своя разметка внутри штатного оверлея движка)
     ============================================================ */
  function ov() { return hasDom() ? document.getElementById('overlay') : null; }
  function ovBody() { return hasDom() ? document.getElementById('overlay-body') : null; }
  function isMine() {
    var b = ovBody();
    return !!(b && b.querySelector('[data-ract]'));
  }
  function overlayOpen() {
    var o = ov();
    return !!(o && !o.classList.contains('hidden'));
  }
  function show(html) {
    var b = ovBody(), o = ov();
    if (!b || !o) return null;
    b.className = 'overlay-inner wide';
    b.innerHTML = html;
    o.classList.remove('hidden');
    var f = b.querySelector('[data-rfocus]');
    if (f) f.focus();
    return b;
  }
  function hideOverlay() {
    var o = ov();
    if (o) o.classList.add('hidden');
  }

  function whoForm() {
    var j = load();
    show('<div class="gate-icon">🧾</div>'
      + '<h2 class="ov-title">Кто работает с делом</h2>'
      + '<p class="ov-sub">Нужно, чтобы потом собрать таблицу на группу: кто дошёл, сколько читал, где встал. '
      + 'Записывается только в этот браузер, никуда не отправляется.</p>'
      + '<div class="rp-who-form">'
      + '<label class="rp-fl">Сотрудник<input class="rp-in" id="rp-name" value="' + x(j.who.name) + '" placeholder="Фамилия И. О." data-rfocus></label>'
      + '<label class="rp-fl">Группа<input class="rp-in" id="rp-group" value="' + x(j.who.group) + '" placeholder="напр. Бухгалтерия"></label>'
      + '</div>'
      + '<div class="ov-foot">'
      + '<button class="btn ghost" data-ract="who-skip">Пропустить</button>'
      + '<button class="btn primary" data-ract="who-save">Начать работу</button>'
      + '</div>');
  }
  var whoTimer = null;
  function askWho() {
    if (PUBLIC || !hasDom() || whoTimer) return;
    var tries = 0;
    whoTimer = setInterval(function () {
      tries++;
      if (overlayOpen()) {                 // движок показывает брифинг/шлюз — подождать
        if (tries > 400) { clearInterval(whoTimer); whoTimer = null; }
        return;
      }
      clearInterval(whoTimer); whoTimer = null;
      whoForm();
    }, 250);
  }

  function summaryBlock(rows) {
    var done = rows.filter(function (m) { return m.submitted; });
    var reached = rows.filter(function (m) { return m.reached; });
    var med = median(reached.map(function (m) { return m.coreMs; }));
    return '<div class="rp-sum">'
      + '<span>Проходов: <b>' + rows.length + '</b></span>'
      + '<span>Дошли до ядра: <b>' + reached.length + ' / ' + rows.length + '</b></span>'
      + '<span>Медиана времени до ядра: <b>' + (med ? mins(med) + ' мин' : '—') + '</b></span>'
      + '<span>Сдали постановление: <b>' + done.length + '</b></span>'
      + '</div>';
  }

  function tableBlock(rows) {
    if (!rows.length) {
      return '<p class="rp-none">Проходов ещё нет. Откройте дело, поработайте с материалами — здесь появится строка на человека.</p>';
    }
    var head = '<tr><th>Сотрудник</th><th>Группа</th><th>Дело</th><th>До ядра</th><th>Читал</th><th>Подсказок</th><th>Где встал</th><th></th></tr>';
    var body = rows.map(function (m, i) {
      return '<tr>'
        + '<td>' + (x(m.name) || '<span class="rp-none">не указан</span>') + '</td>'
        + '<td>' + x(m.group) + '</td>'
        + '<td>' + x(m.caseNum) + '</td>'
        + '<td class="rp-num">' + (m.reached ? mins(m.coreMs) + ' мин' : '<span class="rp-bad">не дошёл</span>') + '</td>'
        + '<td class="rp-num">' + m.read + '/' + m.total + '</td>'
        + '<td class="rp-num">' + m.hints + '</td>'
        + '<td class="rp-stall-c">' + x(m.stall) + '</td>'
        + '<td class="rp-act"><button class="btn ghost sm" data-ract="card" data-i="' + i + '">Карточка</button></td>'
        + '</tr>';
    }).join('');
    return '<div class="rp-scroll"><table class="rp-table">' + head + body + '</table></div>';
  }

  function openReport() {
    if (PUBLIC) return;      // в публичной сборке экрана отчёта не бывает вовсе
    var rows = allMetrics();
    var j = load();
    var whoFields = PUBLIC ? ''
      : '<div class="rp-who-form">'
      + '<label class="rp-fl">Сотрудник<input class="rp-in" id="rp-name" value="' + x(j.who.name) + '" placeholder="Фамилия И. О." data-rchange="1"></label>'
      + '<label class="rp-fl">Группа<input class="rp-in" id="rp-group" value="' + x(j.who.group) + '" placeholder="напр. Бухгалтерия" data-rchange="1"></label>'
      + '</div>';
    var foot = '<div class="ov-foot rp-foot-btns">'
      + (PUBLIC ? '' : '<button class="btn primary" data-ract="csv">Скачать CSV на группу</button>')
      + '<button class="btn ghost" data-ract="wipe">Очистить журнал</button>'
      + '<button class="btn ghost" data-ract="close">Закрыть</button>'
      + '</div>';
    show('<div class="gate-icon">📋</div>'
      + '<h2 class="ov-title">Журнал отчёта</h2>'
      + '<p class="ov-sub">Что человек читал, в каком порядке, где брал подсказку и где встал. Балл — самое неинтересное в этой таблице.</p>'
      + whoFields
      + summaryBlock(rows)
      + tableBlock(rows)
      + '<p class="rp-note">Все данные лежат в этом браузере (ключ sr.journal.v1) и никуда не отправляются. '
      + 'CSV открывается в Excel, разделитель «;».</p>'
      + foot);
    if (!PUBLIC) bindWhoInputs();
    var b = ovBody();
    if (b) b._rpRows = rows;
  }

  function openCard(i) {
    var rows = ovBody() && ovBody()._rpRows ? ovBody()._rpRows : allMetrics();
    var m = rows[i];
    if (!m) return openReport();
    show('<h2 class="ov-title">Карточка: ' + x(m.name || 'сотрудник') + ' · ' + x(m.caseNum) + '</h2>'
      + '<p class="ov-sub">Печатается как есть: Ctrl-P или кнопка ниже.</p>'
      + '<div class="rp-wrap">' + cardHTML(m) + '</div>'
      + '<div class="ov-foot rp-foot-btns">'
      + '<button class="btn primary" data-ract="print" data-i="' + i + '">Печать карточки</button>'
      + '<button class="btn ghost" data-ract="back-list">Назад к журналу</button>'
      + '</div>');
    var b = ovBody();
    if (b) b._rpRows = rows;
  }

  function bindWhoInputs() {
    var n = document.getElementById('rp-name'), g = document.getElementById('rp-group');
    if (!n || !g || n._rpBound) return;
    n._rpBound = g._rpBound = true;
    var t = null;
    var on = function () {
      clearTimeout(t);
      t = setTimeout(function () {
        var j = load();
        j.who = { name: n.value.slice(0, 80), group: g.value.slice(0, 80) };
        for (var i = 0; i < j.runs.length; i++) if (!j.runs[i].finish) j.runs[i].who = { name: j.who.name, group: j.who.group };
        save(j);
      }, 400);
    };
    n.addEventListener('input', on);
    g.addEventListener('input', on);
  }

  /* ============================================================
     обработчики
     ============================================================ */
  function onOverlayClick(e) {
    var b = e.target.closest ? e.target.closest('[data-ract]') : null;
    if (!b) return;
    var a = b.getAttribute('data-ract');
    if (a === 'close') { hideOverlay(); return; }
    if (a === 'who-save' || a === 'who-skip') {
      if (a === 'who-save') {
        var n = document.getElementById('rp-name'), g = document.getElementById('rp-group');
        if (n && g) { setWho(n.value, g.value); }
      }
      hideOverlay();
      return;
    }
    if (a === 'csv') {
      var text = csvText(allMetrics());
      if (!downloadCsv(text)) {
        var body = ovBody();
        if (body) {
          var box = body.querySelector('.rp-scroll');
          if (box) box.innerHTML = '<p class="rp-note">Выгрузка не разрешилась — скопируйте текст в блокнот и сохраните как <b>otchet.csv</b>:</p>'
            + '<textarea class="rp-csv" rows="12" readonly>' + x(text) + '</textarea>';
        }
      }
      return;
    }
    if (a === 'wipe') {
      if (root.confirm && root.confirm('Стереть журнал отчёта на этом компьютере? Сейвы дел не трогаются.')) {
        wipeAll();
        openReport();
      }
      return;
    }
    if (a === 'card') { openCard(parseInt(b.getAttribute('data-i'), 10) || 0); return; }
    if (a === 'print') {
      var rows = (ovBody() && ovBody()._rpRows) || allMetrics();
      printCard(rows[parseInt(b.getAttribute('data-i'), 10) || 0]);
      return;
    }
    if (a === 'back-list') { openReport(); return; }
  }

  function onAnswerChange(e) {
    var el = e.target;
    if (!el || el.nodeName !== 'SELECT' || !el.getAttribute) return;
    var fid = el.getAttribute('data-field');
    if (!fid || !curCase) return;
    act(curCase, 'answer', { field: fid, value: el.value || '' });
  }

  function onVisibility() {
    if (!curCase) return;
    act(curCase, document.hidden ? 'away' : 'back');
  }

  function bind() {
    var o = ov();
    if (o) o.addEventListener('click', onOverlayClick);
    var vb = document.getElementById('verdict-body');
    if (vb) vb.addEventListener('change', onAnswerChange);
    ['btn-report', 'btn-report-menu'].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b) return;
      if (PUBLIC) { b.style.display = 'none'; return; }
      b.addEventListener('click', function () { openReport(); });
    });
    if (document.addEventListener) document.addEventListener('visibilitychange', onVisibility);
  }

  /* ============================================================
     наружу
     ============================================================ */
  var api = {
    version: '1',
    isPublic: PUBLIC,
    act: act,
    forget: forget,
    who: function () { return load().who; },
    setWho: setWho,
    runs: allMetrics,
    metrics: metrics,
    csv: function () { return csvText(allMetrics()); },
    card: function (i) {
      var rows = allMetrics();
      return cardHTML(rows[typeof i === 'number' ? i : rows.length - 1]);
    },
    open: openReport,
    bind: bind
  };
  root.REPORT = api;

  if (!hasDom()) return;   // tools/validate.mjs: файл грузится в заглушке окна без DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})(typeof window !== 'undefined' ? window : globalThis);
