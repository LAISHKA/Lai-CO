/* ============================================================
   10-docs.js — превращение описания улики в HTML
   Никакого экранирования: в текстах дел намеренно стоят <b>, <i>, <u>.
   Каждый рендерер возвращает ОДИН корневой элемент.
   ============================================================ */
(function (root) {
  'use strict';

  function s(v) { return (v === null || v === undefined) ? '' : String(v); }
  function has(v) { return !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)); }

  /* ---------- общие куски ---------- */

  function kvGrid(pairs) {
    if (!has(pairs)) return '';
    var out = '<div class="doc-kv">';
    pairs.forEach(function (p) {
      if (!p || !p.length) return;
      out += '<div><b>' + s(p[0]) + ':</b> ' + s(p[1]) + '</div>';
    });
    return out + '</div>';
  }

  function metaDl(pairs) {
    if (!has(pairs)) return '';
    var out = '<dl class="doc-meta">';
    pairs.forEach(function (p) {
      if (!p || !p.length) return;
      out += '<dt>' + s(p[0]) + '</dt><dd>' + s(p[1]) + '</dd>';
    });
    return out + '</dl>';
  }

  function tableEl(t) {
    if (!t || typeof t !== 'object') return '';
    /* cols — канон; head — легаси-алиас (дело 09 писался по старой памятке) */
    var cols = t.cols || t.head;
    if (!has(cols)) return '';
    var out = '<table class="doc-table"><thead><tr>';
    cols.forEach(function (c) { out += '<th>' + s(c) + '</th>'; });
    out += '</tr></thead><tbody>';
    (t.rows || []).forEach(function (row) {
      var cells, cls = '';
      if (row && !Array.isArray(row)) { cells = row.c || row.cells || []; cls = row.cls || ''; }
      else { cells = row || []; }
      if (!cls && cells.some(function (c) { return s(c).indexOf('<b>') >= 0; })) cls = 'hi';
      out += '<tr' + (cls ? ' class="' + cls + '"' : '') + '>';
      cells.forEach(function (c) { out += '<td>' + s(c) + '</td>'; });
      out += '</tr>';
    });
    return out + '</tbody></table>';
  }

  function signEl(sign) {
    if (!sign || typeof sign !== 'object') return '';
    /* pos — канон; role — легаси-алиас */
    return '<div class="doc-sign"><span>Подлинник подписи</span><div class="sig"><div>'
      + s(sign.pos || sign.role) + '</div><div class="sig-name">' + s(sign.name) + '</div></div></div>';
  }

  function stampEl(stamp, inline) {
    if (!stamp) return '';
    if (typeof stamp === 'string') stamp = { text: stamp };
    if (!stamp.text) return '';
    /* tone — канон; kind — легаси-алиас */
    var tone = stamp.tone || stamp.kind || 'blue';
    return '<div class="stamp ' + (inline ? 'stamp-inline ' : '') + tone + '">' + s(stamp.text) + '</div>';
  }

  function listEl(items) {
    return '<ul>' + (items || []).map(function (li) { return '<li>' + s(li) + '</li>'; }).join('') + '</ul>';
  }

  /* Блок тела. Раньше был «или-или»: блок {h, p} терял абзац.
     Теперь рисуем все ключи, которые в блоке есть, в порядке чтения. */
  function blockEl(b) {
    if (!b) return '';
    if (typeof b === 'string' || typeof b === 'number') return '<p>' + s(b) + '</p>';
    var out = '';
    if (b.h) out += '<h4>' + s(b.h) + '</h4>';
    if (b.p) out += '<p>' + s(b.p) + '</p>';
    if (b.list) out += listEl(b.list);
    if (b.lines) out += listEl(b.lines);
    if (b.kv) out += kvGrid(b.kv);
    if (b.table) out += tableEl(b.table);
    if (b.quote) out += '<div class="doc-quote">' + s(b.quote) + '</div>';
    if (b.note) out += '<div class="doc-note">' + s(b.note) + '</div>';
    if (b.sign) out += signEl(b.sign);
    if (b.stamp) out += stampEl(b.stamp, true);
    if (b.html) out += b.html;
    /* отдельная рукописная вставка внутри печатного документа */
    return b.hand ? '<div class="hand">' + out + '</div>' : out;
  }

  function blocks(list) {
    if (!has(list)) return '';
    if (typeof list === 'string' || typeof list === 'number') return '<p>' + s(list) + '</p>';
    if (!Array.isArray(list)) return blockEl(list);
    return list.map(blockEl).join('');
  }

  /* ---------- бумага: акт, документ, протокол, записка, заявка ---------- */

  /* метка типа: читается с листа, без вывода в консоль */
  var KIND_LABEL = {
    photo: 'снимок', cctv: 'видео', act: 'акт', doc: 'документ', legal: 'правовой',
    ticket: 'заявка', note: 'записка', table: 'таблица', email: 'письмо',
    chat: 'переписка', talk: 'допрос', ledger: 'журнал', order: 'приказ', shot: 'экран'
  };

  /* значок типа в списке материалов: 14 разных, цвет — по семейству */
  var KIND_GLYPH = {
    photo: '📷', cctv: '🎥', shot: '🖥', act: '📋', doc: '📄', legal: '§',
    ticket: '🎫', note: '✎', table: '▦', ledger: '▤', order: '📜',
    talk: '❝', email: '✉', chat: '💬'
  };

  function paper(doc, opts) {
    opts = opts || {};
    var h = '<article class="doc' + (doc.hand ? ' hand' : '') + '"'
      + ' data-kind="' + s(opts.kind || 'doc') + '"'
      + ' data-kind-label="' + s(KIND_LABEL[opts.kind] || 'документ') + '"'
      + ' data-num="' + s(opts.num) + '"'
      + '>';
    h += stampEl(doc.stamp);
    if (doc.org || doc.title || doc.num || doc.date) {
      h += '<header class="doc-head">';
      if (doc.org) h += '<div class="doc-org">' + s(doc.org) + '</div>';
      if (doc.title) h += '<h3 class="doc-title">' + s(doc.title) + '</h3>';
      if (doc.num || doc.date) h += '<div class="doc-nums"><span>' + s(doc.num) + '</span><span>' + s(doc.date) + '</span></div>';
      h += '</header>';
    }
    h += metaDl(doc.meta);
    if (doc.source && !has(doc.meta)) h += metaDl([['Источник', doc.source]]);
    if (doc.note && !opts.noteLast) h += '<div class="doc-note">' + s(doc.note) + '</div>';
    if (has(doc.kv)) h += kvGrid(doc.kv);
    if (doc.table) h += tableEl(doc.table);
    h += '<div class="doc-body">' + blocks(doc.body) + (has(doc.lines) ? listEl(doc.lines) : '') + '</div>';

    /* допрос: qa был только у kind=talk, в делах 11 протоколы ушли в legal */
    if (has(doc.qa)) {
      h += '<div class="doc-body">';
      doc.qa.forEach(function (item) {
        h += '<div class="qa-item"><p class="qa-q">' + s(item.q) + '</p><p class="qa-a">' + s(item.a) + '</p></div>';
      });
      h += '</div>';
    }
    if (doc.note && opts.noteLast) h += '<div class="doc-note">' + s(doc.note) + '</div>';
    h += signEl(doc.sign);
    return h + '</article>';
  }

  /* ---------- съёмка: фото и камеры ---------- */

  function shot(doc, meta) {
    meta = meta || {};
    var cctv = !!doc.cctv || meta.kind === 'cctv';
    var h = '<figure class="shot" data-kind="' + s(meta.kind || (cctv ? 'cctv' : 'photo')) + '">';
    h += '<div class="shot-img' + (cctv ? ' cctv' : '') + '">';
    var phHtml = '<div class="shot-ph"><i>изображение не приобщено</i>' +
      s(doc.ph || 'Описание кадра — в примечании ниже.') + '</div>';
    if (doc.img) {
      /* картинка опциональна: если файла нет, остаётся текстовая заглушка с описанием */
      h += '<img src="' + s(doc.img) + '" alt="' + s(doc.alt || doc.cap || '') + '"' +
        ' onload="this.parentNode.classList.add(\'img-ok\')" onerror="this.remove()">' + phHtml;
    } else {
      h += phHtml;
    }
    /* описание кадра обязано читаться и когда снимок приобщён: без этого текста
       по фото нельзя построить зацепку (заглушка при картине скрыта) */
    var phSeen = doc.img && doc.ph ? '<div class="shot-desc">' + s(doc.ph) + '</div>' : '';
    if (cctv || doc.cam || has(doc.ts)) {
      var osd = '';
      if (doc.cam) osd += '<div>' + s(doc.cam) + '</div>';
      /* ts — строка либо пара [время, текст]: склеиваем читаемо */
      (doc.ts || []).forEach(function (t) {
        osd += '<div>' + (Array.isArray(t) ? t.map(s).join(' · ') : s(t)) + '</div>';
      });
      h += '<div class="osd">' + osd + '</div>';
      if (cctv) h += '<div class="osd tr"><span class="rec">● REC</span></div>';
    }
    h += '</div>';

    var cap = phSeen;
    if (doc.cap) cap += '<b>' + (cctv ? 'Что видно на записи' : 'Примечание к снимку') + '</b>' + s(doc.cap);
    if (has(doc.meta)) cap += kvGrid(doc.meta);
    if (cap) h += '<figcaption class="shot-cap">' + cap + '</figcaption>';
    return h + '</figure>';
  }

  /* ---------- экраны: почта и чат ---------- */

  function email(doc, kind) {
    var h = '<div class="screen" data-kind="' + s(kind || 'email') + '">';
    h += '<div class="screen-bar"><span class="dots"><i></i><i></i><i></i></span>' + s(doc.bar || 'Почтовый клиент') + '</div>';
    h += '<div class="screen-body">';
    var rows = [];
    if (doc.from) rows.push(['От', doc.from]);
    if (doc.to) rows.push(['Кому', Array.isArray(doc.to) ? doc.to.join(', ') : doc.to]);
    if (doc.cc) rows.push(['Копия', Array.isArray(doc.cc) ? doc.cc.join(', ') : doc.cc]);
    if (doc.date) rows.push(['Дата', doc.date]);
    h += metaGrid(rows);
    if (doc.subject || doc.title) h += '<h3 class="mail-subj">' + s(doc.subject || doc.title) + '</h3>';
    if (has(doc.meta)) h += metaDl(doc.meta);
    if (has(doc.kv)) h += kvGrid(doc.kv);
    if (has(doc.body)) h += '<div class="mail-body">' + blocks(doc.body) + '</div>';
    if (has(doc.note)) h += '<div class="doc-note">' + s(doc.note) + '</div>';
    if (has(doc.attach)) {
      h += '<div class="attach">' + doc.attach.map(function (a) {
        var name = Array.isArray(a) ? a[0] : (typeof a === 'string' || typeof a === 'number' ? a : ((a && (a.name || a.n)) || ''));
        var size = Array.isArray(a) ? a[1] : (a && a.size) || '';
        return '<span class="att">📎 ' + s(name) + (has(size) ? ' <i>' + s(size) + '</i>' : '') + '</span>';
      }).join('') + '</div>';
    }
    return h + '</div></div>';
  }

  function metaGrid(rows) {
    if (!has(rows)) return '';
    var out = '<dl class="mail-h">';
    rows.forEach(function (r) { out += '<dt>' + s(r[0]) + '</dt><dd>' + s(r[1]) + '</dd>'; });
    return out + '</dl>';
  }

  function chat(doc, kind) {
    var h = '<div class="screen" data-kind="' + s(kind || 'chat') + '">';
    h += '<div class="screen-bar"><span class="dots"><i></i><i></i><i></i></span>' + s(doc.bar || 'Мессенджер') + '</div>';
    h += '<div class="screen-body">';
    /* переписка в делах иногда оформлена как письмо: шапка, тема, приписка */
    var rows = [];
    if (doc.from) rows.push(['От', doc.from]);
    if (has(doc.to)) rows.push(['Кому', Array.isArray(doc.to) ? doc.to.join(', ') : doc.to]);
    if (doc.date) rows.push(['Дата', doc.date]);
    if (rows.length) h += metaGrid(rows);
    if (doc.subject) h += '<h3 class="mail-subj">' + s(doc.subject) + '</h3>';
    if (has(doc.meta)) h += metaDl(doc.meta);
    if (has(doc.kv)) h += kvGrid(doc.kv);
    (doc.msgs || []).forEach(function (m) {
      if (!m) return;
      if (m.day && !m.text) { h += '<div class="chat-day">' + s(m.day) + '</div>'; return; }
      if (m.day) h += '<div class="chat-day">' + s(m.day) + '</div>';
      var who = m.who || m.from;
      var time = m.time || m.at;
      h += '<div class="msg' + (m.me ? ' me' : '') + '"><div class="bub">';
      if (who && !m.me) h += '<div class="who">' + s(who) + '</div>';
      h += s(m.text);
      if (time) h += '<span class="mt">' + s(time) + '</span>';
      h += '</div></div>';
    });
    if (has(doc.body)) h += '<div class="mail-body">' + blocks(doc.body) + '</div>';
    if (has(doc.note)) h += '<div class="doc-note">' + s(doc.note) + '</div>';
    return h + '</div></div>';
  }

  /* ---------- реестр рендереров ---------- */

  var PAPER = { act: 1, doc: 1, legal: 1, ticket: 1, note: 1, table: 1, order: 1, ledger: 1 };

  root.DOCS = {
    render: function (ev) {
      var d = (ev && ev.doc) || {};
      var kind = (ev && ev.kind) || 'doc';
      var meta = { kind: kind, num: (ev && ev.id) || '' };
      switch (kind) {
        case 'photo':
        case 'cctv':
        case 'shot':
          return shot(d, meta);
        case 'email':
        case 'mail':
          return email(d, 'email');
        case 'chat':
          return chat(d, 'chat');
        case 'talk':
          return paper(d, { qa: true, noteLast: true, kind: 'talk', num: meta.num });
        default:
          return paper(d, meta);
      }
    },
    /* подпись под списком улик: чем является документ */
    kindLabel: function (kind) { return KIND_LABEL[kind] || 'документ'; },
    /* значок типа для списка материалов */
    kindGlyph: function (kind) { return KIND_GLYPH[kind] || '📄'; },
    isPaper: function (kind) { return !!PAPER[kind]; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
