const __p = require('path');
const T = __p.join(__dirname, 'out') + __p.sep;
const ROOTDIR = __p.resolve(__dirname, '..', '..');
require('fs').mkdirSync(T, { recursive: true });
/* runchk.cjs — полный check.mjs, вывод в UTF-8 файлом (без PowerShell-редиректа) */
const fs = require('fs');
const { spawnSync } = require('child_process');
const ROOT = ROOTDIR;
const r = spawnSync(process.execPath, ['tools/check.mjs'], { cwd: ROOT, encoding: 'buffer' });
const out = (r.stdout ? r.stdout.toString('utf8') : '') + '\n--STDERR--\n' + (r.stderr ? r.stderr.toString('utf8') : '');
fs.writeFileSync(T + 'chk8.txt', 'EXIT=' + r.status + '\n' + out, 'utf8');
const L = out.split(/\r?\n/);
fs.writeFileSync(T + 'chk-tail.txt', 'EXIT=' + r.status + ' строк=' + L.length + '\n' + L.slice(-14).join('\n'), 'utf8');
/* отдаём код возврата check.mjs наружу: без этого любой обёрнутый прогон «зелёный» */
process.exit(r.status === 0 ? 0 : 1);
