/* ============================================================
   20-app.js — движок расследования
   Движок не знает сюжет: он читает root.CASES и рисует.
   ============================================================ */
(function (root) {
  'use strict';

  var STORE = root.STORE, DOCS = root.DOCS, CASES = root.CASES;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    menu: $('view-menu'), list: $('case-list'),
    view: $('view-case'), tbTitle: $('tb-title'), tbSub: $('tb-sub'),
    tbFound: $('tb-found'), tbTotal: $('tb-total'), tbClock: $('tb-clock'), tbRead: $('tb-read'),
    search: $('ev-search'), filters: $('ev-filters'), evList: $('ev-list'),
    btnUnread: $('btn-unread'), btnDensity: $('btn-density'), btnFocus: $('btn-focus'), btnScope: $('btn-scope'),
    trayItems: $('tray-items'), btnCompare: $('btn-compare'),
    reader: $('reader'), readerTitle: $('reader-title'), readerIdx: $('reader-idx'),
    overlay: $('overlay'), overlayBody: $('overlay-body'), toast: $('toast'),
    panelPersons: $('panel-persons'), panelClues: $('panel-clues'),
    panelTimeline: $('panel-timeline'), notesArea: $('notes-area')
  };

  var S = {
    def: null,          // описание дела
    st: null,           // прогресс
    cur: null,          // id открытой улики
    cat: '__all',       // фильтр категории
    onlyUnread: false,  // фильтр «только непрочитанное»
    query: '',
    tray: [],           // ulika ids для сравнения (не больше 2)
    avail: null,        // id улик, открытые в деле (прогрессивный доступ)
    fresh: [],          // id, ставшие доступными в этой сессии (бейдж «новая»)
    tick: null,
    lastTick: 0
  };

  /* ============================================================
     мелкие утилиты
     ============================================================ */
  function esc(str) { return String(str == null ? '' : str); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fmtClock(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s2 = t % 60;
    return (h ? h + ':' : '') + pad(m) + ':' + pad(s2);
  }

  var toastTimer = null;
  function toast(msg, kind) {
    ui.toast.innerHTML = msg;
    ui.toast.className = 'toast' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.className = 'toast hidden'; }, 4200);
  }

  var overlayCloser = null;
  function openOverlay(html, opts) {
    opts = opts || {};
    ui.overlayBody.className = 'overlay-inner' + (opts.wide ? ' wide' : '');
    ui.overlayBody.innerHTML = html;
    ui.overlay.classList.remove('hidden');
    overlayCloser = opts.onClose || null;
    var f = ui.overlayBody.querySelector('[data-focus]');
    if (f) f.focus();
    return ui.overlayBody;
  }
  function closeOverlay() {
    ui.overlay.classList.add('hidden');
    ui.overlayBody.innerHTML = '';
    if (overlayCloser) { var c = overlayCloser; overlayCloser = null; c(); }
  }
  function overlayOpen() { return !ui.overlay.classList.contains('hidden'); }

  /* делегирование кликов внутри оверлея */
  ui.overlay.addEventListener('click', function (e) {
    if (e.target === ui.overlay) { closeOverlay(); return; }
    var act = e.target.closest('[data-act]');
    if (!act) return;
    var a = act.getAttribute('data-act');
    if (a === 'close-overlay') closeOverlay();
    else if (a === 'open-case') { startCase(act.getAttribute('data-id')); }
    else if (a === 'erase') { eraseAll(); }
    else if (a === 'hint-real') { giveHint(); }
    else if (a === 'reveal-real') { doRevealAll(); }
    else if (a === 'accuse-open') { openAccuse(); }
    else if (a === 'accuse-send') { submitVerdict(); }
    else if (a === 'show-evidence') { closeOverlay(); openEvidence(act.getAttribute('data-id')); }
    else if (a === 'show-person') { closeOverlay(); switchTab('persons'); showPerson(act.getAttribute('data-id')); }
    else if (a === 'flag-person') { flagPerson(act.getAttribute('data-id'), act.getAttribute('data-v'), true); }
    else if (a === 'play-again') { resetCase(); }
    else if (a === 'print') { window.print(); }
    else if (a === 'to-menu') { closeOverlay(); toMenu(); }
  });

  /* ============================================================
     ТИТУЛЬНЫЙ ЭКРАН
     ============================================================ */
  function renderMenu() {
    if (!CASES || !CASES.length) {
      ui.list.innerHTML = '<p class="muted">Дела не подключены. Проверьте теги &lt;script&gt; в index.html.</p>';
      return;
    }
    ui.list.innerHTML = CASES.map(function (c) {
      var st = STORE.caseState(c.id);
      var done = st.read.length, total = c.evidence.length;
      var closed = total - Object.keys(availableSet(c, st)).length;
      var found = st.found.length, links = (c.contradictions || []).length;
      var verdict = st.verdict;
      var chips = [];
      chips.push('<span class="chip">' + c.rating + '</span>');
      chips.push('<span class="chip">' + '★'.repeat(c.difficulty) + '</span>');
      chips.push('<span class="chip">~' + c.playtimeMin + ' мин</span>');
      chips.push('<span class="chip">' + (total - closed) + ' из ' + total + ' документов</span>');
      if (done) chips.push('<span class="chip' + (done === total ? ' done' : '') + '">прочитано ' + done + '/' + total + '</span>');
      if (closed && !verdict) chips.push('<span class="chip">ещё ' + closed + ' закрыто</span>');
      if (found) chips.push('<span class="chip hot">связей ' + found + '/' + links + '</span>');
      if (verdict) chips.push('<span class="chip ' + (verdict.win ? 'done' : 'hot') + '">' + (verdict.win ? 'раскрыто' : 'сдано') + '</span>');
      var pct = total ? Math.round(done / total * 100) : 0;
      return '<article class="case-card' + (verdict && verdict.win ? ' done' : '') + '" data-act="open-case" data-id="' + c.id + '" tabindex="0" role="button">'
        + '<h3>' + esc(c.num) + ' — ' + esc(c.title) + '</h3>'
        + '<p class="cc-log">' + esc(c.logline) + '</p>'
        + '<div class="cc-bar' + (done === total && total ? ' done' : '') + '">'
        + '<span class="cc-bar-track"><span class="cc-bar-fill" style="width:' + pct + '%"></span></span>'
        + '<span>' + done + '/' + total + '</span>'
        + '</div>'
        + '<div class="cc-meta">' + chips.join('') + '</div>'
        + (done ? '<div class="cc-lock">Часы: ' + fmtClock(st.clockMs) + ', подсказок: ' + st.hints + '.</div>' : '')
        + '<span class="cc-go">' + (done ? 'продолжить' : 'открыть') + '</span>'
        + '</article>';
    }).join('');
  }

  function toMenu() {
    stopClock();
    S.def = null; S.st = null; S.cur = null; S.tray = [];
    document.body.classList.remove('board-open');
    ui.view.classList.add('hidden');
    ui.menu.classList.remove('hidden');
    renderMenu();
  }

  function eraseAll() {
    STORE.wipe();
    renderMenu();
    toast('Прогресс стёрт', 'cool');
    closeOverlay();
  }

  ui.list.addEventListener('click', function (e) {
    var card = e.target.closest('[data-id]');
    if (card) startCase(card.getAttribute('data-id'));
  });
  ui.list.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var card = e.target.closest('[data-id]');
    if (card) startCase(card.getAttribute('data-id'));
  });

  /* ============================================================
     ВХОД В ДЕЛО
     ============================================================ */
  function startCase(id) {
    var def = null;
    CASES.forEach(function (c) { if (c.id === id) def = c; });
    if (!def) return toast('Дело не найдено', 'bad');
    S.def = def;
    S.st = STORE.caseState(id);
    if (!S.st.started) { S.st.started = Date.now(); patch({ started: S.st.started }); }
    S.cur = null; S.tray = []; S.cat = '__all'; S.query = '';
    S.fresh = [];
    if (S.st.verdict) S.st.revealAll = true;   // сданное дело показываем целиком
    S.avail = null;
    refreshAvail(true);
    ui.search.value = '';
    ui.menu.classList.add('hidden');
    ui.view.classList.remove('hidden');
    ui.tbTitle.textContent = def.num + ' — ' + def.title;
    ui.tbSub.textContent = def.meta.place;
    ui.tbTotal.textContent = (def.contradictions || []).length;
    ui.tbFound.textContent = S.st.found.length;
    ui.notesArea.value = S.st.notes || '';
    renderFilters(); renderList(); renderTray(); renderPersons(); renderClues(); renderTimeline();
    switchTab('persons');
    ui.reader.innerHTML = '<div class="empty">Откройте любой документ из списка — всё прочитанное помечается ✓. Новые материалы будут поступать по мере того, как вы находите нестыковки.</div>';
    ui.readerTitle.textContent = 'Выберите улику слева';
    ui.readerIdx.textContent = '';
    startClock();
    if (!S.st.read.length) showBriefing();
  }

  function showBriefing() {
    var c = S.def;
    var html = '<div class="gate-icon">🗂</div>'
      + '<h2 class="ov-title">' + esc(c.num) + ' — ' + esc(c.title) + '</h2>'
      + '<p class="ov-sub">' + esc(c.meta.date) + ' · ' + esc(c.meta.place) + ' · ' + esc(c.rating) + '</p>'
      + '<div class="prose">' + c.briefing.map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>'
      + (c.meta.note ? '<div class="doc-note">' + c.meta.note + '</div>' : '')
      + '<p class="muted xs">В начале у вас только первичный материал. Остальные документы будут поступать по мере работы: прочитали документ — появился следующий. '
      + 'Если упрётесь, внизу списка есть ходатайство о выемке всего дела, но оно стоит трёх подсказок.</p>'
      + '<div class="ov-foot"><button class="btn primary" data-act="close-overlay" data-focus>К материалам дела</button></div>';
    openOverlay(html);
  }

  /* ============================================================
     СОХРАНЕНИЕ
     ============================================================ */
  function patch(obj) {
    if (!S.st) return;
    Object.assign(S.st, obj);
    STORE.patchCase(S.def.id, S.st);
  }

  /* ============================================================
     ПОРЯДОК ОТКРЫТИЯ МАТЕРИАЛОВ
     Улика поступает в работу, когда прочитана хотя бы одна из улик
     списка `after` (или найдена связь из `afterLink`). Полей нет —
     материал доступен с самого начала (seed). Так дело раскрывается
     постепенно, по мере того как вы сами находите нестыковки.
     ============================================================ */
  function availableSet(def, st) {
    var read = {}, found = {}, open = {};
    st.read.forEach(function (id) { read[id] = 1; });
    st.found.forEach(function (id) { found[id] = 1; });
    def.evidence.forEach(function (e) {
      if (st.revealAll || (!(e.after && e.after.length) && !(e.afterLink && e.afterLink.length))) { open[e.id] = 1; return; }
      var i;
      for (i = 0; i < (e.after || []).length; i++) { if (read[e.after[i]]) { open[e.id] = 1; return; } }
      for (i = 0; i < (e.afterLink || []).length; i++) { if (found[e.afterLink[i]]) { open[e.id] = 1; return; } }
    });
    return open;
  }

  function computeAvailable() { return availableSet(S.def, S.st); }

  /* пересчитать доступное; вернуть список новых id */
  function refreshAvail(initial) {
    var prev = S.avail;
    S.avail = computeAvailable();
    if (initial || !prev) return [];
    var fresh = [];
    Object.keys(S.avail).forEach(function (id) {
      if (!prev[id] && fresh.indexOf(id) < 0) fresh.push(id);
    });
    fresh.forEach(function (id) { if (S.fresh.indexOf(id) < 0) S.fresh.push(id); });
    return fresh;
  }

  function lockedCount() {
    var n = 0;
    S.def.evidence.forEach(function (e) { if (!S.avail[e.id]) n++; });
    return n;
  }

  /* ============================================================
     СПИСОК УЛИК
     ============================================================ */
  function cats() {
    var out = [];
    S.def.evidence.forEach(function (e) { if (e.cat && out.indexOf(e.cat) < 0) out.push(e.cat); });
    return out;
  }

  function renderFilters() {
    var all = cats();
    var open = S.def.evidence.filter(function (e) { return !!S.avail[e.id]; });
    var hasFresh = function (pred) {
      return open.some(function (e) { return pred(e) && S.fresh.indexOf(e.id) >= 0 && S.st.read.indexOf(e.id) < 0; });
    };
    var html = '<button class="fchip' + (S.cat === '__all' ? ' on' : '') + '" data-cat="__all">все ' + open.length
      + (hasFresh(function () { return true; }) ? ' <span class="fdot"></span>' : '') + '</button>';
    all.forEach(function (cat) {
      var n = open.filter(function (e) { return e.cat === cat; }).length;
      if (!n) return;
      html += '<button class="fchip' + (S.cat === cat ? ' on' : '') + '" data-cat="' + esc(cat) + '">' + esc(cat) + ' ' + n
        + (hasFresh(function (e) { return e.cat === cat; }) ? ' <span class="fdot"></span>' : '') + '</button>';
    });
    ui.filters.innerHTML = html;
  }

  function visibleEvidence() {
    var q = S.query.trim().toLowerCase();
    return S.def.evidence.filter(function (e) {
      if (!S.avail[e.id]) return false;
      if (S.cat !== '__all' && e.cat !== S.cat) return false;
      if (S.onlyUnread && S.st.read.indexOf(e.id) >= 0) return false;
      if (!q) return true;
      return (e.title + ' ' + (e.where || '') + ' ' + (e.cat || '')).toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderList() {
    var items = visibleEvidence();
    var html = '';
    if (!items.length) {
      html += '<div class="ev-list-empty">' + (S.onlyUnread
        ? 'Непрочитанных материалов нет. Отключите фильтр, чтобы снова видеть всё открытое.'
        : 'Здесь пока ничего нет — откройте доступные материалы слева вверху, дело раскрывается постепенно.') + '</div>';
    }
    html += items.map(function (e) {
      var read = S.st.read.indexOf(e.id) >= 0;
      var isNew = !read && S.fresh.indexOf(e.id) >= 0;
      var inTray = S.tray.indexOf(e.id) >= 0;
      var kind = e.kind || 'doc';
      var sub = [];
      if (e.cat) sub.push(esc(e.cat));
      if (e.at) sub.push('<span class="ev-at">' + esc(e.at) + '</span>');
      return '<div class="ev-item ' + (read ? 'read' : 'unread') + (isNew ? ' fresh' : '') + (S.cur === e.id ? ' on' : '') + (inTray ? ' tray-on' : '') + '" data-ev="' + e.id + '" data-kind="' + kind + '">'
        + '<span class="ev-kind" data-glyph="' + DOCS.kindGlyph(kind) + '" data-kind="' + kind + '" title="' + esc(DOCS.kindLabel(kind)) + '"></span>'
        + '<span class="ev-main">'
        + '<span class="ev-t">' + esc(e.title) + (isNew ? '<span class="ev-new">новое</span>' : '') + '</span>'
        + '<span class="ev-s">' + sub.join('<span class="sep">·</span>') + '</span>'
        + '</span>'
        + '<button class="ev-link' + (inTray ? ' on' : '') + '" data-link="' + e.id + '" title="Отметить для сравнения">🔗</button>'
        + '</div>';
    }).join('');
    html += listFooter();
    ui.evList.innerHTML = html;
    updateMeters();
  }

  /* прогресс в топбаре (связи и прочитано) + счётчики на вкладках доски */
  function updateMeters() {
    var total = S.def ? S.def.evidence.length : 0;
    var open = 0, read = 0;
    if (S.def) S.def.evidence.forEach(function (e) { if (S.avail[e.id]) open++; });
    read = S.st ? S.st.read.length : 0;
    var links = S.def && S.def.contradictions ? S.def.contradictions.length : 0;
    var found = S.st && S.st.found ? S.st.found.length : 0;
    setW('--ev-pct', total ? Math.round(read / total * 100) : 0);
    if (ui.tbRead) ui.tbRead.textContent = read + ' / ' + total;
    var fill = document.querySelector('.meter-read .meter-fill');
    if (fill) fill.style.width = (total ? Math.round(read / total * 100) : 0) + '%';
    var lf = document.querySelector('.meter-links .meter-fill');
    if (lf) lf.style.width = (links ? Math.round(found / links * 100) : 0) + '%';
    badge('persons', S.def && S.def.persons ? S.def.persons.length : 0);
    badge('clues', found + (links ? '/' + links : ''));
    badge('timeline', S.st ? S.st.read.filter(function (id) {
      var e = evidenceById(id); return e && e.at;
    }).length : 0);
    badge('notes', S.st && S.st.notes ? S.st.notes.length : 0);
  }
  function setW(name, v) { document.documentElement.style.setProperty(name, v + '%'); }
  function badge(tab, v) {
    var el = document.querySelector('#board-tabs [data-tab="' + tab + '"] .tab-badge');
    if (!el) return;
    el.textContent = v === 0 ? '' : String(v);
  }

  /* строка внизу списка: сколько ещё закрыто + ходатайство о выемке */
  function listFooter() {
    if (S.st.revealAll) {
      var left = S.def.evidence.length - S.st.read.length;
      return '<div class="ev-lock">Все материалы дела у вас' + (left ? '. Прочитано не всё: осталось ' + left + '.' : '.') + '</div>';
    }
    var locked = lockedCount();
    if (!locked) return '<div class="ev-lock">Материалы дела открыты полностью.</div>';
    return '<div class="ev-lock">В деле ещё <b>' + locked + '</b> закрыт' + plural(locked, 'ый материал', 'ых материала', 'ых материалов') +
      ' — они поступят, когда найдёте основания. <button class="mini" data-act="reveal-all">Ходатайство о выемке всего</button></div>';
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  ui.filters.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]');
    if (!b) return;
    S.cat = b.getAttribute('data-cat');
    renderFilters(); renderList();
  });
  ui.search.addEventListener('input', function () { S.query = ui.search.value; renderList(); });

  ui.evList.addEventListener('click', function (e) {
    var ra = e.target.closest('[data-act="reveal-all"]');
    if (ra) { askRevealAll(); return; }
    var link = e.target.closest('[data-link]');
    if (link) { toggleTray(link.getAttribute('data-link')); return; }
    var item = e.target.closest('[data-ev]');
    if (item) openEvidence(item.getAttribute('data-ev'));
  });

  function evidenceById(id) {
    if (!S.def) return null;
    var found = null;
    S.def.evidence.forEach(function (e) { if (e.id === id) found = e; });
    return found;
  }

  function openEvidence(id) {
    var e = evidenceById(id);
    if (!e) return;
    if (!S.avail[id]) return toast('Этот материал ещё не поступил в дело', 'cool');
    S.cur = id;
    ui.reader.innerHTML = DOCS.render(e);
    ui.reader.scrollTop = 0;
    ui.readerTitle.textContent = e.title;
    var items = visibleEvidence();
    var pos = -1;
    items.forEach(function (x, i) { if (x.id === id) pos = i; });
    ui.readerIdx.textContent = pos >= 0 ? (pos + 1) + '/' + items.length : '';
    var first = S.st.read.indexOf(id) < 0;
    if (first) {
      S.st.read.push(id);
      patch({ read: S.st.read });
      if (e.at) renderTimeline();
    }
    var fresh = first ? refreshAvail() : [];
    if (fresh.length) {
      renderFilters();
      toast('Поступило новых материалов: ' + fresh.length + '. Смотрите список улик.', 'good');
    }
    renderList();
  }

  /* ходатайство о выемке всего — анти-тупик */
  function askRevealAll() {
    var locked = lockedCount();
    if (!locked) return toast('Всё уже у вас', 'cool');
    openOverlay('<div class="gate-icon">📥</div><h2 class="ov-title">Ходатайство о выемке всех материалов</h2>'
      + '<p class="ov-sub">Сейчас закрыто ' + locked + ' документ' + plural(locked, '', 'а', 'ов') + '.</p>'
      + '<div class="prose"><p>Вы добиваетесь, чтобы вам отдали сразу всё, что есть в деле, — не дожидаясь, пока нестыковки выведут на очередной документ.</p>'
      + '<p><b>Цена:</b> в заключении это считается как три взятые подсказки, потому что работа следователя — не перечитать пачку, а найти, что из чего следует. '
      + 'Найденные связи и порядок в деле от этого не меняются.</p></div>'
      + '<div class="ov-foot"><button class="btn ghost" data-act="close-overlay">Подожду, сам(а)</button>'
      + '<button class="btn primary" data-act="reveal-real" data-focus>Подписать ходатайство</button></div>');
  }

  function doRevealAll() {
    closeOverlay();
    patch({ revealAll: true });
    refreshAvail();
    renderFilters(); renderList(); renderPersons(); renderTimeline();
    toast('Дело отдали целиком. В выписке это минус 3 подсказки.', 'bad');
  }

  function step(dir) {
    var items = visibleEvidence();
    if (!items.length) return;
    var idx = -1;
    items.forEach(function (x, i) { if (x.id === S.cur) idx = i; });
    var next = idx < 0 ? 0 : Math.min(items.length - 1, Math.max(0, idx + dir));
    openEvidence(items[next].id);
  }

  /* ============================================================
     ЛОТОК СРАВНЕНИЯ
     ============================================================ */
  function toggleTray(id) {
    var i = S.tray.indexOf(id);
    if (i >= 0) S.tray.splice(i, 1);
    else {
      S.tray.push(id);
      if (S.tray.length > 2) S.tray.shift();
    }
    renderTray(); renderList();
  }

  function renderTray() {
    if (!S.tray.length) {
      ui.trayItems.innerHTML = '<span class="muted">не выбрано</span>';
    } else {
      ui.trayItems.innerHTML = S.tray.map(function (id) {
        var e = evidenceById(id);
        return '<b>' + esc(e ? e.title : id) + '</b>';
      }).join('<span class="muted"> ↔ </span>');
    }
    ui.btnCompare.disabled = S.tray.length !== 2;
  }

  function pairOf(a, b) {
    var found = null;
    (S.def.contradictions || []).forEach(function (c) {
      if ((c.a === a && c.b === b) || (c.a === b && c.b === a)) found = c;
    });
    return found;
  }

  function compare() {
    if (S.tray.length !== 2) return;
    var a = S.tray[0], b = S.tray[1];
    var ea = evidenceById(a), eb = evidenceById(b);
    var link = pairOf(a, b);
    if (link) {
      if (S.st.found.indexOf(link.id) >= 0) {
        toast('Эту связь вы уже нашли.', 'cool');
        switchTab('clues');
        return;
      }
      S.st.found.push(link.id);
      var extra = '';
      if (link.flags) {
        Object.keys(link.flags).forEach(function (pid) {
          var mark = link.flags[pid];
          if (mark === 'clear' || mark === 'watch') {
            var cur = S.st.suspects[pid];
            if (cur !== 'accused') {
              S.st.suspects[pid] = mark;
              var p = personById(pid);
              extra += '<div class="pill ' + (mark === 'clear' ? 'good' : 'bad') + '">'
                + esc(p ? p.short : pid) + ': ' + (mark === 'clear' ? 'алиби подтверждено' : 'под подозрением') + '</div> ';
            }
          }
        });
      }
      patch({ found: S.st.found, suspects: S.st.suspects });
      ui.tbFound.textContent = S.st.found.length;
      var fresh = refreshAvail();
      renderPersons(); renderClues(link.id); renderTimeline();
      if (fresh.length) { renderFilters(); renderList(); }
      switchTab('clues');
      openOverlay('<div class="gate-icon">⚖</div><h2 class="ov-title">Противоречие найдено</h2>'
        + '<p class="ov-sub">' + esc(ea.title) + ' ↔ ' + esc(eb.title) + '</p>'
        + '<div class="prose"><p>' + link.reveals + '</p></div>'
        + (extra ? '<p>' + extra + '</p>' : '')
        + (fresh.length ? '<div class="doc-note">По этому выводу в дело поступило материалов: <b>' + fresh.length + '</b> — они отмечены в списке как «новое».</div>' : '')
        + '<div class="ov-foot"><button class="btn ghost" data-act="show-evidence" data-id="' + a + '">К первой улике</button>'
        + '<button class="btn ghost" data-act="show-evidence" data-id="' + b + '">Ко второй</button>'
        + '<button class="btn primary" data-act="close-overlay" data-focus>Понятно</button></div>');
      return;
    }
    var commonTags = (ea.tags || []).filter(function (t) { return (eb.tags || []).indexOf(t) >= 0; });
    var commonKeys = (ea.keys || []).filter(function (k) { return (eb.keys || []).indexOf(k) >= 0; });
    var traces = commonKeys.concat(commonTags.map(function (t) { var p = personById(t); return p ? p.short : t; }));
    if (traces.length) toast('Близко: общий след — ' + traces.join(', ') + '. Но вывода нет.', 'cool');
    else toast('Связи между этими документами не видно.', 'bad');
  }

  ui.btnCompare.addEventListener('click', compare);

  /* ============================================================
     ДОСКА: ЛЮДИ
     ============================================================ */
  function personById(id) {
    var f = null;
    (S.def.persons || []).forEach(function (p) { if (p.id === id) f = p; });
    return f;
  }

  function evidenceFor(pid) {
    return S.def.evidence.filter(function (e) {
      return (e.tags || []).indexOf(pid) >= 0 && !!S.avail[e.id];
    });
  }

  function renderPersons() {
    var order = { suspect: 0, victim: 1, npc: 2 };
    var list = (S.def.persons || []).slice().sort(function (a, b) {
      return (order[a.kind] || 9) - (order[b.kind] || 9);
    });
    ui.panelPersons.innerHTML = list.map(function (p) {
      var mark = S.st.suspects[p.id];
      var flags = '';
      if (p.kind === 'victim') flags = '<span class="flag">потерпевший</span>';
      else if (mark === 'accused') flags = '<span class="flag accused">обвиняемый</span>';
      else if (mark === 'watch') flags = '<span class="flag bad">под подозрением</span>';
      else if (mark === 'clear') flags = '<span class="flag good">алиби</span>';
      var n = evidenceFor(p.id).length;
      return '<div class="person' + (p.kind === 'npc' ? ' npc' : '') + '" data-person="' + p.id + '">'
        + '<div class="avatar">' + esc(p.initials || '??') + '</div>'
        + '<div><div class="p-name">' + esc(p.short || p.name) + '</div><div class="p-role">' + esc(p.role) + '</div></div>'
        + (flags ? '<div class="p-flags">' + flags + '</div>' : '')
        + (n ? '<div class="p-claim">' + n + ' улик связано</div>' : '')
        + '</div>';
    }).join('');
  }

  ui.panelPersons.addEventListener('click', function (e) {
    var p = e.target.closest('[data-person]');
    if (!p) return;
    showPerson(p.getAttribute('data-person'));
  });

  function showPerson(pid) {
    var p = personById(pid);
    if (!p) return;
    var mark = S.st.suspects[pid];
    var ev = evidenceFor(pid);
    var links = (S.def.contradictions || []).filter(function (c) {
      return c.flags && c.flags[pid] && S.st.found.indexOf(c.id) >= 0;
    });
    var btn = function (v, label, cls) {
      return '<button class="mini ' + cls + (mark === v ? ' on' : '') + '" data-act="flag-person" data-id="' + pid + '" data-v="' + v + '">' + label + '</button>';
    };
    openOverlay('<h2 class="ov-title">' + esc(p.name) + '</h2>'
      + '<p class="ov-sub">' + esc(p.role) + (p.kind === 'victim' ? ' · потерпевший' : '') + '</p>'
      + '<div class="prose"><p>' + esc(p.bio) + '</p>'
      + (p.claim && p.claim !== '—' ? '<p><b>Что утверждает:</b> ' + esc(p.claim) + '</p>' : '')
      + '</div>'
      + (p.kind === 'suspect' ? '<div class="board-actions">' + btn('watch', 'под подозрением', 'bad') + btn('clear', 'алиби подтверждено', 'good') + '</div>' : '')
      + (links.length ? '<div class="reveal-h">Найденные связи</div><div class="prose">' + links.map(function (c) { return '<p>' + c.reveals + '</p>'; }).join('') + '</div>' : '')
      + (ev.length ? '<div class="reveal-h">Улики с участием</div><div class="prose">'
        + ev.map(function (e) {
          return '<p><button class="link-ev" data-act="show-evidence" data-id="' + e.id + '">' + esc(e.title) + '</button>'
            + (S.st.read.indexOf(e.id) < 0 ? ' <span class="pill">не прочитана</span>' : '') + '</p>';
        }).join('') + '</div>' : '')
      + '<div class="ov-foot"><button class="btn primary" data-act="close-overlay" data-focus>Закрыть</button></div>');
  }

  function flagPerson(pid, v, fromCard) {
    var cur = S.st.suspects[pid];
    if (cur === v) delete S.st.suspects[pid];
    else S.st.suspects[pid] = v;
    patch({ suspects: S.st.suspects });
    renderPersons();
    if (fromCard) showPerson(pid);
  }

  /* ============================================================
     ДОСКА: ВЫВОДЫ
     ============================================================ */
  function renderClues(newId) {
    var all = S.def.contradictions || [];
    if (!S.st.found.length) {
      ui.panelClues.innerHTML = '<p class="panel-hint">Здесь появятся выводы, когда вы найдёте противоречие между двумя уликами. Отметьте 🔗 два документа и нажмите «Сравнить».</p>';
      return;
    }
    var html = all.filter(function (c) { return S.st.found.indexOf(c.id) >= 0; })
      .map(function (c) {
        var a = evidenceById(c.a), b = evidenceById(c.b);
        return '<div class="clue' + (newId === c.id ? ' new' : '') + '">'
          + '<div class="clue-head"><span>связь ' + (S.st.found.indexOf(c.id) + 1) + '</span><span>' + esc(c.a) + ' ↔ ' + esc(c.b) + '</span></div>'
          + '<div class="clue-text">' + c.reveals + '</div>'
          + '<div class="board-actions"><button class="mini" data-act="show-evidence" data-id="' + c.a + '">' + esc(a ? a.title : c.a) + '</button>'
          + '<button class="mini" data-act="show-evidence" data-id="' + c.b + '">' + esc(b ? b.title : c.b) + '</button></div>'
          + '</div>';
      }).join('');
    ui.panelClues.innerHTML = html;
  }

  ui.panelClues.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act="show-evidence"]');
    if (b) openEvidence(b.getAttribute('data-id'));
  });

  /* ============================================================
     ДОСКА: ВРЕМЯ
     ============================================================ */
  function renderTimeline() {
    var rows = [];
    S.def.evidence.forEach(function (e) {
      if (!e.at) return;
      if (S.st.read.indexOf(e.id) < 0) return;
      rows.push({ t: e.at, x: e.title, src: e.id, where: e.where || '' });
    });
    rows.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    var html = '';
    if (!rows.length) html += '<p class="tl-blur">Пока пусто. Таймлайн собирается сам из документов, в которых есть время, — открывайте улики.</p>';
    rows.forEach(function (r) {
      var crime = S.def.crime && r.t >= S.def.crime.at && r.t <= S.def.crime.until;
      html += '<div class="tl-row' + (crime ? ' crime' : '') + '">'
        + '<div class="tl-t">' + esc(r.t) + '</div>'
        + '<div class="tl-x">' + esc(r.x) + '</div>'
        + (r.where ? '<div class="tl-src">' + esc(r.where) + '</div>' : '')
        + '</div>';
    });
    if (S.def.crime && S.st.read.indexOf('e02') >= 0) {
      html += '<div class="tl-row crime"><div class="tl-t">' + esc(S.def.crime.at) + '–' + esc(S.def.crime.until) + '</div>'
        + '<div class="tl-x">Окно смерти по заключению СМЭ</div><div class="tl-src">' + esc(S.def.crime.place) + '</div></div>';
    }
    ui.panelTimeline.innerHTML = '<div class="tl">' + html + '</div>';
  }

  /* ============================================================
     ВКЛАДКИ
     ============================================================ */
  function switchTab(name) {
    var tabs = document.querySelectorAll('#board-tabs .tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    ['persons', 'clues', 'timeline', 'notes'].forEach(function (n) {
      var el = $('panel-' + n);
      if (el) el.classList.toggle('active', n === name);
    });
    if (window.innerWidth <= 1180) document.body.classList.add('board-open');
  }
  $('board-tabs').addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]');
    if (t) switchTab(t.getAttribute('data-tab'));
  });

  var notesTimer = null;
  ui.notesArea.addEventListener('input', function () {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(function () { patch({ notes: ui.notesArea.value }); }, 500);
  });

  /* ============================================================
     ПОДСКАЗКИ (со шлюзом спойлеров)
     ============================================================ */
  function askHint() {
    if (!S.def) return;
    var n = S.st.hints;
    var hints = S.def.hints || [];
    if (n >= hints.length) return toast('Подсказки закончились — дальше только сами.', 'cool');
    openOverlay('<div class="gate-icon">🔎</div><h2 class="ov-title">Подсказка № ' + (n + 1) + ' из ' + hints.length + '</h2>'
      + '<p class="ov-sub">Это спойлер: подсказка снижает итоговую репутацию детектива и может открыть часть решения. '
      + (n ? 'Предыдущие подсказки уже открыты.' : 'Обычно достаточно посмотреть на два документа рядом.') + '</p>'
      + '<div class="ov-foot"><button class="btn ghost" data-act="close-overlay">Подожду, сам(а)</button>'
      + '<button class="btn primary" data-act="hint-real" data-focus>Давайте подсказку</button></div>');
  }

  function giveHint() {
    var hints = S.def.hints || [];
    var n = Math.min(S.st.hints, hints.length - 1);
    patch({ hints: S.st.hints + 1 });
    var h = hints[n];
    var lockedNote = (!S.st.revealAll && lockedCount())
      ? '<p class="muted xs">Если нужного документа нет в списке — он ещё не поступил: дочитайте доступное, материалы приходят по мере работы. Или подайте ходатайство о выемке внизу списка.</p>'
      : '';
    openOverlay('<div class="gate-icon">💡</div><h2 class="ov-title">' + esc(h.title) + '</h2>'
      + '<div class="prose">' + h.text.split(/\n{2,}/).map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>'
      + lockedNote
      + '<div class="ov-foot"><button class="btn primary" data-act="close-overlay" data-focus>Вернуться к делу</button></div>');
  }

  /* ============================================================
     СДАЧА ДЕЛА (со шлюзом спойлеров)
     ============================================================ */
  function askAccuse() {
    if (!S.def) return;
    var st = S.st;
    var warn = [];
    var locked = lockedCount();
    var unread = S.def.evidence.filter(function (e) { return S.avail[e.id] && st.read.indexOf(e.id) < 0; }).length;
    if (locked) warn.push('в деле ещё ' + locked + ' закрыт' + plural(locked, 'ый документ', 'ых документа', 'ых документов'));
    if (unread) warn.push('не прочитано ' + unread + ' из доступных');
    if (st.verdict) warn.push('дело уже сдавалось — текущая оценка будет заменена');
    openOverlay('<div class="gate-icon">⏱</div><h2 class="ov-title">Сдать дело?</h2>'
      + '<p class="ov-sub">После сдачи откроется полная реконструкция вечера — назад дороги нет. '
      + (warn.length ? 'Недоследовано: ' + warn.join('; ') + '.' : 'Вы прошли всё.') + '</p>'
      + '<p class="muted xs">На оценку влияет только то, что вы назвали в заключении. Связи между уликами и число прочитанных документов — помощь, а не требование.</p>'
      + '<div class="ov-foot"><button class="btn ghost" data-act="close-overlay">Ещё поковыряю</button>'
      + '<button class="btn primary" data-act="accuse-open" data-focus>Сдаю</button></div>');
  }

  function openAccuse() {
    var f = S.def.objective.fields;
    var html = '<h2 class="ov-title">' + esc(S.def.title) + ' — версия следствия</h2>'
      + '<p class="ov-sub">' + esc(S.def.objective.intro) + '</p>';
    if (f.length > 1) html += '<div class="grid2">';
    f.forEach(function (field) {
      html += '<div class="field"><label for="fld-' + field.id + '">' + esc(field.label) + '</label><select id="fld-' + field.id + '" data-field="' + field.id + '">'
        + '<option value="">— не установлено —</option>'
        + field.options.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('')
        + '</select></div>';
    });
    if (f.length > 1) html += '</div>';
    html += '<div class="ov-foot"><button class="btn ghost" data-act="close-overlay">Отмена</button>'
      + '<button class="btn primary" data-act="accuse-send" data-focus>Подписать заключение</button></div>';
    openOverlay(html, { wide: true });
  }

  function labelOf(field, val) {
    var l = val;
    field.options.forEach(function (o) { if (o[0] === val) l = o[1]; });
    return l;
  }

  function submitVerdict() {
    var f = S.def.objective.fields;
    var answer = {};
    f.forEach(function (field) {
      var el = $('fld-' + field.id);
      answer[field.id] = el ? el.value : '';
    }

    );
    var rows = '', hits = 0, near = 0;
    f.forEach(function (field) {
      var given = answer[field.id];
      var ok = !!given && given === field.correct;
      var isNear = !ok && !!given && (field.near || []).indexOf(given) >= 0;
      if (ok) hits++; else if (isNear) near++;
      rows += '<tr><td>' + esc(field.label) + '</td><td>'
        + (ok ? '<span class="ok">✔ ' + esc(labelOf(field, given)) + '</span>'
          : isNear ? '<span class="mid">± ' + esc(labelOf(field, given)) + '</span>'
            : given ? '<span class="no">✘ ' + esc(labelOf(field, given)) + '</span>' : '<span class="no">— пусто</span>')
        + '</td></tr>'
        + '<tr><td colspan="2" class="muted xs">' + (ok ? '' : esc(field.explain)) + '</td></tr>';
    });

    var total = (S.def.contradictions || []).length;
    var links = S.st.found.length;
    var hints = S.st.hints + (S.st.revealAll ? 3 : 0);
    var elapsed = S.st.clockMs;
    /* Связи на оценку НЕ влияют: важен только результат в заключении.
       18 баллов за каждое верное поле, 9 за близкое, −6 за подсказку
       (выемка всего дела = 3 подсказки), +10 за темп. */
    var score = Math.round(hits * 18 + near * 9 - hints * 6
      + (elapsed && elapsed < S.def.playtimeMin * 60000 ? 10 : 0));
    score = Math.max(0, Math.min(100, score));

    var culprit = S.def.objective.fields.filter(function (x) { return x.id === 'culprit'; })[0];
    var win = culprit && answer.culprit === culprit.correct && hits >= 4;
    var badge, text;
    if (hits === f.length) { badge = 'win'; text = S.def.verdict.full; }
    else if (win) { badge = 'win'; text = S.def.verdict.good; }
    else if (hits + near >= 3) { badge = 'partial'; text = S.def.verdict.partial; }
    else { badge = 'lose'; text = S.def.verdict.lose; }

    patch({ verdict: { win: badge === 'win', hits: hits, fields: f.length, score: score, answer: answer, at: Date.now() } });
    stopClock();
    /* после сдачи открываем дело целиком: можно дочитать и добрать связи */
    S.st.revealAll = true;
    refreshAvail();
    renderFilters(); renderList(); renderPersons();

    var html = '<div class="verdict-badge ' + badge + '">'
      + (badge === 'win' ? 'ДЕЛО РАСКРЫТО' : badge === 'partial' ? 'ЧАСТИЧНО' : 'НЕ РАСКРЫТО')
      + '</div><h2 class="ov-title">' + esc(S.def.title) + '</h2>'
      + '<p class="ov-sub">' + text + '</p>'
      + '<table class="score-table"><tbody>' + rows + '</tbody></table>'
      + '<table class="score-table"><tbody>'
      + '<tr><td>Найдено противоречий <span class="muted xs">· на оценку не влияет</span></td><td>' + links + ' / ' + total + '</td></tr>'
      + '<tr><td>Прочитано документов <span class="muted xs">· на оценку не влияет</span></td><td>' + S.st.read.length + ' / ' + S.def.evidence.length + '</td></tr>'
      + '<tr><td>Подсказок учтено</td><td>' + hints + (S.st.revealAll && hints > S.st.hints ? ' <span class="muted xs">(из них 3 — за выемку всего дела)</span>' : '') + '</td></tr>'
      + '<tr><td>Время расследования</td><td>' + fmtClock(elapsed) + ' <span class="muted xs">· ориентир ' + S.def.playtimeMin + ' мин</span></td></tr>'
      + '<tr><td><b>Репутация детектива</b></td><td><b>' + score + ' / 100</b></td></tr>'
      + '</tbody></table>'
      + '<p class="muted xs">Оценка: 18 баллов за каждое верное поле заключения, 9 за близкое, −6 за подсказку, +10 за темп. Связи и число прочитанных листов роли не играют.</p>'
      + '<div class="reveal-h">Как было на самом деле</div>'
      + '<div class="prose">' + (S.def.reconstruction || []).map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>'
      + (total - links > 0 ? '<div class="reveal-h">Что вы не связали</div><div class="prose"><ol>'
        + (S.def.contradictions || []).filter(function (c) { return S.st.found.indexOf(c.id) < 0; })
          .map(function (c) {
            var a = evidenceById(c.a), b = evidenceById(c.b);
            return '<li><b>' + esc(a ? a.title : c.a) + '</b> ↔ <b>' + esc(b ? b.title : c.b) + '</b><br>' + c.reveals + '</li>';
          }).join('') + '</ol></div>' : '')
      + '<div class="ov-foot">'
      + '<button class="btn ghost" data-act="print">Печать разбора</button>'
      + '<button class="btn ghost" data-act="play-again">Играть это дело заново</button>'
      + '<button class="btn primary" data-act="to-menu" data-focus>К списку дел</button></div>';
    openOverlay(html, { wide: true });
  }

  function resetCase() {
    var id = S.def.id;
    var st = STORE.load();
    delete st.cases[id];
    STORE.save(st);
    var def = S.def;
    toMenu();
    startCase(def.id);
  }

  /* ============================================================
     ЧАСЫ
     ============================================================ */
  function startClock() {
    stopClock();
    S.lastTick = Date.now();
    ui.tbClock.textContent = fmtClock(S.st.clockMs);
    S.tick = setInterval(function () {
      var now = Date.now();
      S.st.clockMs += now - S.lastTick;
      S.lastTick = now;
      ui.tbClock.textContent = fmtClock(S.st.clockMs);
      if (Math.floor(S.st.clockMs / 1000) % 10 === 0) patch({ clockMs: S.st.clockMs });
    }, 1000);
  }
  function stopClock() {
    if (!S.tick) return;
    clearInterval(S.tick);
    S.tick = null;
    if (S.st) {
      S.st.clockMs += Date.now() - S.lastTick;
      patch({ clockMs: S.st.clockMs });
    }
  }

  /* ============================================================
     ТЕМА, ХОТКЕИ, ПРОЧЕЕ
     ============================================================ */
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var st = STORE.load();
    st.theme = t;
    STORE.save(st);
  }
  $('btn-theme').addEventListener('click', function () {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  $('btn-hint').addEventListener('click', askHint);
  $('btn-accuse').addEventListener('click', askAccuse);
  $('btn-back').addEventListener('click', function () {
    stopClock();
    toMenu();
  });
  $('btn-board').addEventListener('click', function () {
    document.body.classList.toggle('board-open');
  });
  $('ev-prev').addEventListener('click', function () { step(-1); });
  $('ev-next').addEventListener('click', function () { step(1); });
  $('btn-erase').addEventListener('click', function () {
    openOverlay('<div class="gate-icon">🗑</div><h2 class="ov-title">Стереть весь прогресс?</h2>'
      + '<p class="ov-sub">Будут удалены прочитанные улики, найденные связи, заметки и вердикты по всем делам. Отменить это нельзя.</p>'
      + '<div class="ov-foot"><button class="btn ghost" data-act="close-overlay">Отмена</button>'
      + '<button class="btn primary" data-act="erase" data-focus>Стереть</button></div>');
  });

  /* ============================================================
     ЭКРАН «СВОДКА ДЕЛА» + ПЕРЕКЛЮЧАТЕЛИ РЕЖИМОВ
     ============================================================ */
  function press(btn, on) { if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }

  function uiPrefs() {
    var st = STORE.load();
    if (!st.ui) st.ui = {};
    return st.ui;
  }
  function saveUiCompact(on) {
    var st = STORE.load();
    if (!st.ui) st.ui = {};
    st.ui.compact = !!on;
    STORE.save(st);
  }

  function showScope() {
    if (!S.def) { toast('Сводка доступна внутри дела', 'bad'); return; }
    var C = S.def, st = S.st;
    var total = C.evidence.length;
    var open = 0, readIds = {};
    C.evidence.forEach(function (e) { if (S.avail[e.id]) open++; });
    st.read.forEach(function (id) { readIds[id] = 1; });
    var links = (C.contradictions || []).length;
    var found = st.found.length;
    var pctRead = total ? Math.round(open / total * 100) : 0;
    var pctLink = links ? Math.round(found / links * 100) : 0;

    var rows = '';
    rows += '<tr><td>Прочитано материалов</td><td>' + Object.keys(readIds).length + ' / ' + total + '</td></tr>';
    rows += '<tr class="' + (open >= total ? 'ok' : 'mid') + '"><td>Приобщено к делу</td><td>' + open + ' / ' + total
      + (open < total ? ' <span class="muted xs">(ещё ' + (total - open) + ' закрыто)</span>' : '') + '</td></tr>';
    rows += '<tr class="' + (found >= links ? 'ok' : 'mid') + '"><td>Найдено противоречий</td><td>' + found + ' / ' + links + '</td></tr>';
    rows += '<tr class="' + (st.hints ? 'no' : '') + '"><td>Подсказок взято</td><td>' + st.hints
      + (st.revealAll ? ' <span class="muted xs">+ 3 за выемку всего дела</span>' : '') + '</td></tr>';
    rows += '<tr><td>Время в деле</td><td>' + fmtClock(st.clockMs) + '</td></tr>';

    var bars = '<div class="scope-kinds">'
      + '<div class="kind-cell"><span class="kind-k">прочитано</span><span class="meter"><i class="meter-fill" style="width:' + pctRead + '%"></i>'
      + '<span class="meter-txt">' + open + ' / ' + total + ' в деле</span></span></div>'
      + '<div class="kind-cell"><span class="kind-k">связи</span><span class="meter"><i class="meter-fill" style="width:' + pctLink + '%"></i>'
      + '<span class="meter-txt">' + found + ' / ' + links + ' найдено</span></span></div>'
      + '</div>';

    var kinds = {};
    C.evidence.forEach(function (e) {
      var k = e.kind || 'doc';
      if (!kinds[k]) kinds[k] = { open: 0, read: 0, all: 0 };
      kinds[k].all++;
      if (S.avail[e.id]) kinds[k].open++;
      if (readIds[e.id]) kinds[k].read++;
    });
    var kindHtml = Object.keys(kinds).sort(function (a, b) { return kinds[b].all - kinds[a].all; }).map(function (k) {
      return '<span class="kind-cell" data-kind="' + k + '"><span class="kind-g">' + DOCS.kindGlyph(k) + '</span>'
        + '<span class="kind-k">' + esc(DOCS.kindLabel(k)) + '</span>'
        + '<span class="kind-n">' + kinds[k].read + '/' + kinds[k].open + '<span class="muted">/' + kinds[k].all + '</span></span></span>';
    }).join('');

    var susp = (C.persons || []).filter(function (p) { return st.suspects[p.id]; });
    var suspHtml = susp.length
      ? susp.map(function (p) {
        return '<p class="scope-line"><span class="pill ' + (st.suspects[p.id] > 0 ? 'bad' : 'good') + '">'
          + esc(p.short || p.name) + '</span> <span class="muted">' + esc(p.role || '') + '</span></p>';
      }).join('')
      : '<p class="scope-line muted">Никто не помечен. Отметьте подозрительных на вкладке «Люди».</p>';

    var unseen = C.evidence.filter(function (e) { return S.avail[e.id] && !readIds[e.id]; });
    var unseenHtml = unseen.length
      ? unseen.slice(0, 8).map(function (e) {
        return '<p class="scope-line"><button class="link-ev" data-act="show-evidence" data-id="' + e.id + '">'
          + DOCS.kindGlyph(e.kind || 'doc') + ' ' + esc(e.title) + '</button></p>';
      }).join('') + (unseen.length > 8 ? '<p class="muted xs">…и ещё ' + (unseen.length - 8) + '</p>' : '')
      : '<p class="scope-line muted">Открытые материалы прочитаны все.</p>';

    openOverlay('<div class="gate-icon">📑</div>'
      + '<h2 class="ov-title">Сводка: ' + esc(C.num ? C.num + ' — ' : '') + esc(C.title) + '</h2>'
      + '<p class="ov-sub">' + esc((C.meta && C.meta.place) || '') + ' · ' + esc((C.meta && C.meta.date) || '') + '</p>'
      + '<div class="hint-num">' + pctRead + '% материалов приобщено · ' + pctLink + '% связей найдено</div>'
      + bars
      + '<table class="score-table"><tbody>' + rows + '</tbody></table>'
      + '<div class="reveal-h">Кого вы считаете подозрительным</div>' + suspHtml
      + '<div class="reveal-h">Типы материалов (прочитано / открыто / всего)</div><div class="scope-kinds">' + kindHtml + '</div>'
      + '<div class="reveal-h">Не прочитано, но уже в деле</div>' + unseenHtml
      + '<div class="ov-foot"><button class="btn ghost" data-act="close-overlay">Закрыть</button>'
      + '<button class="btn ghost" data-act="close-overlay">Доследовать</button>'
      + '<button class="btn primary" data-act="accuse-open" data-focus>Сдать дело</button></div>', { wide: true });
  }

  $('btn-unread').addEventListener('click', function () {
    S.onlyUnread = !S.onlyUnread;
    press(this, S.onlyUnread);
    renderList();
    var n = visibleEvidence().length;
    toast(S.onlyUnread ? 'Скрыл прочитанное: осталось ' + n + ' ' + plural(n, 'материал', 'материала', 'материалов')
      : 'Показываю все открытые материалы', 'cool');
  });
  $('btn-density').addEventListener('click', function () {
    var on = document.body.classList.toggle('compact-list');
    press(this, on);
    saveUiCompact(on);
    toast(on ? 'Плотный список включён' : 'Обычный список', 'cool');
  });
  $('btn-focus').addEventListener('click', function () {
    var on = document.body.classList.toggle('focus-mode');
    press(this, on);
    toast(on ? 'Режим чтения: колонки убраны, Esc вернёт' : 'Вернул колонки', 'cool');
  });
  $('btn-scope').addEventListener('click', showScope);

  function showHelp() {
    openOverlay('<h2 class="ov-title">Как играть</h2>'
      + '<div class="kbd-list">'
      + '<b>← →</b><span>листать улики</span>'
      + '<b>Пробел</b><span>перейти в заметки</span>'
      + '<b>L</b><span>сравнить две отмеченные улики</span>'
      + '<b>H</b><span>подсказка (портит репутацию)</span>'
      + '<b>B</b><span>доска справа</span>'
      + '<b>R</b><span>режим чтения: спрятать боковые колонки</span>'
      + '<b>G</b><span>сводка дела: прогресс, типы материалов, подозрения</span>'
      + '<b>T</b><span>светлая/тёмная тема</span>'
      + '<b>F</b><span>полный экран</span>'
      + '<b>Esc</b><span>закрыть окно / назад</span>'
      + '<b>Ctrl+P</b><span>распечатать открытый документ</span>'
      + '<b>?</b><span>эта справка</span>'
      + '</div>'
      + '<p class="muted xs">Материалы дела поступают постепенно: список пополняется, когда вы читаете документы и находите противоречия. '
      + 'Связывать улики необязательно — на итоговую оценку влияют только ответы в заключении.</p>'
      + '<div class="ov-foot"><button class="btn primary" data-act="close-overlay" data-focus>Понятно</button></div>');
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') {
      if (overlayOpen()) closeOverlay();
      else if (S.def && typing) e.target.blur();
      else if (S.def && document.body.classList.contains('focus-mode')) {
        document.body.classList.remove('focus-mode');
        press(ui.btnFocus, false);
      } else if (S.def) toMenu();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!S.def) {
      if (e.key === '?' ) showHelp();
      if (e.key === 'Enter') {
        var card = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-id');
        if (card) startCase(card);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowLeft': step(-1); break;
      case 'ArrowRight': step(1); break;
      case ' ': e.preventDefault(); switchTab('notes'); ui.notesArea.focus(); break;
      case 'l': case 'L': case 'д': case 'Д': compare(); break;
      case 'h': case 'H': case 'р': case 'Р': askHint(); break;
      case 'b': case 'B': case 'и': case 'И': document.body.classList.toggle('board-open'); break;
      case 'r': case 'R': case 'к': case 'К': $('btn-focus').click(); break;
      case 'g': case 'G': case 'п': case 'П': showScope(); break;
      case 't': case 'T': case 'е': case 'Е':
        setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); break;
      case 'f': case 'F': case 'а': case 'А':
        if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); break;
      case '?': showHelp(); break;
    }
  });

  /* ============================================================
     СТАРТ
     ============================================================ */
  setTheme(STORE.load().theme || 'dark');
  if (uiPrefs().compact) { document.body.classList.add('compact-list'); press(ui.btnDensity, true); }
  renderMenu();
  if (!CASES || !CASES.length) {
    toast('Не подключено ни одного дела', 'bad');
  }
})(typeof window !== 'undefined' ? window : globalThis);
