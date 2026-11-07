/* ============================================================
   00-store.js — реестр дел и хранение прогресса
   Работает без сборки: вешается на window, файл открывается с диска.
   ============================================================ */
(function (root) {
  'use strict';

  /* ---- реестр дел (их наполняют файлы cases/*.js) ---- */
  const cases = [];
  root.registerCase = function (def) {
    if (!def || !def.id) throw new Error('registerCase: нет id');
    cases.push(def);
  };
  root.CASES = cases;

  /* ---- хранилище: один ключ на всю игру ---- */
  const KEY = 'sr.save.v1';
  const blank = () => ({ cases: {}, theme: 'dark' });

  function load() {
    try {
      const raw = root.localStorage.getItem(KEY);
      if (!raw) return blank();
      const parsed = JSON.parse(raw);
      return Object.assign(blank(), parsed);
    } catch (e) {
      console.warn('Сохранение повреждено, начинаем чисто', e);
      return blank();
    }
  }
  function save(state) {
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('Не удалось сохранить прогресс', e); }
  }
  function caseState(id) {
    const st = load();
    return st.cases[id] || {
      read: [],            // просмотренные улики
      found: [],           // найденные противоречия
      suspects: {},        // отметки на доске: { personId: 'watch'|'clear'|'accused' }
      notes: '',
      hints: 0,
      clockMs: 0,
      revealAll: false,    // выемка всех материалов сразу (анти-тупик)
      started: Date.now(),
      verdict: null,       // { ok, answer, at }
    };
  }
  function patchCase(id, patch) {
    const st = load();
    st.cases[id] = Object.assign(caseState(id), patch);
    save(st);
  }

  root.STORE = { load, save, caseState, patchCase, wipe: () => save(blank()) };
})(typeof window !== 'undefined' ? window : globalThis);
