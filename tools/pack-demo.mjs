/* Сборка демо-архива: статический пакет с одним входным файлом в корне
   (Lai_CO.html — продажа по охране труда, corp_game.html — тимбилдинг).
   Usage:
     node tools/pack-demo.mjs --cases case-21 [--out dist/demo.zip] [--note текст]
                             [--name index.html] [--public] [--readme]   <- флаги T8
   Внутри только то, что нужно игре: входной html (теги невыбранных дел вырезаны),
   js/, assets/, cases/case-NN/. Метод хранения — STORE (без сжатия): архив
   любой size открывает и Windows, и консоль Яндекс Игр.
   Флаги под заказ T8 (архив для Яндекс Игр, biz/briefs/T8-yandeks-arhiv.md):
     --name index.html  кладёт вход в архив под другим именем (пункт 1.22 — index.html в корне)
     --public           включает публичный режим внутри файла: window.SR_PUBLIC = true
                        перед подключением js/30-report.js (журнал не спросит ФИО и группу)
     --readme           служебная записка ложится как README.txt, а не NOTE.txt (пункт 3 T8)
   Проверка: node tools/pack-demo.mjs --cases case-21 && powershell -c "Expand-Archive dist/demo.zip d:\tmp\z" */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const cases = String(arg('cases', '')).split(',').map((s) => s.trim()).filter(Boolean);
if (!cases.length) {
  console.log('нужно указать --cases case-21[,case-07]');
  process.exit(1);
}
const out = arg('out', 'dist/demo.zip');
const note = arg('note', '');
const inName = arg('name', '');            // T8: имя входа в архиве (index.html для площадки)
const pub = argv.includes('--public');     // T8: публичный режим, включённый в файле
const readme = argv.includes('--readme');  // T8: служебная записка как README.txt

/* ---------- список файлов пакета ---------- */
const files = [];
function add(abs, inZip) {
  files.push({ abs, inZip: inZip.split('\\').join('/') });
}
/* DESIGN.md — внутренний документ с развязкой: в клиентский пакет не кладётся. */
const IGNORE = /(^|\/)DESIGN\.md$/;
function walk(dir, base) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(base, abs).split(sep).join('/');
    if (statSync(abs).isDirectory()) walk(abs, base);
    else if (!IGNORE.test(rel)) add(abs, rel);
  }
}
for (const d of ['js', 'assets']) walk(join(ROOT, d), ROOT);
for (const c of cases) {
  if (!existsSync(join(ROOT, 'cases', c))) {
    console.log('нет дела: cases/' + c);
    process.exit(1);
  }
  walk(join(ROOT, 'cases', c), ROOT);
}

/* Входной html контура: оставляем теги только выбранных дел
   (с 09.11.2026 слоёв два: corp_game.html — дела 1—20, Lai_CO.html — дело 21;
    архив собирается вокруг того файла, где лежит первое запрошенное дело) */
const wanted = new RegExp('src="cases/(' + cases.join('|') + ')/');
const skip = /<script src="cases\/case-\d+\//;
const PAGES = ['corp_game.html', 'Lai_CO.html'];
const probe = 'cases/' + cases[0] + '/';
const pageName = PAGES.find((p) => readFileSync(join(ROOT, p), 'utf8').includes(probe)) || 'Lai_CO.html';
const html0 = readFileSync(join(ROOT, pageName), 'utf8')
  .split('\n')
  .filter((line) => !(skip.test(line) && !wanted.test(line)))
  .join('\n');

/* T8, пункт 2: публичный режим включён внутри файла, а не через ?public=1.
   `window.SR_PUBLIC` читается один раз при загрузке js/30-report.js,
   поэтому вставка строго перед этим тегом. */
let html = html0;
if (pub) {
  const tag = '<script src="js/30-report.js"></script>';
  if (!html.includes(tag)) {
    console.log('в ' + pageName + ' нет тега ' + tag + ' — флаг --public применить некуда');
    process.exit(1);
  }
  if (!/window\.SR_PUBLIC/.test(html)) {
    html = html.replace(tag, '<script>window.SR_PUBLIC = true;</script>\n' + tag);
  }
}
const entryName = inName || pageName;
files.push({ text: html, inZip: entryName });

if (note) files.push({ text: note + '\n', inZip: readme ? 'README.txt' : 'NOTE.txt' });

/* T8, пункты 1 и 4: вход под нужным именем в корне, имена файлов — латиница без пробелов */
const badNames = files.filter((f) => !/^[\x20-\x7E]+$/.test(f.inZip)).map((f) => f.inZip);
if (badNames.length) {
  console.log('плохие имена в архиве: ' + badNames.join(', '));
  process.exit(1);
}
const rootIndex = files.some((f) => f.inZip === 'index.html');
const unpackedBytes = files.reduce(
  (n, f) => n + (f.text != null ? Buffer.byteLength(f.text, 'utf8') : statSync(f.abs).size), 0);

/* ---------- zip (STORE) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const now = new Date();
const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

const chunks = [];
const central = [];
let offset = 0;
for (const f of files) {
  const data = f.text != null ? Buffer.from(f.text, 'utf8') : readFileSync(f.abs);
  const name = Buffer.from(f.inZip, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 имён
  local.writeUInt16LE(0, 8); // STORE
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, name, data);

  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(20, 6);
  head.writeUInt16LE(0x0800, 8);
  head.writeUInt16LE(0, 10);
  head.writeUInt16LE(dosTime, 12);
  head.writeUInt16LE(dosDate, 14);
  head.writeUInt32LE(crc, 16);
  head.writeUInt32LE(data.length, 20);
  head.writeUInt32LE(data.length, 24);
  head.writeUInt16LE(name.length, 28);
  head.writeUInt32LE(0, 38); // ext attrs
  head.writeUInt32LE(offset, 42);
  central.push(head, name);
  offset += local.length + name.length + data.length;
}
const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...chunks, centralBuf, eocd]);
const outAbs = join(ROOT, out);
mkdirSync(dirname(outAbs), { recursive: true });
writeFileSync(outAbs, zip);
console.log('файлов: ' + files.length + ', размер: ' + (zip.length / 1048576).toFixed(2) + ' МБ');
console.log('вход: ' + entryName + ', index.html в корне: ' + rootIndex
  + ', публичный режим в файле: ' + pub + ', плохих имён: 0'
  + ', байт в разархивированном виде: ' + unpackedBytes);
console.log('архив: ' + out);
