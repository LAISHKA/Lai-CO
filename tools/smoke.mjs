/* Дым-тест: загружает все скрипты index.html в Node с заглушкой DOM.
   Ловит ошибки времени загрузки и сборки HTML (меню, рендереры документов).
   Запуск: node tools/smoke.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);

function el(tag = 'div') {
  const store = {
    tagName: String(tag).toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    value: '',
    textContent: '',
    innerHTML: '',
    checked: false,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    offsetTop: 0
  };
  const handlers = {};
  const cache = {};
  const api = {
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    appendChild(n) { store.children.push(n); return n; },
    removeChild(n) { return n; },
    remove() {},
    setAttribute(k, v) { store['@' + k] = String(v); },
    getAttribute(k) { return store['@' + k] !== undefined ? store['@' + k] : null; },
    hasAttribute(k) { return store['@' + k] !== undefined; },
    removeAttribute(k) { delete store['@' + k]; },
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    closest() { return null; },
    contains() { return false; },
    querySelector(sel) { return cache['q' + sel] || (cache['q' + sel] = make()); },
    querySelectorAll() { return []; },
    insertAdjacentHTML() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) { this._s.add(c); } else { this._s.delete(c); } },
      contains(c) { return this._s.has(c); }
    }
  };
  function make() { return el('div'); }
  return new Proxy(store, {
    get(t, p) {
      if (p in api) return api[p];
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return undefined;
    },
    set(t, p, v) { t[p] = v; return true; },
    has() { return true; }
  });
}

const doc = el('document');
doc.documentElement = el('html');
doc.body = el('body');
doc.head = el('head');
doc.activeElement = doc.body;
doc.createElement = (t) => el(t);
doc.getElementById = (id) => doc.querySelector('#' + id);

const mem = {};
const localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
  clear: () => { Object.keys(mem).forEach((k) => delete mem[k]); }
};

const win = {
  document: doc, localStorage,
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  scrollTo() {}, print() {}, navigator: { userAgent: 'node' },
  innerWidth: 1440, innerHeight: 900
};
globalThis.window = win;
globalThis.document = doc;
globalThis.localStorage = localStorage;

let failed = 0;
for (const s of srcs) {
  const src = readFileSync(join(root, s), 'utf8');
  try {
    new Function('window', 'document', 'localStorage', src)(win, doc, localStorage);
    console.log('  ok   ' + s);
  } catch (e) {
    failed = 1;
    console.log('  FAIL ' + s + ' — ' + e.message);
    console.log(String(e.stack).split('\n').slice(1, 4).join('\n'));
  }
}

/* дополнительно прогоняем рендер каждой улики и каждой связи через DOCS */
const CASES = win.CASES || [];
if (!CASES.length) {
  failed = 1;
  console.log('  FAIL DOCS.render — дел нет');
}
for (const c of CASES) {
  try {
    let n = 0;
    const kinds = {};
    c.evidence.forEach((ev) => {
      const out = win.DOCS.render(ev);
      if (!out || out.length < 40) throw new Error(ev.id + ': пустой HTML');
      if (/undefined|NaN|\[object Object\]/.test(out)) throw new Error(ev.id + ': в HTML попал ' + (out.match(/undefined|NaN|\[object Object\]/) || [])[0]);
      kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
      n++;
    });
    const list = Object.keys(kinds).sort().map((k) => k + ':' + kinds[k]).join(' ');
    console.log('  ok   DOCS.render ' + c.id + ' — ' + n + ' улик (' + list + ')');
  } catch (e) {
    failed = 1;
    console.log('  FAIL DOCS.render ' + c.id + ' — ' + e.message);
  }
}

console.log(failed ? '\nДЫМ-ТЕСТ НЕ ПРОЙДЕН' : '\nOK — загрузка и рендер без ошибок');
process.exit(failed);
