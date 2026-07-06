// LT Fabrik som installérbar Windows-app (Electron).
// Starter den lokale server internt, viser app'en i et vindue og holder sig
// selv opdateret via GitHub Releases (electron-updater).
'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server.js');

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const saveCfg = (c) => { try { fs.writeFileSync(cfgFile(), JSON.stringify(c)); } catch { /* ignorér */ } };

let win = null;
let root = null;

async function pickRoot() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Vælg mappen, hvor dine slide-mapper ligger',
    properties: ['openDirectory'],
    defaultPath: root || app.getPath('documents'),
  });
  if (!r.canceled && r.filePaths[0]) {
    root = r.filePaths[0];
    saveCfg({ ...loadCfg(), root });
  }
  return root;
}

function setupAutoUpdate() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', (info) => {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Opdatering klar',
        message: `LT Fabrik ${info.version} er hentet.`,
        detail: 'Genstart programmet for at bruge den nye version.',
        buttons: ['Genstart nu', 'Senere'],
        cancelId: 1,
      }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
    });
    autoUpdater.on('error', () => { /* offline m.m. — stille */ });
    autoUpdater.checkForUpdates().catch(() => {});
    // tjek igen hver 4. time, hvis programmet står åbent længe
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600 * 1000);
  } catch { /* updater ikke tilgængelig i dev-kørsel */ }
}

app.whenReady().then(async () => {
  const cfg = loadCfg();
  root = cfg.root && fs.existsSync(cfg.root) ? cfg.root : app.getPath('documents');

  const { port } = await startServer({
    root: () => root,
    appDir: __dirname,
    port: 0, // ledig port — kolliderer aldrig med andre programmer
    pickRoot,
  });

  win = new BrowserWindow({
    width: 1500,
    height: 950,
    backgroundColor: '#0f1216',
    autoHideMenuBar: true,
    title: 'LT Fabrik',
  });
  win.loadURL('http://127.0.0.1:' + port + '/');

  if (process.env.LT_TEST === '1') {
    // røgtest: bekræft at serveren svarer, og luk
    const http = require('http');
    http.get('http://127.0.0.1:' + port + '/api/caps', (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { console.log('LT_TEST caps:', body); app.exit(0); });
    }).on('error', () => app.exit(1));
    return;
  }

  if (app.isPackaged) setupAutoUpdate();
});

app.on('window-all-closed', () => app.quit());
