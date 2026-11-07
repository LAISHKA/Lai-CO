const __p = require('path');
const T = __p.join(__dirname, 'out') + __p.sep;
const ROOTDIR = __p.resolve(__dirname, '..', '..');
require('fs').mkdirSync(T, { recursive: true });
/* срез живого прогона: фазы + ключевые строки каркаса */
const fs = require('fs');
const L = fs.readFileSync(T + 'play.txt', 'utf8').split(/\r?\n/);
const keep = L.filter((l) => /FASE|ОШИБКИ|перепол|итог:|каркас:|бланк:|выход из|строк протокола|прочитано|не поступило|НЕ ПОСТУПИЛО/.test(l));
fs.writeFileSync(T + 'p2.txt', keep.join('\n') + '\n\nВСЕГО СТРОК: ' + L.length + '\n', 'utf8');
console.log(keep.length);
