// Packs dist/DeepScrape-win32-x64 into one installer: dist/DeepScrape-Setup-<version>.exe
// Needs NSIS 3 (makensis) on the PATH. Run after: npm run build:win
const fs = require('fs'); const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const src = path.join(root, 'dist', 'DeepScrape-win32-x64');
const { version } = require(path.join(root, 'package.json'));
if (!fs.existsSync(path.join(src, 'DeepScrape.exe'))) { console.error('Run "npm run build:win" first.'); process.exit(1); }
let bytes = 0; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else bytes += fs.statSync(f).size; } })(src);
const out = path.join(root, 'dist', `DeepScrape-Setup-${version}.exe`);
const flag = process.platform === 'win32' ? '/' : '-';
const fwd = (p) => p.replace(/\\/g, '/');
execFileSync('makensis', [`${flag}V2`, `${flag}DVERSION=${version}`, `${flag}DROOT=${fwd(root)}`, `${flag}DSRC=${fwd(src)}`, `${flag}DOUT=${fwd(out)}`, `${flag}DSIZE_KB=${Math.round(bytes / 1024)}`, path.join(__dirname, 'installer.nsi')], { stdio: 'inherit' });
console.log('Built', out, `(${(fs.statSync(out).size / 1048576).toFixed(0)} MB)`);
