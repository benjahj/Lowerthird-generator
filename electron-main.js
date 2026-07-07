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
    title: 'Choose the folder that contains your slide folders',
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
    // spørg FØR download — brugeren vælger "Update now" eller "Remind me later"
    autoUpdater.autoDownload = false;
    let asking = false;
    autoUpdater.on('update-available', async (info) => {
      if (asking) return;
      asking = true;
      const r = await dialog.showMessageBox(win, {
        type: 'question',
        title: 'Update available',
        message: `A new version of LT Factory is available (${info.version}).`,
        detail: 'Would you like to update now? The app will restart when the download finishes.',
        buttons: ['Update now', 'Remind me later'],
        defaultId: 0,
        cancelId: 1,
      });
      asking = false;
      if (r.response === 0) autoUpdater.downloadUpdate().catch(() => {});
    });
    autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall(false, true));
    autoUpdater.on('error', () => { /* offline etc. — appen virker fint uden net */ });
    autoUpdater.checkForUpdates().catch(() => {});
    // mind om det igen senere, hvis programmet står åbent længe
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
    version: app.getVersion(),
  });

  win = new BrowserWindow({
    width: 1500,
    height: 950,
    backgroundColor: '#0f1216',
    autoHideMenuBar: true,
    title: 'LT Factory',
  });
  win.loadURL('http://127.0.0.1:' + port + '/');

  // usavede projekt-ændringer: spørg før lukning
  let closing = false;
  win.on('close', async (e) => {
    if (closing) return;
    e.preventDefault();
    let dirty = false;
    try { dirty = await win.webContents.executeJavaScript('!!(window.__ltDirty && window.__ltDirty())'); } catch { /* side ikke klar */ }
    if (!dirty) { closing = true; win.close(); return; }
    const r = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Save project?',
      message: 'You have unsaved project changes.',
      detail: 'Do you want to save this project before closing?',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (r.response === 2) return;
    if (r.response === 0) {
      try { await win.webContents.executeJavaScript('window.__ltQuickSave && window.__ltQuickSave()'); } catch { /* */ }
    }
    closing = true;
    win.close();
  });

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

  // auto-opdatering kun på Windows — på macOS kræver det Apple-signering
  if (app.isPackaged && process.platform === 'win32') setupAutoUpdate();
}).catch((e) => {
  // fx firewall/antivirus der blokerer serveren — vis fejlen i stedet for at
  // efterlade en usynlig, hængende proces
  dialog.showErrorBox('LT Factory could not start', String(e && e.message || e));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
