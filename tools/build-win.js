// Builds the Windows desktop app into dist/DeepScrape-win32-x64 (DeepScrape.exe plus its files).
// Works from Windows, macOS or Linux. Run: npm run build:win
const fs = require('fs'); const path = require('path');
const { execFileSync } = require('child_process');
const { packager } = require('@electron/packager');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'stage');
const pkg = require(path.join(root, 'package.json'));
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;

(async () => {
  fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
  // Only what the app needs at run time: no tests, screenshots, saved scrapes or build tools.
  for (const item of ['server.js', 'scrape.js', 'mcp.js', 'lib', 'public', 'electron', 'LICENSE.md', 'README.md', 'package-lock.json']) fs.cpSync(path.join(root, item), path.join(stage, item), { recursive: true });
  fs.mkdirSync(path.join(stage, 'build')); fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(stage, 'build', 'icon.png'));
  const appPkg = { ...pkg, main: 'electron/main.js', productName: 'DeepScrape' };
  delete appPkg.devDependencies; delete appPkg.scripts; delete appPkg.bin;
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(appPkg, null, 2));
  // Install the run-time packages as Windows would, so platform-specific parts match the target.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['install', '--omit=dev', '--os=win32', '--cpu=x64', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });

  const out = await packager({
    dir: stage, out: dist, name: 'DeepScrape', platform: 'win32', arch: 'x64', electronVersion, overwrite: true,
    asar: false, prune: false, icon: path.join(root, 'build', 'icon.ico'),
    appVersion: pkg.version, appCopyright: `Copyright (c) ${new Date().getFullYear()} ${pkg.author}`,
    win32metadata: { CompanyName: pkg.author, FileDescription: 'DeepScrape', ProductName: 'DeepScrape', InternalName: 'DeepScrape', OriginalFilename: 'DeepScrape.exe' },
    ignore: [/\.map$/, /\/node_modules\/\.package-lock\.json$/],
  });
  fs.rmSync(stage, { recursive: true, force: true });
  console.log('Built', out[0]);
})().catch((e) => { console.error(e); process.exit(1); });
