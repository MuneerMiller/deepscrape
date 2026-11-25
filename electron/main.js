// DeepScrape desktop app.
// Starts the same local server the command line uses (server.js) as a child process and shows the dashboard in its own window.
// Nothing here changes how scraping works: the sign-in windows still belong to the real browser the scraper drives.
const { app, BrowserWindow, Menu, dialog, shell, nativeTheme } = require('electron');
const { fork } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PREFERRED_PORT = 4780;
const REPO = 'https://github.com/MuneerMiller/deepscrape';

let win = null;
let server = null;        // the child process running server.js, when this app started it
let baseUrl = null;
let dataDir = null;
let quitting = false;
let logFile = null;

// Scrapes are the owner's files, so they live in Documents where they can be found, not in a hidden app folder.
// A copy run from source keeps using its own data folder.
function chooseDataDir() {
  if (process.env.DEEPSCRAPE_DATA) return path.resolve(process.env.DEEPSCRAPE_DATA);
  if (!app.isPackaged) return path.join(ROOT, 'data');
  return path.join(app.getPath('documents'), 'DeepScrape', 'data');
}

function getJson(url, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}
function anyFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function log(line) {
  if (!logFile) return;
  try { fs.appendFileSync(logFile, line.endsWith('\n') ? line : line + '\n'); } catch { /* logging is best effort */ }
}
function logTail(lines = 25) {
  try { return fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-lines).join('\n'); } catch { return ''; }
}

// Returns the address of a running DeepScrape server: one that is already open on this computer, or one started here.
async function startServer() {
  dataDir = chooseDataDir();
  const already = await getJson(`http://127.0.0.1:${PREFERRED_PORT}/api/health`);
  if (already && already.app === 'deepscrape') { dataDir = already.data || dataDir; return `http://localhost:${PREFERRED_PORT}`; }

  const port = (await portFree(PREFERRED_PORT)) ? PREFERRED_PORT : await anyFreePort();
  fs.mkdirSync(dataDir, { recursive: true });
  const logDir = app.getPath('logs'); fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, 'server.log');
  try { if (fs.statSync(logFile).size > 2e6) fs.renameSync(logFile, logFile + '.old'); } catch { /* no log yet */ }
  log(`\n--- ${new Date().toISOString()} starting on port ${port}, data in ${dataDir}`);

  return new Promise((resolve, reject) => {
    // fork() runs server.js with this app's own Node (ELECTRON_RUN_AS_NODE), so no separate Node install is needed.
    server = fork(path.join(ROOT, 'server.js'), ['--no-open', '--port', String(port), '--data', dataDir], {
      cwd: ROOT, silent: true, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DEEPSCRAPE_DESKTOP: '1' },
    });
    server.stdout.on('data', (d) => log(String(d)));
    server.stderr.on('data', (d) => log(String(d)));
    const timer = setTimeout(() => reject(new Error('The scraper did not start within 30 seconds.')), 30000);
    server.on('message', (m) => {
      if (m && m.ready) { clearTimeout(timer); resolve(`http://localhost:${m.port}`); }
    });
    server.on('error', (e) => { clearTimeout(timer); reject(e); });
    server.on('exit', (code) => {
      clearTimeout(timer);
      const wasReady = !!baseUrl; server = null;
      log(`--- server stopped (code ${code})`);
      if (quitting) return;
      if (!wasReady) return reject(new Error(`The scraper stopped while starting (code ${code}).`));
      const pick = dialog.showMessageBoxSync(win || undefined, {
        type: 'error', title: 'DeepScrape', message: 'The scraper stopped unexpectedly.',
        detail: `Scrapes that were running saved their progress and can be resumed.\n\nLast lines of the log:\n${logTail(12)}`,
        buttons: ['Restart DeepScrape', 'Quit'], defaultId: 0, cancelId: 1,
      });
      if (pick === 0) { app.relaunch(); }
      quitting = true; app.quit();
    });
  });
}

const isLocal = (url) => { try { const u = new URL(url); return ['localhost', '127.0.0.1'].includes(u.hostname); } catch { return false; } };

function splash() {
  const dark = nativeTheme.shouldUseDarkColors;
  const html = `<body style="margin:0;height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:${dark ? '#0F1A26' : '#EEF2F5'};color:${dark ? '#E6EDF3' : '#14263B'}"><div>Starting DeepScrape…</div></body>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600, title: 'DeepScrape',
    icon: path.join(ROOT, 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F1A26' : '#EEF2F5',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.loadURL(splash());
  // Links to other websites open in the normal browser; the dashboard's own pages (reports, saved copies) open in app windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocal(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: path.join(ROOT, 'build', 'icon.png'), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isLocal(url) || url.startsWith('data:')) return;
    e.preventDefault(); if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
  });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); quit(); } });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const template = [
    { label: 'File', submenu: [
      { label: 'Open results folder', click: () => { if (dataDir) shell.openPath(dataDir); } },
      { label: 'Open dashboard in browser', click: () => { if (baseUrl) shell.openExternal(baseUrl); } },
      { type: 'separator' },
      { label: 'Quit DeepScrape', accelerator: 'CmdOrCtrl+Q', click: () => quit() },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'Guide and source on GitHub', click: () => shell.openExternal(REPO) },
      { label: 'Show the log file', click: () => { if (logFile) shell.showItemInFolder(logFile); } },
      { type: 'separator' },
      { label: `Version ${app.getVersion()}`, enabled: false },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Closing the window stops running scrapes, so ask first. Their progress is saved either way.
async function quit() {
  if (quitting) return;
  const health = baseUrl ? await getJson(`${baseUrl.replace('localhost', '127.0.0.1')}/api/health`) : null;
  if (server && health && health.running > 0) {
    const n = health.running;
    const pick = dialog.showMessageBoxSync(win || undefined, {
      type: 'question', title: 'DeepScrape', message: `${n} scrape${n === 1 ? ' is' : 's are'} still running.`,
      detail: 'Quitting stops them. Their progress is saved, and you can resume them next time.',
      buttons: ['Keep running', 'Stop and quit'], defaultId: 0, cancelId: 0,
    });
    if (pick === 0) return;
  }
  quitting = true;
  if (server) {
    const child = server;
    await new Promise((resolve) => {
      const hard = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } resolve(); }, 35000);
      child.once('exit', () => { clearTimeout(hard); resolve(); });
      try { child.send('shutdown'); } catch { try { child.kill(); } catch { /* already gone */ } }
    });
  }
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.muneermiller.deepscrape');
    buildMenu(); createWindow();
    try {
      baseUrl = await startServer();
      if (win) await win.loadURL(baseUrl);
    } catch (e) {
      dialog.showMessageBoxSync(win || undefined, { type: 'error', title: 'DeepScrape', message: 'DeepScrape could not start.', detail: `${e.message}\n\n${logTail(12)}` });
      quitting = true; app.quit();
    }
  });
}
