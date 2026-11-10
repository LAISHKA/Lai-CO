/* probe-report.cjs — живой прогон журнала отчёта (заказ T2) через CDP, без сборки.
   Играет в case-21 реальными кликами: вход в дело → форма «кто работает» → материалы →
   подсказка → доска → уход/возврат со страницы → смена ответов в бланке → сдача.
   Доказательство: sr.journal.v1 пишется корректно (1 start, ре-визиты, дедуп, resume),
   метрики «дошёл до ядра / где встал / читал» сходятся, CSV в 21 колонку (19 прежних
   + «Первая зацепка, мин» + «Первая связь, мин») с BOM и «;», зацепка и связь
   добываются реальными кликами (ходатайство принято, противоречие найдено),
   карточка экранирована, экран отчёта и сбор ФИО выключены в публичной сборке (?public=1).
   Запуск: node tools/live/probe-report.cjs  →  читать tools/live/out/probe-report.txt
   Chrome НЕ убивается силовыми средствами (в отличие от play.cjs). */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const T = path.join(__dirname, 'out') + path.sep;
fs.mkdirSync(T, { recursive: true });
const ROOT = path.resolve(__dirname, '..', '..').replace(/\\+/g, '/');
const OUT = T + 'probe-report.txt';
/* Артефакт T8 проверяют так: SR_PAGE=file:///…/index.html node tools/live/probe-report.cjs
   Публичный режим включён в самом файле, поэтому форма «кто работает» не появится — это ожидаемо. */
const PAGE = process.env.SR_PAGE || ('file:///' + ROOT + '/Lai_CO.html');
const PORT = 9358;
const RUNDIR = path.join(os.tmpdir(), 'chrome-probe-' + Date.now());
const CHROME = [process.env.CHROME, 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('chrome not found');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = [];
const say = (s) => { L.push(s); };

const HELP = `
function $i(id){ return document.getElementById(id); }
function click(sel){ var e=document.querySelector(sel); if(!e) return 0; e.click(); return 1; }
function clickIn(root2,sel){ var e=(root2||document).querySelector(sel); if(!e) return 0; e.click(); return 1; }
function jb(){ try { return JSON.parse(localStorage.getItem('sr.journal.v1')||'{}'); } catch(e){ return {err:''+e}; } }
function sv(){ try { return JSON.parse(localStorage.getItem('sr.save.v1')||'{}'); } catch(e){ return {err:''+e}; } }
function cs21(){ return (window.CASES||[]).find(function(c){ return c.id==='case-21'; }); }
function est(){ var s=sv().cases||{}; return s['case-21']||{}; }
function run(){ var r=jb().runs||[]; return r[r.length-1]||{events:[]}; }
function evs(){ return run().events||[]; }
function etypes(){ return evs().map(function(e){ return e.t; }); }
function setSel(id,val){ var e=$i(id); if(!e) return 0; e.value=val; e.dispatchEvent(new Event('change',{bubbles:true})); return 1; }
function put(k,v){ localStorage.setItem(k, JSON.stringify(v)); return 1; }
/* разбор строки CSV с учётом кавычек: в «Где встал» бывают ; внутри кавычек */
function splitCsv(line){ var out=[],cur='',q=false; for(var i=0;i<line.length;i++){ var ch=line.charAt(i);
  if(q){ if(ch==='"'){ if(line.charAt(i+1)==='"'){cur+='"';i++;} else q=false; } else cur+=ch; }
  else if(ch==='"') q=true; else if(ch===';'){ out.push(cur); cur=''; } else cur+=ch; }
  out.push(cur); return out; }
function ovTitle(){ var h=document.querySelector('#overlay-body .ov-title'); return h?h.textContent:''; }
function clickDir(cat){ return click('.hook-dirs .hook-dir[data-dir="' + cat.replace(/"/g,'') + '"]'); }
/* выделение по offset'ам textContent читалки (тот же приём, что в play.cjs) */
function selR(el,s,e){ var w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null),n,pos=0,a=null,b=null,r=document.createRange();
  while((n=w.nextNode())){ var len=n.textContent.length; if(!a&&s<=pos+len)a={n:n,o:s-pos}; if(!b&&e<=pos+len){b={n:n,o:e-pos};break;} pos+=len; }
  if(!a||!b) return false; r.setStart(a.n,a.o); r.setEnd(b.n,b.o);
  var sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; }
/* первое предложение прочитанного документа со словом направления -> выделить -> mouseup -> панель зацепки */
function mkQuote(cat){ var d=cs21(); var on=document.querySelector('.ev-item.on'); var cur=on?on.getAttribute('data-ev'):'';
  if(!cur) return {ok:0,why:'нет открытого материала'};
  var dir=HOOKS.directions(d,cur).filter(function(x){return x.cat===cat;})[0];
  if(!dir) return {ok:0,why:'нет направления «'+cat+'» в '+cur};
  var words=HOOKS.words(cat+' '+Object.keys(dir.words).join(' '));
  var el=document.getElementById('reader'); var raw=el.textContent||'',norm='',map=[],i;
  for(i=0;i<raw.length;i++){ var ch=raw.charAt(i);
    if(/\\s/.test(ch)){ if(norm.charAt(norm.length-1)!==' '){ norm+=' '; map.push(i); } continue; }
    norm+=ch; map.push(i); }
  var ss=norm.match(/[^.!?;]+[.!?;]+[^.!?;\\"]*/g)||[];
  for(var k=0;k<ss.length;k++){ var sent=ss[k].trim(); if(sent.length<14) continue;
    var sw=HOOKS.words(sent),hit=false; for(var w in sw) if(words[w]){ hit=true; break; }
    if(!hit) continue;
    var p=norm.indexOf(sent); if(p<0) continue;
    if(!selR(el,map[p],map[Math.min(p+sent.length-1,map.length-1)]+1)) continue;
    var got=String(getSelection().toString()||'').replace(/\\s+/g,' ').trim();
    if(got.length<12){ getSelection().removeAllRanges(); continue; }
    el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    return {ok:1,quote:got.slice(0,120)}; }
  return {ok:0,why:'нет предложения со словом направления «'+cat+'»'}; }
`;

async function main() {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + RUNDIR,
    '--window-size=1680x1000', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', detached: true });

  let ws, id = 0, pending = {};
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const mid = ++id; pending[mid] = { res, rej };
    ws.send(JSON.stringify({ id: mid, method, params, sessionId: sid }));
    setTimeout(() => { if (pending[mid]) { delete pending[mid]; rej(new Error(method + ' timeout')); } }, 30000);
  });
  const errs = [];
  const evl = async (code) => {
    const r = await send('Runtime.evaluate', { expression: '(async()=>{\n' + HELP + '\n' + code + '\n})()', awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { err: ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || '').slice(0, 400) };
    return { v: r.result.value };
  };
  const step = async (name, code) => {
    const r = await evl(code);
    if (r.err) say('FAIL ' + name + ' :: ' + r.err);
    else say('ok   ' + name + ' :: ' + (typeof r.v === 'string' ? r.v : JSON.stringify(r.v)));
  };

  await sleep(2600);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => { ws.onopen = res; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id].res(m.result || m); delete pending[m.id]; }
    else if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text) || '').slice(0, 240));
    else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errs.push('CONSOLE ' + m.params.type + ' ' + m.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: PAGE });
  await sleep(2000);
  await step('чистый старт', 'localStorage.clear(); return "cleared";');
  await send('Page.navigate', { url: PAGE });
  await sleep(2200);

  say('--- 1. загрузка ---');
  await step('REPORT есть', 'return JSON.stringify({api:!!window.REPORT, pub:window.REPORT&&REPORT.isPublic, ver:window.REPORT&&REPORT.version});');
  await step('кнопки и тег', 'return JSON.stringify({bar:!!$i("btn-report"), menu:!!$i("btn-report-menu"), tag:!!document.querySelector("script[src=\\"js/30-report.js\\"]")});');
  await step('дел в меню', 'return String(document.querySelectorAll("#case-list .case-card").length);');

  say('--- 2. вход в дело (ровно один start) ---');
  await step('клик карточки 21', 'return String(click("#case-list .case-card[data-id=\\"case-21\\"]"));');
  await sleep(500);
  await step('start ровно 1', 'return JSON.stringify({runs:(jb().runs||[]).length, types:etypes(), finish:run().finish, start:run().start});');
  await step('закрыть брифинг', 'return String(clickIn($i("overlay-body"),"[data-act=\\"close-overlay\\"]"));');
  await sleep(1500);
  await step('форма «кто работает»', 'return JSON.stringify({who:!!document.querySelector("[data-ract=\\"who-save\\"]"), name:!!$i("rp-name"), group:!!$i("rp-group")});');
  await step('вписать ФИО/группу', 'var a=$i("rp-name"),b=$i("rp-group"); if(!a) return "нет формы"; a.value="Летестов Т. П."; b.value="Отдел охраны труда"; a.dispatchEvent(new Event("input",{bubbles:true})); b.dispatchEvent(new Event("input",{bubbles:true})); return "typed";');
  await sleep(500);
  await step('сохранить who-save', 'return String(click("[data-ract=\\"who-save\\"]"));');
  await sleep(400);
  await step('кто в журнале', 'return JSON.stringify({who:jb().who, runWho:run().who, types:etypes()});');

  say('--- 3. материалы ---');
  await step('открыть 4 разных', 'var ids=[]; var it=document.querySelectorAll("#ev-list [data-ev]"); for(var i=0;i<it.length&&ids.length<4;i++) ids.push(it[i].getAttribute("data-ev")); var n=0; for(var k=0;k<ids.length;k++){ var el=document.querySelector("#ev-list [data-ev=\\""+ids[k]+"\\"]"); if(el){ el.click(); n++; } } return JSON.stringify({clicked:n, read:(est().read||[]).length, docs:etypes().filter(function(t){return t==="doc";}).length});');
  await sleep(500);
  await step('повторно открыть прочитанный', 'var r=(est().read||[])[0]; var el=document.querySelector("#ev-list [data-ev=\\""+r+"\\"]"); if(!el) return "не найден"; el.click(); return "clicked "+r;');
  await sleep(400);
  await step('ре-визит прочитанного (не дублирует read)', 'return JSON.stringify({docs:etypes().filter(function(t){return t==="doc";}).length, read:(est().read||[]).length});');
  await sleep(1600);
  await step('тот же материал после 1.6 с → новое doc', 'var r=(est().read||[])[0]; var el=document.querySelector("#ev-list [data-ev=\\""+r+"\\"]"); if(el) el.click(); return JSON.stringify({docs:etypes().filter(function(t){return t==="doc";}).length, read:(est().read||[]).length});');
  await step('тот же материал СРАЗУ → дедуп (docs не растёт)', 'var r=(est().read||[])[0]; var el=document.querySelector("#ev-list [data-ev=\\""+r+"\\"]"); if(el) el.click(); if(el) el.click(); return JSON.stringify({docs:etypes().filter(function(t){return t==="doc";}).length, read:(est().read||[]).length});');

  say('--- 3б. первая зацепка и первая связь через интерфейс (нужны для firstHookMs/firstLinkMs) ---');
  await step('зацепка: найти материал с направлением', `
    var ids = [], it = document.querySelectorAll('#ev-list [data-ev]');
    for (var i = 0; i < it.length; i++) ids.push(it[i].getAttribute('data-ev'));
    var out = null, d = cs21();
    for (var k = 0; k < ids.length && !out; k++) {
      var el = document.querySelector('#ev-list [data-ev="' + ids[k] + '"]');
      if (!el) continue;
      el.click();
      var ds = HOOKS.pendingDirections(d, est(), ids[k]).filter(function (x) { return HOOKS.checkable(d, ids[k], x.cat); });
      if (ds.length) out = { id: ids[k], cat: ds[0].cat };
    }
    if (!out) throw new Error('нет доступного материала с направлениями проверки');
    window.__pk = out;
    return JSON.stringify(out);
  `);
  await sleep(400);
  await step('зацепка: выделение цитаты', 'var m = mkQuote(window.__pk.cat); if (!m.ok) throw new Error("зацепка: " + m.why); return JSON.stringify(m);');
  await sleep(300);
  await step('зацепка: форма ходатайства', 'var n = click("#btn-hook"); if (!n) throw new Error("кнопка ходатайства не найдена"); return "opened";');
  await sleep(500);
  await step('зацепка: форма открыта', 'var t = ovTitle(); if (!/ходатайство/i.test(t)) throw new Error("форма не открылась: " + t); return t;');
  await step('зацепка: подать направление', 'var n = clickDir(window.__pk.cat); if (!n) throw new Error("кнопка направления «" + window.__pk.cat + "» не найдена"); return "dir clicked";');
  await sleep(500);
  await step('зацепка: лицо (если спросят)', 'if (ovTitle().indexOf("Направление:") === 0) { var n = click(".hook-dirs .hook-dir[data-who]"); if (!n) throw new Error("спросили лицо, но кнопки нет"); return "who clicked"; } return "не спрашивали";');
  await sleep(500);
  await step('зацепка: принята + событие hook в протоколе', `
    var t = ovTitle();
    if (t !== 'Ходатайство принято') throw new Error('зацепка не принята: ' + t);
    var hk = (est().protocol || []).filter(function (e) { return e.t === 'hook'; });
    if (!hk.length) throw new Error('в st.protocol нет события hook');
    return JSON.stringify({ title: t, hookEvents: hk.length, firstHookTs: hk[0].ts });
  `);
  await step('закрыть окно зацепки', 'return String(clickIn($i("overlay-body"), "[data-act=\\"close-overlay\\"]"));');
  await sleep(300);
  await step('связь: положить доступную пару в лоток', `
    var d = cs21();
    var shown = {};
    [].forEach.call(document.querySelectorAll('#ev-list [data-link]'), function (b) { shown[b.getAttribute('data-link')] = 1; });
    var pair = null, list = d.contradictions || [];
    for (var i = 0; i < list.length && !pair; i++) {
      var c = list[i];
      if (shown[c.a] && shown[c.b] && (est().found || []).indexOf(c.id) < 0) pair = c;
    }
    if (!pair) throw new Error('нет доступной пары материалов для сличения');
    window.__pl = pair.id;
    var ba = document.querySelector('#ev-list [data-link="' + pair.a + '"]');
    if (!ba) throw new Error('кнопки лотка нет в списке: ' + pair.a);
    ba.click();
    /* первый клик перерисовывает список: вторую кнопку берём ЗАНОВО, клик по
       отсоединённому узлу ничего бы не добавил в лоток */
    var bb = document.querySelector('#ev-list [data-link="' + pair.b + '"]');
    if (!bb) throw new Error('кнопки лотка нет в списке после перерисовки: ' + pair.b);
    bb.click();
    if ($i('btn-compare').disabled) throw new Error('лоток не принял пару');
    return JSON.stringify({ id: pair.id, a: pair.a, b: pair.b });
  `);
  await step('связь: сравнить', '$i("btn-compare").click(); return ovTitle();');
  await sleep(400);
  await step('связь: найдена + событие link в протоколе', `
    var t = ovTitle();
    if (t !== 'Противоречие найдено') throw new Error('связь не найдена: ' + t);
    var lk = (est().protocol || []).filter(function (e) { return e.t === 'link'; });
    if (!lk.length) throw new Error('в st.protocol нет события link');
    return JSON.stringify({ title: t, linkEvents: lk.length, firstLinkTs: lk[0].ts, found: (est().found || []).length });
  `);
  await step('закрыть окно связи', 'return String(clickIn($i("overlay-body"), "[data-act=\\"close-overlay\\"]"));');
  await sleep(300);

  say('--- 4. подсказка, доска, уход со страницы ---');
  await step('подсказка (шлюз+да)', 'click("#btn-hint"); return "ok";');
  await sleep(400);
  await step('hint в журнале', 'return String(click("[data-act=\\"hint-real\\"]"));');
  await sleep(400);
  await step('hint записан', 'return JSON.stringify({hints:est().hints, n:(evs().filter(function(e){return e.t==="hint";})[0]||{}).n});');
  await step('доска → лицо → watch', 'click("#btn-board"); return "ok";');
  await sleep(300);
  await step('клик по лицу', 'return String(click("#panel-persons .person"));');
  await sleep(400);
  await step('flag в журнале', 'return String(click("[data-act=\\"flag-person\\"]"));');
  await sleep(400);
  await step('flag записан', 'return JSON.stringify(evs().filter(function(e){return e.t==="flag";}).map(function(e){return {pid:e.pid,v:e.v};}).concat([{suspects:est().suspects}]));');
  await step('снять отметку', 'return String(click("[data-act=\\"flag-person\\"]"));');
  await sleep(400);
  await step('flag со снятием записан', 'return JSON.stringify(evs().filter(function(e){return e.t==="flag";}).map(function(e){return e.v;}));');
  await step('закрыть карточку лица', 'return String(clickIn($i("overlay-body"),"[data-act=\\"close-overlay\\"]"));');
  await sleep(300);
  await step('имитация ухода со страницы', 'Object.defineProperty(document,"hidden",{get:function(){return true;},configurable:true}); document.dispatchEvent(new Event("visibilitychange")); return "hidden=true";');
  await sleep(300);
  await step('имитация возврата', 'Object.defineProperty(document,"hidden",{get:function(){return false;},configurable:true}); document.dispatchEvent(new Event("visibilitychange")); return "hidden=false";');
  await sleep(300);
  await step('away/back в журнале', 'return JSON.stringify({away:etypes().indexOf("away")>=0, back:etypes().indexOf("back")>=0});');

  say('--- 5. бланк: смена ответов и сдача ---');
  await step('открыть бланк (шлюз)', 'click("#btn-accuse"); return "ok";');
  await sleep(400);
  await step('«Сдаю» → форма', 'return String(click("[data-act=\\"accuse-open\\"]"));');
  await sleep(500);
  await step('селекты есть', 'return JSON.stringify({n:document.querySelectorAll("#verdict-body select").length, ids:[].map.call(document.querySelectorAll("#verdict-body select"),function(s){return s.id;}).join(",")});');
  await step('culprit=mochalov', 'return String(setSel("fld-culprit","mochalov"));');
  await sleep(250);
  await step('culprit=vetrova (смена)', 'return String(setSel("fld-culprit","vetrova"));');
  await sleep(250);
  await step('culprit=mochalov (возврат)', 'return String(setSel("fld-culprit","mochalov"));');
  await sleep(250);
  await step('заполнить остальные поля', 'var f=cs21().objective.fields, out=[]; for(var i=0;i<f.length;i++){ if(f[i].id==="culprit") continue; var el=$i("fld-"+f[i].id); if(!el){ out.push(f[i].id+":NOSEL"); continue; } var val=""; for(var k=0;k<el.options.length;k++){ if(el.options[k].value){ val=el.options[k].value; break; } } out.push(f[i].id+":"+setSel("fld-"+f[i].id,val)); } return out.join(" ");');
  await sleep(400);
  await step('answer-события', 'return JSON.stringify((function(){var e=evs().filter(function(x){return x.t==="answer";}); var c=e.filter(function(x){return x.field==="culprit";}); return {n:e.length, culprit:c.map(function(x){return x.value;}), sample:e[0]?{f:e[0].field,v:e[0].value}:null};})());');
  await step('сдать (data-vact=send)', 'return String(click("[data-vact=\\"send\\"]"));');
  await sleep(700);
  await step('submit + вердикт', 'return JSON.stringify({hasSubmit:etypes().indexOf("submit")>=0, finish:!!run().finish, verdict:(function(){var v=est().verdict||{}; return {win:v.win,hits:v.hits,score:v.score,culprit:v.answer&&v.answer.culprit};})(), screen:!$i("view-verdict").classList.contains("hidden")});');

  say('--- 6. метрики реального прохода ---');
  await step('метрики', `
    var m = REPORT.runs(); var x = m[m.length - 1];
    if (!(x.firstHookMs > 0)) throw new Error('firstHookMs не посчитан: ' + x.firstHookMs);
    if (!(x.firstLinkMs > 0)) throw new Error('firstLinkMs не посчитан: ' + x.firstLinkMs);
    return JSON.stringify({ rows: m.length, reached: x.reached, coreMin: Math.round(x.coreMs / 60000),
      firstHookSec: Math.round(x.firstHookMs / 1000), firstLinkSec: Math.round(x.firstLinkMs / 1000),
      firstHookMs: x.firstHookMs, firstLinkMs: x.firstLinkMs,
      submitted: x.submitted, win: x.win, read: x.read, total: x.total, hints: x.hints,
      hits: x.hits, near: x.near, fields: x.fields, stall: x.stall, clockMs: x.clockMs, name: x.name, group: x.group });
  `);
  await step('CSV (реальный проход)', `
    var t = REPORT.csv().replace(/^\\ufeff/, ""); var p = t.split("\\r\\n");
    var h = p[0].split(";"); var c = splitCsv(p[1]);
    if (h.length !== 21) throw new Error("CSV колонок " + h.length + ", ожидалось 21");
    if (h[19] !== "Первая зацепка, мин" || h[20] !== "Первая связь, мин") throw new Error("заголовки 20-21 не те: " + h[19] + " | " + h[20]);
    if (!/^\\d+(,\\d)?$/.test(c[19]) || !c[19]) throw new Error("«Первая зацепка, мин» пуста или не в формате 0,6: [" + c[19] + "]");
    if (!/^\\d+(,\\d)?$/.test(c[20]) || !c[20]) throw new Error("«Первая связь, мин» пуста или не в формате 0,6: [" + c[20] + "]");
    return JSON.stringify({ bom: REPORT.csv().charCodeAt(0) === 65279, cols: h.length, nrows: p.length - 1,
      sep: p[1].indexOf(";") > 0, minutes: c[5], core: c[7], hook: c[19], link: c[20],
      head: p[0].slice(0, 120), row: p[1].slice(0, 260) });
  `);
  await step('карточка (HTML)', 'var h=REPORT.card(REPORT.runs().length-1); return JSON.stringify({len:h.length, who:h.indexOf("Летестов")>=0, chrono:h.indexOf("rp-tl-i")>=0, kpi:h.indexOf("rp-kpi-i")>=0, facts:h.indexOf("rp-facts")>=0, sign:h.indexOf("rp-sign")>=0, noscript:h.indexOf("<script")===-1});');

  say('--- 7. экран отчёта ---');
  await step('открыть отчёт', 'return String(click("#btn-report"));');
  await sleep(400);
  await step('сводка/таблица/CSV', 'var b=$i("overlay-body"); return JSON.stringify({sum:(b.querySelector(".rp-sum")||{textContent:""}).textContent.replace(/\\s+/g," ").trim(), rows:b.querySelectorAll(".rp-table tr").length, csvBtn:!!b.querySelector("[data-ract=\\"csv\\"], rp-csv")||!!b.querySelector("[data-ract=\\"csv\\"]"), stall:(b.querySelector(".rp-stall-c")||{textContent:""}).textContent.trim().slice(0,80)});');
  await step('имена в таблице', 'var b=$i("overlay-body"); return JSON.stringify([].map.call(b.querySelectorAll(".rp-table tr"),function(tr){return [].map.call(tr.children,function(td){return (td.textContent||"").replace(/\\s+/g," ").trim().slice(0,26);});}));');
  await step('карточка из таблицы', 'return String(click(".rp-table [data-ract=\\"card\\"]"));');
  await sleep(400);
  await step('карточка на экране', 'var b=$i("overlay-body"); return JSON.stringify({card:!!b.querySelector(".rp-card"), print:!!b.querySelector("[data-ract=\\"print\\"]"), back:!!b.querySelector("[data-ract=\\"back-list\\"]"), items:b.querySelectorAll(".rp-tl-i").length, h:(b.querySelector(".rp-h")||{textContent:""}).textContent});');
  await step('назад к списку', 'return String(click("[data-ract=\\"back-list\\"]"));');
  await sleep(300);
  await step('закрыть экран', 'return String(click("[data-ract=\\"close\\"]"));');
  await sleep(300);
  await step('оверлей закрыт', 'return String($i("overlay").classList.contains("hidden"));');

  say('--- 8. экранирование CSV (точка с запятой и кавычки в ФИО) ---');
  await step('setWho с ; и "', 'REPORT.setWho(\'Тест; "Кавычки"\', "Гр;уппа"); var t=REPORT.csv().replace(/^\\ufeff/,"").split("\\r\\n")[1]; return JSON.stringify({who:jb().who, row:t.slice(0,60)});');
  await step('вернуть нормальное имя', 'REPORT.setWho("Летестов Т. П.", "Отдел охраны труда"); return JSON.stringify(jb().who);');

  say('--- 9. синтетический проход: «где встал» и ядро по сдаче ---');
  await step('построить синтетический журнал', `
    var T0 = Date.now() - 40*60000;
    var d = cs21(); var a = d.evidence[0].id, b2 = d.evidence[1].id;
    var events = [
      {t:'start', ts:T0},
      {t:'doc', ts:T0+5000, v:a},
      {t:'doc', ts:T0+20000, v:b2},
      {t:'hint', ts:T0+320000, n:1},
      {t:'flag', ts:T0+330000, pid:'mochalov', v:'accused'},
      {t:'submit', ts:T0+340000, score:71, win:true}
    ];
    var j = { who:{name:'Синтетиков А. В.', group:'Цех N'}, runs:[{caseId:'case-21', start:T0, finish:T0+340000, left:0, who:{name:'Синтетиков А. В.', group:'Цех N'}, events:events}] };
    put('sr.journal.v1', j);
    var s = sv(); var c = s.cases['case-21'];
    c.started = T0; c.clockMs = 340000; c.read = [a,b2]; c.hints = 1; c.found = []; c.hooks = []; c.calls = [];
    /* зацепка и связь живут только в протоколе сейва (submitHook/compare пишут их лишь при успехе) —
       так проверка firstHookMs/firstLinkMs не зависит от кликов */
    c.protocol = [{ t:'hook', ts:T0+60000, ev:a, dir:'Место', quote:'в 20:52', who:'' },
                  { t:'link', ts:T0+120000, id:((d.contradictions||[])[0]||{}).id }];
    c.verdict = { win:true, hits:4, fields:5, score:71, answer:{culprit:'mochalov', place:'x', window:'y', weapon:'z', motive:'both'}, at:T0+340000 };
    put('sr.save.v1', s);
    return 'written';
  `);
  await step('метрики синтетики', 'var m=REPORT.runs(); var x=m[0]; if(x.firstHookMs!==60000||x.firstLinkMs!==120000) throw new Error("синтетика: ждём firstHookMs=60000 firstLinkMs=120000, получили " + x.firstHookMs + "/" + x.firstLinkMs); return JSON.stringify({name:x.name, reached:x.reached, coreMs:x.coreMs, coreMin:Math.round(x.coreMs/60000), firstHookMs:x.firstHookMs, firstLinkMs:x.firstLinkMs, stallMs:x.stallMs, stallMin:Math.round(x.stallMs/60000), stall:x.stall, read:x.read, hints:x.hints, hits:x.hits, near:x.near, score:x.score, clockMin:Math.round(x.clockMs/60000)});');
  await step('хронология синтетики (карточка)', 'var h=REPORT.card(0); var b=document.createElement("div"); b.innerHTML=h; return JSON.stringify([].map.call(b.querySelectorAll(".rp-tl-x"),function(s){return s.textContent;}));');
  await step('CSV синтетики', `
    var t = REPORT.csv().replace(/^\\ufeff/, "").split("\\r\\n");
    if (!t[1]) throw new Error("нет строки синтетики");
    var c = splitCsv(t[1]);
    if (c.length !== 21) throw new Error("колонок " + c.length + ", ожидалось 21");
    if (c[19] !== "1" || c[20] !== "2") throw new Error("синтетика: ждём «1;2» на 20-21, получили [" + c[19] + "][" + c[20] + "]");
    return JSON.stringify({ cols: c.length, hook: c[19], link: c[20], row: t[1].slice(0, 220) });
  `);

  say('--- 9б. resume: повторный вход в незавершённый проход ---');
  await step('resume: 1 start и событие resume', `
    var T0 = Date.now() - 20*60000;
    var j = { who:{name:'Паузов И. И.', group:'Цех N'}, runs:[{caseId:'case-21', start:T0, finish:0, left:T0+360000, who:{name:'Паузов И. И.', group:'Цех N'},
      events:[{t:'start',ts:T0},{t:'doc',ts:T0+5000,v:cs21().evidence[0].id}]}] };
    put('sr.journal.v1', j);
    REPORT.act('case-21','start');
    var rs = evs().filter(function(e){return e.t==='resume';});
    return JSON.stringify({runs:(jb().runs||[]).length, starts:etypes().filter(function(t){return t==='start';}).length, types:etypes(), gap:(rs[0]||{}).gap||0, left:run().left});
  `);
  await step('после завершённого прохода старт даёт новый run', `
    var j = jb(); var rr = j.runs || []; rr[rr.length-1].finish = Date.now(); put('sr.journal.v1', j);
    REPORT.act('case-21','start');
    var nq = (jb().runs||[]);
    return JSON.stringify({runs:nq.length, lastTypes:(nq[nq.length-1].events||[]).map(function(e){return e.t;}), prevTypes:(nq[0].events||[]).map(function(e){return e.t;})});
  `);
  await step('away/pause не дают «где встал»', `
    localStorage.clear();
    var T0 = Date.now() - 20*60000;
    var ev = [{t:'start',ts:T0},{t:'doc',ts:T0+5000,v:cs21().evidence[0].id},{t:'away',ts:T0+10000},{t:'back',ts:T0+700000},{t:'pause',ts:T0+705000}];
    var m = REPORT.metrics({caseId:'case-21', start:T0, finish:0, left:T0+705000, who:{name:'X',group:'Y'}, events:ev});
    return JSON.stringify({stall:m.stall, stallMs:m.stallMs, endUsed:m.finish});
  `);
  await step('залипание на материале ловится (тот же прогон, без away)', `
    var T0 = Date.now() - 20*60000;
    var ev = [{t:'start',ts:T0},{t:'doc',ts:T0+5000,v:cs21().evidence[0].id},{t:'doc',ts:T0+400000,v:cs21().evidence[1].id}];
    var m = REPORT.metrics({caseId:'case-21', start:T0, finish:T0+400000, left:0, who:{name:'X',group:'Y'}, events:ev});
    return JSON.stringify({stall:m.stall.slice(0,120), stallMs:m.stallMs});
  `);

  say('--- 10. forget и публичная сборка ---');
  await step('forget', 'REPORT.forget("case-21"); return String((jb().runs||[]).length);');
  await step('localStorage чист', 'localStorage.clear(); return "ok";');
  await send('Page.navigate', { url: PAGE + '?public=1' });
  await sleep(2000);
  await step('public: флаги', 'return JSON.stringify({pub:REPORT.isPublic, btnHidden:$i("btn-report").style.display==="none", menuHidden:$i("btn-report-menu").style.display==="none"});');
  await step('public: вход в дело', 'return String(click("#case-list .case-card[data-id=\\"case-21\\"]"));');
  await sleep(600);
  await step('public: закрытие брифинга', 'return String(clickIn($i("overlay-body"),"[data-act=\\"close-overlay\\"]"));');
  await sleep(1600);
  await step('public: нет формы ФИО, журнал пишется', 'return JSON.stringify({whoForm:!!document.querySelector("[data-ract=\\"who-save\\"]"), runs:(jb().runs||[]).length, types:etypes(), who:jb().who});');
  await step('public: CSV без имён', 'var t=REPORT.csv().replace(/^\\ufeff/,"").split("\\r\\n"); return JSON.stringify({row:t[1]?t[1].slice(0,40):null});');
  await step('public: REPORT.open() НЕ открывает экран (ожидаем after:false)', 'var before=!$i("overlay").classList.contains("hidden"); REPORT.open(); var after=!$i("overlay").classList.contains("hidden"); return JSON.stringify({before:before, after:after, mine:!!document.querySelector("[data-ract]")});');

  say('--- ошибки страницы ---');
  say(errs.length ? errs.slice(0, 30).join('\n') : 'нет');

  fs.writeFileSync(OUT, L.join('\n'), 'utf8');
  try { ws.close(); } catch (e) { }
  try { process.kill(-chrome.pid); } catch (e) { try { chrome.kill(); } catch (e2) { } }
  const bad = L.filter((x) => x.startsWith('FAIL')).length + errs.length;
  say('ИТОГ: падений шага ' + L.filter((x) => x.startsWith('FAIL')).length + ', ошибок страницы ' + errs.length);
  fs.writeFileSync(OUT, L.join('\n'), 'utf8');
  console.log(bad ? 'Падений: ' + bad : 'DONE ' + L.length + ' lines');
  if (bad) process.exit(1);
}

main().catch((e) => {
  L.push('FATAL ' + ((e && e.stack) || e));
  fs.writeFileSync(OUT, L.join('\n'), 'utf8');
  console.log('FATAL ' + ((e && e.message) || e));
  process.exit(1);
});
