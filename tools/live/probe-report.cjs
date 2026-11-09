/* probe-report.cjs — живой прогон журнала отчёта (заказ T2) через CDP, без сборки.
   Играет в case-21 реальными кликами: вход в дело → форма «кто работает» → материалы →
   подсказка → доска → уход/возврат со страницы → смена ответов в бланке → сдача.
   Доказательство: sr.journal.v1 пишется корректно (1 start, ре-визиты, дедуп, resume),
   метрики «дошёл до ядра / где встал / читал» сходятся, CSV 19 колонок с BOM и «;»,
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
  await step('метрики', 'var m=REPORT.runs(); var x=m[m.length-1]; return JSON.stringify({rows:m.length, reached:x.reached, coreMin:Math.round(x.coreMs/60000), submitted:x.submitted, win:x.win, read:x.read, total:x.total, hints:x.hints, hits:x.hits, near:x.near, fields:x.fields, stall:x.stall, clockMs:x.clockMs, name:x.name, group:x.group});');
  await step('CSV (реальный проход)', 'var t=REPORT.csv().replace(/^\\ufeff/,""); var p=t.split("\\r\\n"); var c=p[1].split(";"); return JSON.stringify({bom:REPORT.csv().charCodeAt(0)===65279, cols:p[0].split(";").length, nrows:p.length-1, sep:p[1].indexOf(";")>0, minutes:c[5], core:c[7], head:p[0].slice(0,120), row:p[1].slice(0,260)});');
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
    c.started = T0; c.clockMs = 340000; c.read = [a,b2]; c.hints = 1; c.found = []; c.hooks = []; c.calls = []; c.protocol = [];
    c.verdict = { win:true, hits:4, fields:5, score:71, answer:{culprit:'mochalov', place:'x', window:'y', weapon:'z', motive:'both'}, at:T0+340000 };
    put('sr.save.v1', s);
    return 'written';
  `);
  await step('метрики синтетики', 'var m=REPORT.runs(); var x=m[0]; return JSON.stringify({name:x.name, reached:x.reached, coreMs:x.coreMs, coreMin:Math.round(x.coreMs/60000), stallMs:x.stallMs, stallMin:Math.round(x.stallMs/60000), stall:x.stall, read:x.read, hints:x.hints, hits:x.hits, near:x.near, score:x.score, clockMin:Math.round(x.clockMs/60000)});');
  await step('хронология синтетики (карточка)', 'var h=REPORT.card(0); var b=document.createElement("div"); b.innerHTML=h; return JSON.stringify([].map.call(b.querySelectorAll(".rp-tl-x"),function(s){return s.textContent;}));');
  await step('CSV синтетики', 'var t=REPORT.csv().replace(/^\\ufeff/,"").split("\\r\\n"); return JSON.stringify({row:t[1] ? t[1].slice(0,220) : null});');

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
