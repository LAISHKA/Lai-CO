/* Запуск скрипта с выводом в UTF-8: node tools/live/run.cjs tools/live/play.cjs
   Пишет out/run-out.txt (EXIT + stdout + stderr) и печатает только EXIT. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const T = path.join(__dirname, 'out') + path.sep;
const ROOTDIR = path.resolve(__dirname, '..', '..');
fs.mkdirSync(T, { recursive: true });
const [target, ...rest] = process.argv.slice(2);
const r = spawnSync(process.execPath, [target].concat(rest), { cwd: ROOTDIR, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
const so = r.stdout ? r.stdout.toString('utf8') : '';
const se = r.stderr ? r.stderr.toString('utf8') : '';
fs.writeFileSync(T + 'run-out.txt', 'EXIT=' + r.status + '\n--STDOUT--\n' + so + '\n--STDERR--\n' + se, 'utf8');
console.log('EXIT=' + r.status);
