/* ============================================================
   15-hook-engine.js — правила расследования (чистые функции)

   СМЫСЛ. Новый материал поступает ТОЛЬКО за оформленную зацепку:
   игрок выделяет фрагмент ПРОЧИТАННОГО документа и выбирает
   НАПРАВЛЕНИЕ проверки. Основанием считается указывающее слово —
   такое, которым предок и дети говорят об одном и том же (камера,
   пропуск, фамилия, номер партии). Направления, где общего слова
   нет, проверить нельзя: они открываются автоклапаном.

   Данные: after (ребёнок <- предки), keys, cat, tags, contradictions.
   Протокол допроса (kind === 'talk') зацепкой НЕ приходит: зацепка в
   «Допросы» выводит на ЛИЦО, бумага приходит после вызова повесткой.
   Никакого DOM. case-01 проходит детерминированно.
   ============================================================ */
(function (root) {
  'use strict';

  var STOP = ('этого которой чтобы когда самом этом очень также между после около через ' +
    'насчёт которые другой другие может нужно надо были всего всех только нельзя будто ' +
    'наконец поэтому однако потому является является данный данная данные работа время ' +
    'материал документы документ осмотр протокол заключение акт справка лист графа ' +
    'число сумма размер количество часть конец начало').split(/\s+/);
  var STOPMAP = {};
  STOP.forEach(function (w) { STOPMAP[w.replace(/ё/g, 'е')] = 1; });

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е');
  }

  /* Слова-указатели: буквы и цифры, от 5 знаков. Голые числа не в счёт. */
  function words(text) {
    var raw = norm(text).replace(/[^a-z0-9а-я]+/g, ' ');
    var out = {};
    raw.split(/ +/).forEach(function (t) {
      if (t.length < 5) return;
      if (STOPMAP[t]) return;
      if (/^[0-9]+$/.test(t)) return;
      out[t] = 1;
    });
    return out;
  }

  function wordList(text) { return Object.keys(words(text)); }

  function joinKeys(list) {
    return (list || []).map(function (k) { return String(k); }).join(' · ');
  }

  /* ---------------- кэш и базовые разборщики ---------------- */

  var CACHE = {};

  function docText(doc) {
    if (doc == null) return '';
    if (typeof doc === 'string') return doc;
    var out = [];
    (function walk(v, depth) {
      if (depth > 6 || v == null) return;
      if (typeof v === 'string' || typeof v === 'number') { out.push(String(v)); return; }
      if (Array.isArray(v)) { v.forEach(function (x) { walk(x, depth + 1); }); return; }
      if (typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k], depth + 1); });
    })(doc, 0);
    return out.join(' . ');
  }

  function personById(def, pid) {
    var list = (def && def.persons) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === pid) return list[i];
    return null;
  }

  function evidenceById(def, id) {
    var list = (def && def.evidence) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function linkById(def, id) {
    var list = (def && def.contradictions) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function tagNames(def, e) {
    return (e.tags || []).map(function (pid) {
      var p = personById(def, pid);
      return p ? (p.short + ' ' + p.name + ' ' + p.role) : '';
    }).join(' ');
  }

  function stripTags(html) {
    return String(html == null ? '' : html)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[#0-9a-zA-Z]+;/g, ' ')
      .replace(/\\s+/g, ' ');
  }

  /* Текст, который игрок РЕАЛЬНО видит в читалке. Без этого зацепка могла
     висеть на слове из keys или из имени тега, которого в корпусе нет. */
  function renderedText(def, e) {
    var ck = 'vis#' + def.id + '#' + e.id;
    if (CACHE[ck] !== undefined) return CACHE[ck];
    var D = root.DOCS || null;
    var t = '';
    if (D && typeof D.render === 'function') {
      try { t = stripTags(D.render(e)); } catch (err) { t = ''; }
    }
    CACHE[ck] = t;
    return t;
  }

  /* чем материал говорит сам о себе: напечатанный корпус, а если рендера нет —
     шапка + корпус + теги + keys (фолбэк для тулз без js/10-docs.js) */
  function ownText(def, e) {
    var ck = 'own#' + def.id + '#' + e.id;
    if (CACHE[ck]) return CACHE[ck];
    var vis = renderedText(def, e);
    CACHE[ck] = vis.length > 60 ? vis
      : [e.title, e.where, e.cat, joinKeys(e.keys), tagNames(def, e), docText(e.doc)].join(' . ');
    return CACHE[ck];
  }

  /* сигнатура ребёнка: только его «адрес» — чем он отличается от прочего дела */
  function childSig(def, e) {
    var ck = 'sig#' + def.id + '#' + e.id;
    if (CACHE[ck]) return CACHE[ck];
    CACHE[ck] = [e.title, e.where, e.cat, joinKeys(e.keys), tagNames(def, e)].join(' . ');
    return CACHE[ck];
  }

  /* частотность слова по делу: общее слово («планировка», «смена») — не указатель */
  function caseDf(def) {
    var ck = 'df#' + def.id;
    if (CACHE[ck]) return CACHE[ck];
    var df = {}, n = (def.evidence || []).length || 1;
    (def.evidence || []).forEach(function (e) {
      var w = words(childSig(def, e));
      Object.keys(w).forEach(function (x) { df[x] = (df[x] || 0) + 1; });
    });
    var generic = {};
    Object.keys(df).forEach(function (x) { if (df[x] / n > 0.35) generic[x] = 1; });
    CACHE[ck] = generic;
    return generic;
  }

  /* ---------------- направления ---------------- */

  function isRoot(e) { return !(e.after && e.after.length); }

  function childrenOf(def, predId) {
    var out = [];
    (def.evidence || []).forEach(function (e) {
      if (e.after && e.after.indexOf(predId) >= 0) out.push(e);
    });
    return out;
  }

  function directions(def, predId) {
    var pred = evidenceById(def, predId);
    if (!pred) return [];
    var ptext = words(ownText(def, pred));
    var generic = caseDf(def);
    var byCat = {}, order = [];
    childrenOf(def, predId).forEach(function (child) {
      var cat = child.cat || 'Материалы';
      if (!byCat[cat]) { byCat[cat] = { cat: cat, count: 0, words: {}, ids: [] }; order.push(cat); }
      byCat[cat].count++;
      byCat[cat].ids.push(child.id);
      var sw = words(childSig(def, child));
      Object.keys(sw).forEach(function (w) {
        if (ptext[w] && !generic[w]) byCat[cat].words[w] = 1;
      });
    });
    var res = order.map(function (c) { return byCat[c]; });
    res.sort(function (a, b) { return b.count - a.count; });
    return res;
  }

  /* категория доступна как направление (есть чем обосновать) */
  function checkable(def, predId, cat) {
    var d = directions(def, predId).filter(function (x) { return x.cat === cat; })[0];
    return !!(d && Object.keys(d.words).length);
  }

  /* ложные направления: категорий предка нет, но они есть в деле */
  function dummies(def, predId, count) {
    var real = {};
    directions(def, predId).forEach(function (d) { real[d.cat] = 1; });
    var pool = [];
    (def.evidence || []).forEach(function (e) {
      var c = e.cat || 'Материалы';
      if (real[c] || pool.indexOf(c) >= 0) return;
      pool.push(c);
    });
    return pool.slice(0, count || 2);
  }

  function catStem(cat) {
    var c = norm(cat).replace(/[^a-z0-9а-я]+/g, '');
    return c.length <= 4 ? c : c.slice(0, c.length - 1);
  }

  /* ---------------- судья: есть ли основание ---------------- */

  function judge(def, predId, cat, quote) {
    var dir = directions(def, predId).filter(function (d) { return d.cat === cat; })[0];
    if (!dir) return { ok: false, matched: [], ids: [], reason: 'нет-такого-направления' };
    var qw = words(quote);
    var matched = Object.keys(qw).filter(function (w) { return dir.words[w]; });
    if (matched.length) return { ok: true, matched: matched, ids: dir.ids };
    /* мягкие основания: название направления или фамилия из детей */
    var q = norm(quote), stem = catStem(cat), byCat = stem.length >= 4 && q.indexOf(stem) >= 0;
    var byName = false, names = [];
    dir.ids.forEach(function (id) {
      var e = evidenceById(def, id);
      if (!e) return;
      (e.tags || []).forEach(function (pid) {
        var p = personById(def, pid);
        if (!p) return;
        [norm(p.name).split(/ +/)[0], norm(p.short).split(/ +/).pop()].forEach(function (last) {
          if (last && last.length >= 4 && q.indexOf(last) >= 0) { byName = true; names.push(last); }
        });
      });
    });
    if (byCat || byName) return { ok: true, matched: [byCat ? cat : names[0]], ids: dir.ids, soft: true };
    return { ok: false, matched: [], ids: dir.ids, reason: 'нет-указывающего-слова' };
  }

  /* подсказка в тексте цитаты — отмечаем в протокол, но не отказываем:
     подсказка и так стоит игроку очков */
  function quotedFromHint(def, quote) {
    var q = norm(quote).replace(/[^a-z0-9а-я ]/g, ' ');
    var hs = (def.hints || []).map(function (h) { return norm(h.text || ''); }).join(' ');
    var ws = Object.keys(words(q));
    if (!ws.length) return false;
    return ws.every(function (w) { return hs.indexOf(w) >= 0; });
  }

  /* ---------------- оформленные зацепки ---------------- */

  function hookOf(st, predId, cat) {
    var hs = st.hooks || [];
    for (var i = 0; i < hs.length; i++) if (hs[i].ev === predId && hs[i].dir === cat) return hs[i];
    return null;
  }

  function personIn(def, evId, pid) {
    var e = evidenceById(def, evId);
    return !!(e && e.tags && e.tags.indexOf(pid) >= 0);
  }

  function grantedIds(def, st) {
    var open = {};
    (st.hooks || []).forEach(function (h) {
      if (!h.ok) return;
      directions(def, h.ev).forEach(function (d) {
        if (d.cat !== h.dir) return;
        d.ids.forEach(function (id) {
          if (h.who && !personIn(def, id, h.who)) return;
          var e = evidenceById(def, id);
          if (e && e.kind === 'talk') return; /* протокол — только по повестке */
          open[id] = 1;
        });
      });
    });
    return open;
  }

  /* к чему зацепка уже подвела, но для этого нужен вызов на допрос */
  function pendingTalks(def, st) {
    var seen = {}, out = {};
    (st.read || []).forEach(function (id) { seen[id] = 1; });
    (st.hooks || []).forEach(function (h) {
      if (!h.ok) return;
      directions(def, h.ev).forEach(function (d) {
        if (d.cat !== h.dir) return;
        d.ids.forEach(function (id) {
          if (h.who && !personIn(def, id, h.who)) return;
          var e = evidenceById(def, id);
          if (!e || e.kind !== 'talk' || seen[id]) return;
          out[id] = e;
        });
      });
    });
    return out;
  }

  function calledMap(st) {
    var called = {};
    (st.calls || []).forEach(function (c) { called[typeof c === 'string' ? c : c.pid] = 1; });
    return called;
  }

  /* вызов на допрос: кого зовём и какие протоколы это принесёт */
  function summonsTargets(def, st) {
    var known = knownPersons(def, st), called = calledMap(st);
    var talks = pendingTalks(def, st);
    var byPerson = {};
    Object.keys(talks).forEach(function (id) {
      var tags = talks[id].tags || [];
      tags.forEach(function (pid) {
        if (!known[pid]) return;
        (byPerson[pid] = byPerson[pid] || []).push(id);
      });
    });
    var out = [];
    Object.keys(byPerson).forEach(function (pid) {
      if (called[pid]) return;
      var p = personById(def, pid);
      if (!p || p.kind === 'victim') return;
      out.push({ person: p, count: byPerson[pid].length, ids: byPerson[pid] });
    });
    out.sort(function (a, b) { return b.count - a.count || String(a.person.name).localeCompare(String(b.person.name), 'ru'); });
    return out;
  }

  /* что даст повестка конкретному лицу (до того, как она оформлена) */
  function afterSummons(def, st, pid) {
    var talks = pendingTalks(def, st);
    return Object.keys(talks).filter(function (id) { return (talks[id].tags || []).indexOf(pid) >= 0; });
  }

  /* ---------------- доступность материалов ---------------- */

  /*
     1) корневой материал — с начала дела;
     2) на предка оформленная зацепка с основанием;
     3) найдена связь, где материал — второй;
     4) автоклапан: все предки прочитаны, а обосновать направление
        словами нельзя (иначе это тупик);
     5) revealAll — ходатайство о выемке всего, дорого.
  */
  function availableSet(def, st) {
    var open = {}, read = {};
    if (st.revealAll) {
      (def.evidence || []).forEach(function (e) { open[e.id] = 1; });
      return open;
    }
    /* то, что уже на руках, из папки дела никуда не исчезает */
    (st.read || []).forEach(function (id) { read[id] = 1; open[id] = 1; });

    (def.evidence || []).forEach(function (e) { if (isRoot(e)) open[e.id] = 1; });
    var g = grantedIds(def, st);
    Object.keys(g).forEach(function (id) { open[id] = 1; });
    (st.found || []).forEach(function (lid) {
      var l = linkById(def, lid);
      if (l && l.b) open[l.b] = 1;
    });
    /* протокол допроса приходит ПОСЛЕ вызова: зацепка выводит на лицо,
       повестка приносит бумагу. Если звать некого — приходит сама. */
    var talks = pendingTalks(def, st);
    var known = knownPersons(def, st);
    var called = calledMap(st);
    Object.keys(talks).forEach(function (id) {
      var tags = talks[id].tags || [];
      var anyKnown = tags.some(function (pid) { return known[pid] && personById(def, pid) && personById(def, pid).kind !== 'victim'; });
      if (!anyKnown || tags.some(function (pid) { return called[pid]; })) open[id] = 1;
    });
    (def.evidence || []).forEach(function (e) {
      if (open[e.id] || isRoot(e) || e.autovalve === false) return;
      if (!(e.after || []).length || !e.after.every(function (id) { return read[id]; })) return;
      var canArgue = e.after.some(function (pid) {
        var d = directions(def, pid).filter(function (x) { return x.ids.indexOf(e.id) >= 0; })[0];
        return !!(d && Object.keys(d.words).length);
      });
      if (!canArgue) open[e.id] = 1;
    });
    return open;
  }

  function lockedInfo(def, st) {
    var av = availableSet(def, st), locked = 0, ready = 0;
    (def.evidence || []).forEach(function (e) {
      if (av[e.id]) return;
      locked++;
      var allRead = (e.after || []).every(function (id) { return (st.read || []).indexOf(id) >= 0; });
      if (allRead) ready++;
    });
    return { locked: locked, ready: ready };
  }

  /* направления, по которым предок ещё не отработан */
  function pendingDirections(def, st, predId) {
    var av = availableSet(def, st);
    var out = [];
    directions(def, predId).forEach(function (d) {
      /* зацепка с человеком прикрывает только его материалы: направление
         остаётся в работе, пока хоть что-то из него не на руках */
      var unread = d.ids.filter(function (id) { return !av[id] || !(st.read || []).some(function (x) { return x === id; }); });
      if (unread.length) out.push(d);
    });
    return out;
  }

  /* ---------------- волны людей ---------------- */

  function knownPersons(def, st) {
    var known = {}, read = {};
    (st.read || []).forEach(function (id) { read[id] = 1; });
    (def.persons || []).forEach(function (p) { if (p.kind === 'victim') known[p.id] = 'потерпевший'; });
    (def.evidence || []).forEach(function (e) {
      if (!read[e.id]) return;
      (e.tags || []).forEach(function (pid) { if (!known[pid]) known[pid] = 'упомянут в материале'; });
    });
    (st.found || []).forEach(function (lid) {
      var l = linkById(def, lid);
      if (!l || !l.flags) return;
      Object.keys(l.flags).forEach(function (pid) { if (!known[pid]) known[pid] = 'из противоречия'; });
    });
    (st.calls || []).forEach(function (c) { if (!known[c.pid]) known[c.pid] = 'повестка'; });
    if (st.revealAll) (def.persons || []).forEach(function (p) { if (!known[p.id]) known[p.id] = 'полная выемка'; });
    return known;
  }

  function personOrder(def, st) {
    var known = knownPersons(def, st);
    var rank = { suspect: 0, victim: 1, npc: 2 };
    return (def.persons || []).filter(function (p) { return known[p.id]; })
      .sort(function (a, b) {
        var d = (rank[a.kind] == null ? 3 : rank[a.kind]) - (rank[b.kind] == null ? 3 : rank[b.kind]);
        return d !== 0 ? d : String(a.name).localeCompare(String(b.name), 'ru');
      });
  }

  /* ---------------- статика для приёмки ---------------- */

  function stats(def, st) {
    var av = availableSet(def, st);
    var opened = 0, read = 0;
    (def.evidence || []).forEach(function (e) {
      if (av[e.id]) opened++;
      if (st.read && st.read.indexOf(e.id) >= 0) read++;
    });
    return { opened: opened, read: read, total: (def.evidence || []).length };
  }

  function reset() { CACHE = {}; }

  root.HOOKS = {
    words: words,
    wordList: wordList,
    ownText: ownText,
    renderedText: renderedText,
    childSig: childSig,
    directions: directions,
    checkable: checkable,
    dummies: dummies,
    judge: judge,
    quotedFromHint: quotedFromHint,
    hookOf: hookOf,
    grantedIds: grantedIds,
    pendingTalks: pendingTalks,
    calledMap: calledMap,
    availableSet: availableSet,
    lockedInfo: lockedInfo,
    pendingDirections: pendingDirections,
    knownPersons: knownPersons,
    personOrder: personOrder,
    summonsTargets: summonsTargets,
    afterSummons: afterSummons,
    childrenOf: childrenOf,
    isRoot: isRoot,
    evidenceById: evidenceById,
    linkById: linkById,
    personById: personById,
    stats: stats,
    reset: reset
  };
})(typeof window !== 'undefined' ? window : globalThis);
