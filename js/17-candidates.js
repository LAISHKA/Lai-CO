/* ============================================================
   17-candidates.js — КАНДИДАТЫ: движок сам подчёркивает в тексте
   типовые узлы (дата, время, номер, сумма, фамилия, место), по
   которым можно подать ходатайство. Чинит «гадание на слово»:
   игроку видно, ГДЕ вообще можно выделить фрагмент.

   НИКАКОЙ новой механики принятия/отказа. Подчёркнутый узел — это
   ровно то же самое, что игрок выделил мышью: клик по узлу
   выставляет обычное браузерное выделение (Range + getSelection) и
   зовёт штатный путь — колбэк из js/20-app.js, то есть панель
   «Взять в разработку» -> форма ходатайства -> судья. Сами узлы
   ходатайство НЕ подают, счётчиков зацепок нет, кнопки «подсветить
   всё» нет, «правильные» узлы ничем не отличаются от пустых.

   Анти-спойлер: класс узла определяется ТОЛЬКО формой текста
   (регекспы) и открытыми словарями дела — persons[].short,
   persons[].name (фамилия отдельно), evidence[].where, варианты
   ответа поля place из objective.fields. План связей, верный ответ
   бланка и вывод сюда не заходят вообще: подсветка равномерна.

   Состояние «узел уже отработан» (.cand.used) в этой полосе НЕ
   делается: журнал sr.journal.v1 пишет js/30-report.js, а он в
   списке «не трогать». Подчёркивание узла, по которому игрок уже
   подавал, остаётся точно таким же — верность не угадывается.

   Файл обязан грузиться без DOM: tools/validate.mjs выполняет все
   <script src> из входных страниц в заглушке окна. Без DOM файл
   не падает и ничего не делает (hasDom(), как в js/30-report.js).

   Публичное API: window.CANDIDATES = { mark, clear, CLASSES, scan, dictFor }
   mark(rootEl, def, onPick) — разметить rootEl словарём дела def;
   onPick() — штатный путь ходатайства, который вызовет движок после
   того, как клик по узлу выставил выделение.
   scan()/dictFor() — чистые функции без DOM: их зовёт
   tools/check-candidates.cjs, чтобы гейт считал узлы тем же кодом,
   что и браузер, а не своей копией правил.
   ============================================================ */
(function (root) {
  'use strict';

  var CLASSES = ['date', 'time', 'num', 'sum', 'person', 'place'];

  /* ============================================================
     окружение
     ============================================================ */
  function hasDom() {
    return typeof document !== 'undefined' && !!document
      && typeof document.getElementById === 'function';
  }

  var SP = '\\s';                    // \s в JS захватывает и nbsp, и узкие пробелы
  var LETTER = /[0-9A-Za-zА-Яа-яЁё]/;
  /* узел не должен начинаться с середины слова и обрываться на букве/цифре */
  function edgeOk(text, start, end) {
    if (start > 0 && LETTER.test(text.charAt(start - 1))) return false;
    if (start > 0 && text.charAt(start - 1) === '№') return false;
    if (end < text.length && LETTER.test(text.charAt(end))) return false;
    return true;
  }

  /* ============================================================
     1. узлы по форме текста
     ============================================================ */
  var RE_DATE = new RegExp('\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?', 'g');
  /* секунды регистратора («20:35:12») прихватываем целиком — форма та же */
  var RE_TIME = new RegExp('\\d{1,2}:\\d{2}(?::\\d{2})?', 'g');
  /* номер: «№ 44-к», «№ 163-Н», «№ 128» — хвост допускает кириллицу */
  var RE_NUM = new RegExp('№' + SP + '?\\d+[-\\wА-Яа-яЁё]*', 'g');
  /* сумма: сгруппированные тысячи (с пробелом) и явные масштабы */
  var RE_SUM = new RegExp(
    '\\d{1,3}(?:' + SP + '\\d{3})+(?:' + SP + '*(?:руб\\.?|₽|коп\\.?))?'
    + '|\\d+(?:[.,]\\d{1,2})?' + SP + '?(?:тыс\\.|тыс|млн\\.|млн|млрд\\.|млрд)',
    'g');
  /* топоним по форме: «г. Перелеска» — открытый текст, ни о чём не выдаёт правду */
  var RE_CITY = new RegExp('г\\.' + SP + '*[А-ЯЁ][а-яё]{2,}', 'g');

  var FORM = [
    { t: 'date', re: RE_DATE },
    { t: 'time', re: RE_TIME },
    { t: 'num', re: RE_NUM },
    { t: 'sum', re: RE_SUM },
    { t: 'place', re: RE_CITY }
  ];

  /* ============================================================
     2. словари дела (только открытые поля формы)
     ============================================================ */
  var STOP_PLACE = ('папка папки лист листа листы дело дела документ документы материал материалы '
    + 'копия подлинник оригинал бланк формат журнал приказ акт выписка протокол опрос допрос '
    + 'объяснительная записка номенклатура личное основное учётное учетное '
    + 'год месяца квартал дата подпись номер раздел часть примечание приложение опись').split(' ');
  var STOPMAP = {};
  STOP_PLACE.forEach(function (w) { STOPMAP[norm(w)] = 1; });

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е'); }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* русское слово склоняется: берём основу и позволяем окончание */
  function stemOf(word) {
    var w = String(word);
    if (/(?:ий|ой|ая|яя|и[яею])$/.test(w)) return w.slice(0, -2);
    if (/а$/.test(w) && w.length > 4) return w.slice(0, -1);
    return w;
  }
  /* длина окончания: чем короче основа, тем меньше хвост подбираем */
  function tailOf(word) {
    var w = String(word);
    return (/(?:ий|ой|ая|яя|и[яею])$/.test(w)) ? '{1,4}' : '{0,3}';
  }
  function wordRe(word, flags) {
    return new RegExp(escRe(stemOf(word)) + '[а-яёА-ЯЁ]' + tailOf(word), flags);
  }

  /* слово в словарь: только кириллица с большой буквы, не канцеляризм
     (стоп-лист включают для мест; фамилии не фильтруем — там шум не водится) */
  function pushWord(list, seen, word, flags, stop) {
    var w = String(word || '').replace(/[«»"().,;:!?]/g, '');
    if (w.length < 4) return;
    if (!/^[А-ЯЁ][а-яё]+$/.test(w)) return;
    var key = norm(w);
    if (stop && STOPMAP[key]) return;
    if (seen[key]) return;
    seen[key] = 1;
    list.push({ w: w, re: wordRe(w, flags) });
  }

  function eachWord(str, cb) {
    String(str == null ? '' : str).split(/[^А-Яа-яЁё]+/).forEach(cb);
  }

  /* фамилия: short + первая строка name (фамилия отдельно), без аллиасов — их в данных нет */
  function personList(def) {
    var out = [], seen = {};
    (def.persons || []).forEach(function (p) {
      if (!p) return;
      eachWord(p.short, function (w) { pushWord(out, seen, w, 'g'); });
      var name = String(p.name || '').trim().split(/\s+/)[0] || '';
      pushWord(out, seen, name, 'g');
    });
    return out;
  }

  /* место: значения evidence[].where этого дела + варианты ответа поля place.
     Берём только существительные/прилагательные с большой буквы: строчные
     канцеляризмы («материалов расследования») подсветили бы весь текст. */
  function placeList(def) {
    var out = [], seen = {};
    (def.evidence || []).forEach(function (e) {
      eachWord(e && e.where, function (w) { pushWord(out, seen, w, 'gi', 1); });
    });
    var fields = (def.objective && def.objective.fields) || [];
    fields.forEach(function (f) {
      if (!f || String(f.id) !== 'place') return;
      (f.options || []).forEach(function (o) {
        var label = o && typeof o !== 'string' ? (o[o.length - 1] || '') : o;
        eachWord(label, function (w) { pushWord(out, seen, w, 'gi', 1); });
      });
    });
    return out;
  }

  var DICTS = {};
  function dictFor(def) {
    if (!def) return { person: [], place: [] };
    var key = String(def.id || '');
    if (key && DICTS[key]) return DICTS[key];
    var d = { person: personList(def), place: placeList(def) };
    if (key) DICTS[key] = d;
    return d;
  }

  /* ============================================================
     3. scan: список узлов в одном тексте
     ============================================================ */
  function harvest(out, text, re, type) {
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(text))) {
      var a = m.index, b = a + m[0].length;
      if (b <= a) break;
      if (edgeOk(text, a, b)) out.push({ start: a, end: b, t: type });
    }
  }

  /* при равном начале берём более длинный узел, далее — по порядку классов */
  var RANK = { num: 0, date: 1, time: 2, sum: 3, person: 4, place: 5 };
  function rankOf(t) { return RANK[t] === undefined ? 9 : RANK[t]; }

  function squeeze(list) {
    list.sort(function (a, b) {
      if (a.start !== b.start) return a.start - b.start;
      var la = a.end - a.start, lb = b.end - b.start;
      if (la !== lb) return lb - la;
      return rankOf(a.t) - rankOf(b.t);
    });
    var res = [], end = -1;
    list.forEach(function (m) {
      if (m.start < end) return;
      res.push(m);
      end = m.end;
    });
    return res;
  }

  function scan(text, dict) {
    var s = String(text == null ? '' : text);
    if (!s) return [];
    var found = [];
    FORM.forEach(function (f) { harvest(found, s, f.re, f.t); });
    if (dict) {
      (dict.person || []).forEach(function (o) { harvest(found, s, o.re, 'person'); });
      (dict.place || []).forEach(function (o) { harvest(found, s, o.re, 'place'); });
    }
    return squeeze(found);
  }

  /* ============================================================
     4. разметка DOM
     ============================================================ */
  function classOf(el) {
    if (!el) return '';
    return String(el.className || (el.getAttribute ? (el.getAttribute('class') || '') : ''));
  }
  function isCand(el) { return (' ' + classOf(el) + ' ').indexOf(' cand') >= 0; }

  function skipNode(node) {
    var p = node.parentNode;
    if (!p || p.nodeType !== 1) return true;
    var tag = String(p.nodeName || '').toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'TITLE') return true;
    if (isCand(p)) return true;
    return false;
  }

  function wrapNode(doc, node, dict) {
    var text = node.nodeValue;
    if (!text || text.length < 2) return;
    if (skipNode(node)) return;
    var ms = scan(text, dict);
    if (!ms.length) return;
    var frag = doc.createDocumentFragment();
    var last = 0;
    ms.forEach(function (m) {
      if (m.start > last) frag.appendChild(doc.createTextNode(text.slice(last, m.start)));
      var sp = doc.createElement('span');
      sp.classList.add('cand');
      sp.setAttribute('data-t', m.t);
      sp.setAttribute('tabindex', '0');
      sp.appendChild(doc.createTextNode(text.slice(m.start, m.end)));
      frag.appendChild(sp);
      last = m.end;
    });
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
    if (node.parentNode) node.parentNode.replaceChild(frag, node);
  }

  /* делегирование на элементе читалки: слушателей на window не вешаем */
  function bind(el) {
    if (el.__candBound) return;
    el.__candBound = 1;
    el.addEventListener('click', function (ev) { pick(el, ev, false); });
    el.addEventListener('keydown', function (ev) {
      if (!ev || String(ev.key) !== 'Enter') return;
      if (pick(el, ev, true) && ev.preventDefault) ev.preventDefault();
    });
  }

  function selectNode(doc, sel, sp) {
    if (!sel || !doc || typeof doc.createRange !== 'function') return false;
    if (typeof sel.removeAllRanges !== 'function' || typeof sel.addRange !== 'function') return false;
    var r = doc.createRange();
    r.selectNodeContents(sp);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }

  function pick(el, ev, isKey) {
    var t = ev && ev.target;
    if (!t || typeof t.closest !== 'function') return false;
    var sp = t.closest('.cand');
    if (!sp || !el.contains(sp)) return false;
    var doc = el.ownerDocument || (hasDom() ? document : null);
    if (!doc) return false;
    var sel = doc.getSelection ? doc.getSelection() : null;
    /* игрок тащит мышью своё выделение — не мешаем, работает штатный mouseup */
    if (!isKey && sel && !sel.isCollapsed) return false;
    /* выставили выделение -> дальше идёт штатный путь (панель -> ходатайство) */
    selectNode(doc, sel, sp);
    var cb = el.__candPick;
    if (typeof cb === 'function') cb(sp);
    return true;
  }

  function mark(rootEl, def, onPick) {
    if (!hasDom() || !rootEl) return;
    var doc = rootEl.ownerDocument || (hasDom() ? document : null);
    if (!doc || typeof doc.createTreeWalker !== 'function'
      || typeof doc.createTextNode !== 'function'
      || typeof doc.createDocumentFragment !== 'function'
      || typeof doc.createElement !== 'function') return;
    if (typeof onPick === 'function') rootEl.__candPick = onPick;
    bind(rootEl);
    var dict = dictFor(def);
    var nodes = [];
    var walker = doc.createTreeWalker(rootEl, 4 /* SHOW_TEXT */, null, false);
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (var i = 0; i < nodes.length; i++) wrapNode(doc, nodes[i], dict);
  }

  function clear(rootEl) {
    if (!hasDom() || !rootEl || typeof rootEl.querySelectorAll !== 'function') return;
    var list = rootEl.querySelectorAll('.cand');
    for (var i = 0; i < list.length; i++) {
      var sp = list[i], p = sp.parentNode;
      if (!p) continue;
      while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
      p.removeChild(sp);
      if (typeof p.normalize === 'function') p.normalize();
    }
  }

  root.CANDIDATES = {
    mark: mark,
    clear: clear,
    scan: scan,
    dictFor: dictFor,
    CLASSES: CLASSES
  };
})(typeof window !== 'undefined' ? window : globalThis);
