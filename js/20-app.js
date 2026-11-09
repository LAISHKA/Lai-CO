/* ============================================================
   20-app.js — движок расследования
   Движок не знает сюжет: он читает root.CASES и рисует.
   ============================================================ */
(function (root) {
  'use strict';

  var STORE = root.STORE, DOCS = root.DOCS, CASES = root.CASES, HOOKS = root.HOOKS;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    menu: $('view-menu'), list: $('case-list'),
    view: $('view-case'), tbTitle: $('tb-title'), tbSub: $('tb-sub'),
    tbFound: $('tb-found'), tbTotal: $('tb-total'), tbClock: $('tb-clock'), tbRead: $('tb-read'),
    search: $('ev-search'), filters: $('ev-filters'), evList: $('ev-list'),
    btnUnread: $('btn-unread'), btnDensity: $('btn-density'), btnFocus: $('btn-focus'), btnScope: $('btn-scope'),
    trayItems: $('tray-items'), btnCompare: $('btn-compare'),
    reader: $('reader'), readerTitle: $('reader-title'), readerIdx: $('reader-idx'),
    hookBar: $('hook-bar'), hookQuote: $('hook-quote'), btnHook: $('btn-hook'),
    folderNum: $('folder-num'), folderName: $('folder-name'),
    grif: $('doc-grif'), grifCase: $('dg-case'), grifLeaf: $('dg-leaf'), stamp: $('doc-stamp'),
    verdict: $('view-verdict'), verdictBody: $('verdict-body'), verdictSub: $('vd-sub'), verdictClock: $('vd-clock'),
    overlay: $('overlay'), overlayBody: $('overlay-body'), toast: $('toast'),
    panelPersons: $('panel-persons'), panelClues: $('panel-clues'),
    panelProtocol: $('panel-protocol'),
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
    quote: '',          // выделенный в документе фрагмент (будущая цитата в ходатайстве)
    verdictStage: '',   // 'form' — бланк заполняется, 'result' — постановление вынесено
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

  /* клики по экрану постановления */
  ui.verdict.addEventListener('click', function (e) {
    var b = e.target.closest('[data-vact]');
    if (!b) return;
    var a = b.getAttribute('data-vact');
    if (a === 'back') { hideVerdict(); }
    else if (a === 'send') { submitVerdict(); }
    else if (a === 'print') { window.print(); }
    else if (a === 'again') { resetCase(); }
    else if (a === 'menu') { hideVerdict(); toMenu(); }
  });

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
    else if (a === 'hook-dir') { pickDirection(act.getAttribute('data-dir')); }
    else if (a === 'hook-who') { submitHook(act.getAttribute('data-dir'), act.getAttribute('data-who')); }
    else if (a === 'hook-back') { openHookForm(); }
    else if (a === 'summon') { summonPerson(act.getAttribute('data-id')); }
    else if (a === 'play-again') { resetCase(); }
    else if (a === 'print') { window.print(); }
    else if (a === 'to-menu') { closeOverlay(); toMenu(); }
  });

  /* ============================================================
     ТИТУЛЬНЫЙ ЭКРАН
     ============================================================ */
  function renderMenu() {
    if (!CASES || !CASES.length) {
      ui.list.innerHTML = '<p class="muted">Дела не подключены. Проверьте теги &lt;script&gt; в corp_game.html или Lai_CO.html.</p>';
      return;
    }
    ui.list.innerHTML = CASES.map(function (c) {
      var st = STORE.caseState(c.id);
      var done = st.read.length, total = c.evidence.length;
      var closed = total - Object.keys(HOOKS.availableSet(c, st)).length;
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
    if (root.REPORT && S.def) root.REPORT.act(S.def.id, 'pause');
    S.def = null; S.st = null; S.cur = null; S.tray = [];
    document.body.classList.remove('board-open');
    if (ui.verdict) ui.verdict.classList.add('hidden');
    S.verdictStage = '';
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
    /* сейвы до механики зацепок: добираем новые поля */
    if (!S.st.hooks) S.st.hooks = [];
    if (!S.st.calls) S.st.calls = [];
    if (!S.st.protocol) S.st.protocol = [];
    if (!S.st.started) { S.st.started = Date.now(); patch({ started: S.st.started }); }
    S.cur = null; S.tray = []; S.cat = '__all'; S.query = ''; S.quote = '';
    S.fresh = [];
    if (S.st.verdict) S.st.revealAll = true;   // сданное дело показываем целиком
    S.avail = null;
    refreshAvail(true);
    hideHookBar();
    ui.search.value = '';
    ui.menu.classList.add('hidden');
    ui.view.classList.remove('hidden');
    ui.tbTitle.textContent = def.num + ' — ' + def.title;
    ui.tbSub.textContent = def.meta.place;
    /* каркас: корешок папки и гриф documents */
    if (ui.folderNum) ui.folderNum.textContent = 'ДЕЛО ' + def.num;
    if (ui.folderName) ui.folderName.textContent = def.title;
    if (ui.grifCase) ui.grifCase.textContent = def.num + ' · ' + (def.meta && def.meta.date ? def.meta.date : 'б/д');
    if (ui.stamp) { ui.stamp.className = 'doc-stamp hidden'; ui.stamp.textContent = ''; }
    if (ui.grif) ui.grif.classList.add('hidden');
    if (ui.verdict) ui.verdict.classList.add('hidden');
    if (ui.view.classList) ui.view.classList.remove('hidden');
    S.verdictStage = '';
    ui.tbTotal.textContent = (def.contradictions || []).length;
    ui.tbFound.textContent = S.st.found.length;
    ui.notesArea.value = S.st.notes || '';
    renderFilters(); renderList(); renderTray(); renderPersons(); renderClues(); renderProtocol(); renderTimeline();
    switchTab('persons');
    ui.reader.innerHTML = '<div class="empty">Откройте документ из папки дела слева. Читайте внимательно и выделяйте мышью всё, что '
      + 'цепляет взгляд: номер, фамилию, время, странность. По выделенному фрагменту подаётся ходатайство о проверке — '
      + 'так в дело поступают новые материалы.</div>';
    ui.readerTitle.textContent = 'Выберите документ слева';
    ui.readerIdx.textContent = '';
    startClock();
    if (root.REPORT) root.REPORT.act(id, 'start');
    if (!S.st.read.length) showBriefing();
  }

  function showBriefing() {
    var c = S.def;
    var roots = c.evidence.filter(function (e) { return HOOKS.isRoot(e); }).length;
    var html = '<div class="gate-icon">🗂</div>'
      + '<h2 class="ov-title">' + esc(c.num) + ' — ' + esc(c.title) + '</h2>'
      + '<p class="ov-sub">' + esc(c.meta.date) + ' · ' + esc(c.meta.place) + ' · ' + esc(c.rating) + '</p>'
      + '<div class="prose">' + (c.logline ? '<p class="ov-log">' + esc(c.logline) + '</p>' : '')
      + c.briefing.map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>'
      + (c.meta.note ? '<div class="doc-note">' + c.meta.note + '</div>' : '')
      + '<div class="brief-rules"><b>Порядок работы</b><ol>'
      + '<li>В деле ' + roots + ' первичных' + plural(roots, 'й материал', 'х материала', 'х материалов')
      + ' — они у вас сразу. Остальные документы приходят ТОЛЬКО по вашему ходатайству.</li>'
      + '<li>Выделите в прочитанном документе фрагмент (от 12 знаков) — фамилию, номер, время, странность — и нажмите «Взять в разработку».</li>'
      + '<li>Выберите направление проверки. Если цитата действительно указывает туда, материал поступит; нет — основания не примут.</li>'
      + '<li>Отдельное дело — люди: кто упомянут в прочитанном, тот выходит на доску. Протокол допроса придёт только после повестки.</li>'
      + '<li>Если упрётесь — внизу папки есть ходатайство о выемке всего дела. Оно стоит трёх подсказок репутации.</li>'
      + '</ol></div>'
      + '<div class="ov-foot"><button class="btn primary" data-act="close-overlay" data-focus>К материалам дела</button></div>';
    openOverlay(html, { wide: true });
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
      ПОРЯДОК ОТКРЫТИЯ МАТЕРИАЛОВ (правила — в js/15-hook-engine.js)
      Материал поступает в дело, если:
      1) он первичный; 2) на его предка оформленная ЗАЦЕПКА с основанием
      (выделенная цитата + выбранное направление); 3) найдена связь,
      где он второй; 4) это протокол допроса, и на лицо выдана повестка;
      5) автоклапан — если обосновать нечем, документ приходит сам;
      6) подписана выемка всего дела (дорого).
      Простое прочтение документа не открывает ничего.
      ============================================================ */
  function computeAvailable() { return HOOKS.availableSet(S.def, S.st); }

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

  /* группа папки дела: входящие / в работе / приобщённые */
  function groupOf(e) {
    if (S.st.read.indexOf(e.id) < 0) return 'in';
    return HOOKS.pendingDirections(S.def, S.st, e.id).length ? 'work' : 'filed';
  }

  var GROUPS = [
    { key: 'in', name: 'Входящие', hint: 'поступили, ещё не читались' },
    { key: 'work', name: 'В работе', hint: 'прочитаны, по ним ещё есть куда копать' },
    { key: 'filed', name: 'Приобщённые', hint: 'отработаны: оснований больше не видно' }
  ];

  function renderList() {
    var items = visibleEvidence();
    var html = '';
    if (!items.length) {
      html += '<div class="ev-list-empty">' + (S.onlyUnread
        ? 'Непрочитанных поступлений нет. Отключите фильтр, чтобы снова видеть папку дела.'
        : 'Папка пуста. Первичные материалы лежат в «Входящих» — начните с них и подавайте ходатайства о проверке.') + '</div>';
    }
    GROUPS.forEach(function (g) {
      var bucket = items.filter(function (e) { return groupOf(e) === g.key; });
      if (!bucket.length) return;
      html += '<div class="ev-group"><div class="ev-group-h"><b>' + g.name + '</b>'
        + '<span class="ev-group-n">' + bucket.length + '</span></div>';
      html += bucket.map(function (e) { return evRow(e); }).join('');
      html += '</div>';
    });
    html += listFooter();
    ui.evList.innerHTML = html;
    updateMeters();
  }

  function evRow(e) {
    var read = S.st.read.indexOf(e.id) >= 0;
    var isNew = !read && S.fresh.indexOf(e.id) >= 0;
    var inTray = S.tray.indexOf(e.id) >= 0;
    var kind = e.kind || 'doc';
    var sub = [];
    if (e.cat) sub.push(esc(e.cat));
    if (e.at) sub.push('<span class="ev-at">' + esc(e.at) + '</span>');
    var dirs = read ? HOOKS.pendingDirections(S.def, S.st, e.id).length : 0;
    if (dirs) sub.push('<span class="ev-dirs">' + dirs + ' ' + plural(dirs, 'направление', 'направления', 'направлений') + '</span>');
    return '<div class="ev-item ' + (read ? 'read' : 'unread') + (isNew ? ' fresh' : '') + (S.cur === e.id ? ' on' : '') + (inTray ? ' tray-on' : '') + '" data-ev="' + e.id + '" data-kind="' + kind + '">'
      + '<span class="ev-kind" data-glyph="' + DOCS.kindGlyph(kind) + '" data-kind="' + kind + '" title="' + esc(DOCS.kindLabel(kind)) + '"></span>'
      + '<span class="ev-main">'
      + '<span class="ev-t">' + esc(e.title) + (isNew ? '<span class="ev-new">поступило</span>' : '') + '</span>'
      + '<span class="ev-s">' + sub.join('<span class="sep">·</span>') + '</span>'
      + '</span>'
      + '<button class="ev-link' + (inTray ? ' on' : '') + '" data-link="' + e.id + '" title="Отметить для сравнения">🔗</button>'
      + '</div>';
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
    var known = HOOKS.personOrder(S.def, S.st).length;
    var allP = S.def && S.def.persons ? S.def.persons.length : 0;
    badge('persons', known + (allP > known ? '/' + allP : ''));
    badge('clues', found + (links ? '/' + links : ''));
    badge('protocol', S.st && S.st.protocol ? S.st.protocol.length : 0);
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
    var li = HOOKS.lockedInfo(S.def, S.st);
    if (!locked) return '<div class="ev-lock">Материалы дела приобщены полностью.</div>';
    return '<div class="ev-lock">В деле ещё <b>' + locked + '</b> закрыт' + plural(locked, 'ый материал', 'ых материала', 'ых материалов') +
      '. Они поступят по ходатайству: выделите фрагмент в прочитанном документе и выберите направление проверки' +
      (li.ready ? ' (по <b>' + li.ready + '</b> уже видны направления).' : '.') +
      ' <button class="mini" data-act="reveal-all">Ходатайство о выемке всего</button></div>';
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

  /* Гриф на листе: дело, лист дела, основание приобщения.
     Штамп — визуальная память о том, КАК материал попал в дело. */
  function paintGrif(e) {
    if (!ui.grif || !ui.stamp) return;
    var total = S.def.evidence.length, leaf = 0;
    S.def.evidence.forEach(function (x, i) { if (x.id === e.id) leaf = i + 1; });
    if (ui.grifLeaf) ui.grifLeaf.textContent = 'л. д. ' + leaf + ' / ' + total;
    ui.grif.classList.remove('hidden');
    var granted = HOOKS.grantedIds(S.def, S.st);
    var label = granted[e.id] ? 'ПРИОБЩЕНО ПО ХОДАТАЙСТВУ'
      : e.kind === 'talk' ? 'ПРОТОКОЛ ДОПРОСА'
        : HOOKS.isRoot(e) ? 'ВХОДЯЩИЙ' : 'ИЗ МАТЕРИАЛОВ ДЕЛА';
    ui.stamp.textContent = label;
    ui.stamp.className = 'doc-stamp' + (granted[e.id] ? ' stamp-hook' : '');
  }

  function openEvidence(id) {
    var e = evidenceById(id);
    if (!e) return;
    if (!S.avail[id]) return toast('Этот материал ещё не поступил в дело. Основание — ходатайство по прочитанному документу.', 'cool');
    S.cur = id;
    if (root.REPORT) root.REPORT.act(S.def.id, 'doc', id);
    S.quote = '';
    hideHookBar();
    ui.reader.innerHTML = DOCS.render(e);
    paintGrif(e);
    ui.reader.scrollTop = 0;
    ui.readerTitle.textContent = e.title;
    var items = visibleEvidence();
    var pos = -1;
    items.forEach(function (x, i) { if (x.id === id) pos = i; });
    ui.readerIdx.textContent = pos >= 0 ? (pos + 1) + '/' + items.length : '';
    var first = S.st.read.indexOf(id) < 0;
    if (!first) { renderList(); return; }
    S.st.read.push(id);
    var before = HOOKS.personOrder(S.def, S.st).length;
    patch({ read: S.st.read });
    if (e.at) renderTimeline();
    /* ЧТЕНИЕ САМО ПО СЕБЕ НИЧЕГО НЕ ОТКРЫВАЕТ. Пересчёт даёт только
       автоклапан для материалов, где словесного мостика в данных нет. */
    var fresh = refreshAvail();
    var after = HOOKS.personOrder(S.def, S.st).length;
    var newPeople = after - before;
    renderPersons();
    renderFilters();
    renderList();
    if (fresh.length || newPeople) {
      var msg = [];
      if (fresh.length) msg.push(fresh.length + ' ' + plural(fresh.length, 'материал', 'материала', 'материалов'));
      if (newPeople > 0) msg.push('на доске ' + newPeople + ' ' + plural(newPeople, 'новое лицо', 'новых лица', 'новых лиц'));
      toast('Поступило: ' + msg.join(', ') + '.', 'good');
    }
    var dirs = HOOKS.pendingDirections(S.def, S.st, id).length;
    if (dirs) toast('В этом документе ' + dirs + ' ' + plural(dirs, 'направление', 'направления', 'направлений')
      + ' проверки. Выделите фрагмент — и подавайте ходатайство.', 'cool');
  }

  /* ============================================================
     ВЫДЕЛЕНИЕ ФРАГМЕНТА -> ХОДАТАЙСТВО О ПРОВЕРКЕ
     ============================================================ */
  function hideHookBar() {
    if (ui.hookBar) ui.hookBar.classList.add('hidden');
    S.quote = '';
  }

  function currentSelection() {
    var sel = root.getSelection ? root.getSelection() : null;
    if (!sel || sel.isCollapsed) return '';
    var text = String(sel.toString() || '').replace(/\s+/g, ' ').trim();
    if (text.length < 12) return '';
    /* выделение должно быть внутри открытого документа */
    var node = sel.anchorNode;
    while (node && node !== ui.reader) node = node.parentNode;
    if (!node) return '';
    return text.slice(0, 400);
  }

  function onSelectionMaybe() {
    if (!S.cur || overlayOpen()) return;
    var q = currentSelection();
    if (!q) { hideHookBar(); return; }
    S.quote = q;
    ui.hookQuote.textContent = '«' + (q.length > 90 ? q.slice(0, 90) + '…' : q) + '»';
    ui.hookQuote.title = q;
    ui.hookBar.classList.remove('hidden');
  }

  ui.reader.addEventListener('mouseup', onSelectionMaybe);
  ui.reader.addEventListener('keyup', function (e) {
    if (e.key === 'Shift' || e.key.startsWith('Arrow')) onSelectionMaybe();
  });
  if (ui.btnHook) ui.btnHook.addEventListener('click', openHookForm);
  $('btn-hook-clear').addEventListener('click', function () {
    if (root.getSelection) root.getSelection().removeAllRanges();
    hideHookBar();
  });

  function dirLabel(d) {
    return esc(d.cat) + ' <span class="muted xs">' + d.count + ' ' + plural(d.count, 'материал', 'материала', 'материалов') + '</span>';
  }

  /* ложное направление оформляется так же, с правдоподобным счётом,
     иначе ответ выдаётся отсутствием цифры */
  function dirLabelFake(cat) {
    var n = 0;
    (S.def.evidence || []).forEach(function (x) { if (x.cat === cat) n++; });
    if (!n) n = 1;
    return esc(cat) + ' <span class="muted xs">' + n + ' ' + plural(n, 'материал', 'материала', 'материалов') + '</span>';
  }

  /* порядок направлений — псевдослучайный, но устойчивый внутри документа:
     иначе настоящие и ложные различаются местом в списке */
  function catOrder(cat) {
    var s = String(S.cur) + '#' + cat, h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
    return h;
  }

  function openHookForm() {
    var q = S.quote || currentSelection();
    if (!q) return toast('Сначала выделите в документе фрагмент: фамилию, номер, время, странность.', 'bad');
    if (!S.cur) return;
    var e = evidenceById(S.cur);
    var dirs = HOOKS.pendingDirections(S.def, S.st, S.cur).filter(function (d) {
      return HOOKS.checkable(S.def, S.cur, d.cat);
    });
    var decoys = HOOKS.dummies(S.def, S.cur, 2);
    var html = '<div class="gate-icon">📝</div><h2 class="ov-title">Ходатайство о проверке</h2>'
      + '<p class="ov-sub">' + esc(e ? e.title : S.cur) + '</p>'
      + '<blockquote class="hook-quote-box">' + esc(q) + '</blockquote>';
    if (!dirs.length) {
      html += '<div class="prose"><p>По этому документу обосновать проверку нечем: ни одно направление не подтверждается'
        + ' словами вашей цитаты. Ищите зацепку в другом месте или в другом материале.</p></div>'
        + '<div class="ov-foot"><button class="btn primary" data-act="close-overlay" data-focus>Понятно</button></div>';
      return openOverlay(html, { wide: true });
    }
    html += '<p class="muted xs">Куда проверять? Основанием сойдёт только то, что цитата и вправду указывает на направление.</p>'
      + '<div class="hook-dirs">'
      + dirs.map(function (d) { return { cat: d.cat, html: dirLabel(d), decoy: '' }; })
        .concat(decoys.map(function (c) { return { cat: c, html: dirLabelFake(c), decoy: ' decoy' }; }))
        .sort(function (a, b) { return catOrder(a.cat) - catOrder(b.cat); })
        .map(function (o) {
          return '<button class="hook-dir' + o.decoy + '" data-act="hook-dir" data-dir="' + esc(o.cat) + '">' + o.html + '</button>';
        }).join('')
      + '</div>'
      + '<div class="ov-foot"><button class="btn ghost" data-act="close-overlay">Отмена</button></div>';
    openOverlay(html, { wide: true });
  }

  /* направление может вести на людей: тогда спрашиваем, кого вызывать */
  function pickDirection(cat) {
    var dir = HOOKS.directions(S.def, S.cur).filter(function (d) { return d.cat === cat; })[0];
    /* направления нет (выбрали наугад) -> судья откажет с внятной причиной */
    if (!dir) return submitHook(cat, '');
    var talks = dir.ids.filter(function (id) {
      var e = evidenceById(id);
      return e && e.kind === 'talk' && !S.st.read.some(function (x) { return x === id; });
    });
    if (!talks.length) return submitHook(cat, '');
    var names = {};
    talks.forEach(function (id) {
      var e = evidenceById(id);
      (e.tags || []).forEach(function (pid) {
        var p = HOOKS.personById(S.def, pid);
        if (!p) return;
        names[pid] = p;
      });
    });
    var known = HOOKS.knownPersons(S.def, S.st);
    var html = '<div class="gate-icon">👤</div><h2 class="ov-title">Направление: ' + esc(cat) + '</h2>'
      + '<blockquote class="hook-quote-box">' + esc(S.quote) + '</blockquote>'
      + '<div class="prose"><p>Направление «' + esc(cat) + '» — это люди. Протокол допроса сам не поступает: сначала повестка. Кого вызываем?</p></div>'
      + '<div class="hook-dirs">'
      + Object.keys(names).map(function (pid) {
        var p = names[pid];
        return '<button class="hook-dir" data-act="hook-who" data-dir="' + esc(cat) + '" data-who="' + esc(pid) + '">'
          + esc(p.short || p.name) + ' <span class="muted xs">' + esc(p.role || '') + '</span>'
          + (known[pid] ? '' : ' <span class="pill">ещё не в деле</span>') + '</button>';
      }).join('')
      + '</div>'
      + '<div class="ov-foot"><button class="btn ghost" data-act="hook-back">Назад</button></div>';
    openOverlay(html, { wide: true });
  }

  function submitHook(cat, who) {
    var q = S.quote;
    if (!q || !S.cur) return closeOverlay();
    var j = HOOKS.judge(S.def, S.cur, cat, q);
    var e = evidenceById(S.cur);
    if (!j.ok) {
      return openOverlay('<div class="gate-icon">🚫</div><h2 class="ov-title">Оснований не вижу</h2>'
        + '<blockquote class="hook-quote-box">' + esc(q) + '</blockquote>'
        + '<div class="prose"><p>Прокурор не усмотрел связи между этим фрагментом и направлением «' + esc(cat) + '». '
        + (j.reason === 'нет-такого-направления'
          ? 'Вам известен другой выход из этого документа — или направление выбрано наугад.'
          : 'В цитате нет указывающего слова: того, чем этот документ и искомые материалы говорят об одном и том же.')
        + '</p><p>Ищите в тексте фамилию, номер, марку, время — что-то, что обязательно всплывёт в ответе проверки.</p></div>'
        + '<div class="ov-foot"><button class="btn primary" data-act="hook-back" data-focus>Подобрать другое</button></div>');
    }
    var hook = { ev: S.cur, quote: q, dir: cat, who: who || '', ok: true, soft: !!j.soft, ts: Date.now() };
    S.st.hooks.push(hook);
    var entry = { t: 'hook', ts: Date.now(), ev: S.cur, dir: cat, quote: q, who: who || '' };
    var person = who ? HOOKS.personById(S.def, who) : null;
    if (person) {
      /* зацепка на человека: повестка, и она же выводит лицо на доску */
      if (!(S.st.calls || []).some(function (c) { return (c.pid || c) === person.id; })) {
        S.st.calls.push({ pid: person.id, ts: Date.now() });
        entry.summons = person.id;
      }
    }
    S.st.protocol.push(entry);
    patch({ hooks: S.st.hooks, calls: S.st.calls, protocol: S.st.protocol });
    var fresh = refreshAvail();
    hideHookBar();
    renderFilters(); renderList(); renderPersons(); renderProtocol();
    var list = fresh.map(function (id) {
      var x = evidenceById(id);
      return '<li><button class="link-ev" data-act="show-evidence" data-id="' + id + '">' + esc(x ? x.title : id) + '</button></li>';
    }).join('');
    openOverlay('<div class="gate-icon">🆗</div><h2 class="ov-title">Ходатайство принято</h2>'
      + '<p class="ov-sub">' + esc(e ? e.title : hook.ev) + ' → ' + esc(cat) + (person ? ' → допрос: ' + esc(person.short || person.name) : '') + '</p>'
      + '<blockquote class="hook-quote-box">' + esc(q) + '</blockquote>'
      + '<div class="prose"><p>' + (j.soft
        ? 'Основание принято как косвенное: указывающего слова нет, но направление и имя в цитате совпали.'
        : 'Указывающие слова: <b>' + j.matched.map(esc).join(', ') + '</b>.') + '</p></div>'
      + (list ? '<div class="reveal-h">Поступило в дело</div><ul class="hook-arrived">' + list + '</ul>'
        : (person ? '<div class="doc-note">Повестка ушла. Протокол допроса появится, когда лицо выйдет на доску.</div>' : ''))
      + '<div class="ov-foot"><button class="btn primary" data-act="close-overlay" data-focus>Работаем дальше</button></div>', { wide: true });
  }

  function summonPerson(pid) {
    var p = HOOKS.personById(S.def, pid);
    if (!p) return;
    if ((S.st.calls || []).some(function (c) { return (c.pid || c) === pid; })) return toast('Повестка уже ушла.', 'cool');
    S.st.calls.push({ pid: pid, ts: Date.now() });
    S.st.protocol.push({ t: 'summon', ts: Date.now(), pid: pid });
    patch({ calls: S.st.calls, protocol: S.st.protocol });
    var fresh = refreshAvail();
    renderPersons(); renderList(); renderFilters(); renderProtocol();
    toast('Повестка ушла: ' + (p.short || p.name) + (fresh.length ? '. В дело поступило: ' + fresh.length : '.'), fresh.length ? 'good' : 'cool');
  }

  /* ============================================================
     ПРОТОКОЛ ХОДА РАССЛЕДОВАНИЯ
     ============================================================ */
  function renderProtocol() {
    if (!ui.panelProtocol || !S.st) return;
    var items = (S.st.protocol || []).slice().reverse();
    if (!items.length) {
      ui.panelProtocol.innerHTML = '<p class="panel-hint">Здесь будет порядок действий: принятые ходатайства, вызовы на допрос, найденные связи. '
        + 'Пока что вы только читаете.</p>';
      return;
    }
    ui.panelProtocol.innerHTML = '<div class="protocol">' + items.map(function (it) {
      var e = it.ev ? evidenceById(it.ev) : null;
      var p = it.pid ? HOOKS.personById(S.def, it.pid) : null;
      if (it.t === 'hook') {
        return '<div class="proto-row"><span class="proto-k">ходатайство</span>'
          + '<div class="proto-x"><b>' + esc(e ? e.title : it.ev) + '</b> → ' + esc(it.dir)
          + '<blockquote>' + esc(it.quote) + '</blockquote></div></div>';
      }
      if (it.t === 'summon') {
        return '<div class="proto-row"><span class="proto-k">повестка</span>'
          + '<div class="proto-x">' + esc(p ? p.name : it.pid) + '</div></div>';
      }
      if (it.t === 'link') {
        var l = HOOKS.linkById(S.def, it.id);
        return '<div class="proto-row"><span class="proto-k">связь</span>'
          + '<div class="proto-x">' + esc(l ? l.reveals : it.id) + '</div></div>';
      }
      if (it.t === 'reveal') {
        return '<div class="proto-row"><span class="proto-k bad">выемка</span>'
          + '<div class="proto-x">Ходатайство о выемке всех материалов дела. Репутация: минус 3 подсказки.</div></div>';
      }
      return '';
    }).join('') + '</div>';
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
    S.st.protocol.push({ t: 'reveal', ts: Date.now() });
    patch({ protocol: S.st.protocol });
    refreshAvail();
    renderFilters(); renderList(); renderPersons(); renderProtocol(); renderTimeline();
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
      S.st.protocol.push({ t: 'link', id: link.id, ts: Date.now() });
      patch({ found: S.st.found, suspects: S.st.suspects, protocol: S.st.protocol });
      ui.tbFound.textContent = S.st.found.length;
      var fresh = refreshAvail();
      renderPersons(); renderClues(link.id); renderProtocol(); renderTimeline();
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
    var list = HOOKS.personOrder(S.def, S.st);
    var known = HOOKS.knownPersons(S.def, S.st);
    var callTargets = {};
    HOOKS.summonsTargets(S.def, S.st).forEach(function (t) { callTargets[t.person.id] = t.count; });
    var called = HOOKS.calledMap(S.st);
    var hidden = (S.def.persons || []).length - list.length;
    var html = '<div class="persons-note">В разработке <b>' + list.length + '</b> '
      + plural(list.length, 'лицо', 'лица', 'лиц')
      + (hidden > 0 ? '; ещё <b>' + hidden + '</b> по делу не ' + plural(hidden, 'установлено', 'установлено', 'установлено')
        + ' — фамилии всплывут в материалах' : '; все установлены') + '.</div>';
    html += list.map(function (p) {
      var mark = S.st.suspects[p.id];
      var flags = '';
      if (p.kind === 'victim') flags = '<span class="flag">потерпевший</span>';
      else if (mark === 'accused') flags = '<span class="flag accused">обвиняемый</span>';
      else if (mark === 'watch') flags = '<span class="flag bad">под подозрением</span>';
      else if (mark === 'clear') flags = '<span class="flag good">алиби</span>';
      var n = evidenceFor(p.id).length;
      var btn = '';
      if (callTargets[p.id]) btn = '<button class="mini summon" data-act="summon" data-id="' + esc(p.id) + '">Вызвать на допрос (' + callTargets[p.id] + ')</button>';
      else if (called[p.id]) btn = '<span class="flag">повестка ушла</span>';
      return '<div class="person' + (p.kind === 'npc' ? ' npc' : '') + '" data-person="' + p.id + '">'
        + '<div class="avatar">' + esc(p.initials || '??') + '</div>'
        + '<div><div class="p-name">' + esc(p.short || p.name) + '</div><div class="p-role">' + esc(p.role) + '</div>'
        + '<div class="p-why">' + esc(known[p.id] || '') + '</div></div>'
        + (flags ? '<div class="p-flags">' + flags + '</div>' : '')
        + (n ? '<div class="p-claim">' + n + ' ' + plural(n, 'материал', 'материала', 'материалов') + ' с упоминанием</div>' : '')
        + (btn ? '<div class="p-act">' + btn + '</div>' : '')
        + '</div>';
    }).join('');
    ui.panelPersons.innerHTML = html;
  }

  ui.panelPersons.addEventListener('click', function (e) {
    var s = e.target.closest('[data-act="summon"]');
    if (s) { summonPerson(s.getAttribute('data-id')); return; }
    var p = e.target.closest('[data-person]');
    if (p) showPerson(p.getAttribute('data-person'));
  });

  function showPerson(pid) {
    var p = personById(pid);
    if (!p) return;
    var mark = S.st.suspects[pid];
    var ev = evidenceFor(pid);
    var known = HOOKS.knownPersons(S.def, S.st);
    var called = HOOKS.calledMap(S.st);
    var pending = HOOKS.summonsTargets(S.def, S.st).filter(function (t) { return t.person.id === pid; })[0];
    var links = (S.def.contradictions || []).filter(function (c) {
      return c.flags && c.flags[pid] && S.st.found.indexOf(c.id) >= 0;
    });
    var btn = function (v, label, cls) {
      return '<button class="mini ' + cls + (mark === v ? ' on' : '') + '" data-act="flag-person" data-id="' + pid + '" data-v="' + v + '">' + label + '</button>';
    };
    openOverlay('<h2 class="ov-title">' + esc(p.name) + '</h2>'
      + '<p class="ov-sub">' + esc(p.role) + (p.kind === 'victim' ? ' · потерпевший' : '') + ' · ' + esc(known[pid] || 'в деле') + '</p>'
      + '<div class="prose"><p>' + esc(p.bio) + '</p>'
      + (p.claim && p.claim !== '—' ? '<p><b>Что утверждает:</b> ' + esc(p.claim) + '</p>' : '')
      + '</div>'
      + (p.kind === 'suspect' ? '<div class="board-actions">' + btn('watch', 'под подозрением', 'bad') + btn('clear', 'алиби подтверждено', 'good') + '</div>' : '')
      + (pending ? '<div class="doc-note">По этому лицу есть ещё не поступивший протокол допроса: <b>' + pending.count + '</b> '
        + plural(pending.count, 'документ', 'документа', 'документов') + '.</div>'
        + '<div class="board-actions"><button class="btn primary sm" data-act="summon" data-id="' + esc(pid) + '">Вызвать на допрос</button></div>' : '')
      + (called[pid] ? '<div class="doc-note">Повестка выдана, ждём протокол.</div>' : '')
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
    if (root.REPORT) root.REPORT.act(S.def.id, 'flag', { pid: pid, v: S.st.suspects[pid] || '' });
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
    ['persons', 'clues', 'protocol', 'timeline', 'notes'].forEach(function (n) {
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
    if (root.REPORT) root.REPORT.act(S.def.id, 'hint', { n: S.st.hints });
    var h = hints[n];
    var lockedNote = (!S.st.revealAll && lockedCount())
      ? '<p class="muted xs">Если нужного документа нет в папке дела — он ещё не поступил: подайте ходатайство о проверке по выделенному фрагменту прочитанного. '
        + 'Внизу папки есть ходатайство о выемке всего дела, но оно стоит трёх подсказок репутации.</p>'
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

  /* ============================================================
     ПОСТАНОВЛЕНИЕ — отдельный экран, а не всплывающее окно.
     Бланк печатается как настоящий документ: шапка, поля, подпись.
     ============================================================ */
  function showVerdict(stage) {
    S.verdictStage = stage;
    closeOverlay();
    ui.view.classList.add('hidden');
    ui.verdict.classList.remove('hidden');
    document.body.classList.remove('board-open');
    if (ui.verdictClock) ui.verdictClock.textContent = fmtClock(S.st ? S.st.clockMs : 0);
    if (ui.verdictSub && S.def) ui.verdictSub.textContent = S.def.num + ' — ' + S.def.title;
    var sc = $('verdict-scroll');
    if (sc) sc.scrollTop = 0;
  }

  function hideVerdict() {
    S.verdictStage = '';
    ui.verdict.classList.add('hidden');
    ui.view.classList.remove('hidden');
  }

  function postanHead(sub) {
    var d = S.def, m = d.meta || {};
    return '<header class="pa-head">'
      + '<div class="pa-cap">' + esc(m.org || 'Управление безопасности') + '</div>'
      + '<h2 class="pa-title">Постановление' + (sub ? '<span class="pa-sub">' + esc(sub) + '</span>' : '') + '</h2>'
      + '<div class="pa-meta"><span>дело ' + esc(d.num) + '</span>'
      + (m.date ? '<span>' + esc(m.date) + '</span>' : '')
      + '<span>экз. № 1</span></div>'
      + '<div class="pa-rule"></div>'
      + '</header>';
  }

  function openAccuse() {
    var f = S.def.objective.fields;
    var html = postanHead('о результатах служебной проверки')
      + '<p class="pa-intro">' + esc(S.def.objective.intro) + '</p>'
      + '<div class="pa-fields">'
      + f.map(function (field) {
        return '<label class="pa-field"><span class="pa-flabel">' + esc(field.label) + '</span>'
          + '<span class="pa-fline"><select id="fld-' + field.id + '" data-field="' + field.id + '">'
          + '<option value="">— не установлено —</option>'
          + field.options.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('')
          + '</select></span></label>';
      }).join('')
      + '</div>'
      + '<div class="pa-sign">'
      + '<div class="pa-sign-row"><span class="psr-role">Следователь по особым поручениям</span>'
      + '<i class="psr-line"></i><span class="muted xs">подпись</span></div>'
      + '<div class="pa-sign-row"><span class="psr-role">Дата составления</span>'
      + '<i class="psr-line short"></i><span class="muted xs">' + esc((S.def.meta || {}).date || '———') + '</span></div>'
      + '</div>'
      + '<div class="pa-foot">'
      + '<button class="btn ghost" data-vact="back">Вернуться к материалам</button>'
      + '<button class="btn primary" data-vact="send">Подписать и сдать</button>'
      + '</div>';
    ui.verdictBody.innerHTML = html;
    showVerdict('form');
    var first = ui.verdictBody.querySelector('select');
    if (first) first.focus();
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
    });
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
    if (root.REPORT) root.REPORT.act(S.def.id, 'submit', { score: score, win: badge === 'win' });
    stopClock();
    /* после сдачи открываем дело целиком: можно дочитать и добрать связи */
    S.st.revealAll = true;
    refreshAvail();
    renderFilters(); renderList(); renderPersons();

    var html = postanHead('о результатах служебной проверки')
      + '<div class="verdict-badge ' + badge + '">'
      + (badge === 'win' ? 'ДЕЛО РАСКРЫТО' : badge === 'partial' ? 'ЧАСТИЧНО' : 'НЕ РАСКРЫТО')
      + '</div><h3 class="pa-name">' + esc(S.def.title) + '</h3>'
      + '<p class="pa-intro">' + text + '</p>'
      + '<table class="score-table"><tbody>' + rows + '</tbody></table>'
      + '<table class="score-table"><tbody>'
      + '<tr><td>Найдено противоречий <span class="muted xs">· на оценку не влияет</span></td><td>' + links + ' / ' + total + '</td></tr>'
      + '<tr><td>Прочитано документов <span class="muted xs">· на оценку не влияет</span></td><td>' + S.st.read.length + ' / ' + S.def.evidence.length + '</td></tr>'
      + '<tr><td>Ходатайств о проверке принято <span class="muted xs">· на оценку не влияет</span></td><td>' + (S.st.hooks || []).length + '</td></tr>'
      + '<tr><td>Повесток на допрос <span class="muted xs">· на оценку не влияет</span></td><td>' + (S.st.calls || []).length + '</td></tr>'
      + '<tr><td>Подсказок учтено</td><td>' + hints + (S.st.revealAll ? ' <span class="muted xs">(из них 3 — за ходатайство о выемке всего дела вместо работы с основаниями)</span>' : '') + '</td></tr>'
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
      + '<div class="pa-foot">'
      + '<button class="btn ghost" data-vact="print">Печать разбора</button>'
      + '<button class="btn ghost" data-vact="again">Играть это дело заново</button>'
      + '<button class="btn primary" data-vact="menu">К списку дел</button></div>';
    ui.verdictBody.innerHTML = html;
    showVerdict('result');
  }

  function resetCase() {
    var id = S.def.id;
    var st = STORE.load();
    delete st.cases[id];
    STORE.save(st);
    var def = S.def;
    toMenu();
    if (root.REPORT) root.REPORT.forget(def.id);
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
      if (ui.verdictClock && !ui.verdict.classList.contains('hidden')) ui.verdictClock.textContent = ui.tbClock.textContent;
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
    var hk = (st.hooks || []).length, sm = (st.calls || []).length;
    var known = HOOKS.personOrder(C, st).length;
    rows += '<tr><td>Прочитано материалов</td><td>' + Object.keys(readIds).length + ' / ' + total + '</td></tr>';
    rows += '<tr class="' + (open >= total ? 'ok' : 'mid') + '"><td>Приобщено к делу</td><td>' + open + ' / ' + total
      + (open < total ? ' <span class="muted xs">(ещё ' + (total - open) + ' закрыто)</span>' : '') + '</td></tr>';
    rows += '<tr><td>Ходатайств о проверке принято</td><td>' + hk + '</td></tr>';
    rows += '<tr><td>Повесток на допрос</td><td>' + sm + '</td></tr>';
    rows += '<tr><td>Лиц в разработке</td><td>' + known + ' <span class="muted xs">из ' + ((C.persons || []).length) + ' по делу</span></td></tr>';
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
      + '<b>J</b><span>взять выделенный фрагмент в разработку (ходатайство о проверке)</span>'
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
      + '<p class="muted xs">Как поступают материалы: выделите мышью фрагмент прочитанного документа (от 12 знаков) и нажмите «Взять в разработку» '
      + 'или клавишу J. Выберите направление проверки — если цитата на него указывает, документ поступит. '
      + 'Люди выходят на доску, когда фамилия упомянута в прочитанном; протокол допроса приходит после повестки. '
      + 'Связывать улики необязательно — на итоговую оценку влияют только ответы в заключении.</p>'
      + '<div class="ov-foot"><button class="btn primary" data-act="close-overlay" data-focus>Понятно</button></div>');
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') {
      if (overlayOpen()) closeOverlay();
      else if (S.verdictStage === 'form') hideVerdict();
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
      case 'j': case 'J': case 'о': case 'О':
        if (S.quote || currentSelection()) openHookForm(); else toast('Выделите в документе фрагмент — тогда его можно взять в разработку.', 'cool');
        break;
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
