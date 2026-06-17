const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const {
  getDefaultChromeUserDataDir,
  listChromeProfiles,
  cloneChromeProfiles,
  deleteChromeProfiles,
} = require('./src/core/chromeCloneService');
const { createUpdateService } = require('./src/core/updateService');

function createWindow() {
  const window = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: '#0b0f17',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  return window;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const window = createWindow();
  const updateService = createUpdateService(window);
  let cloneInProgress = false;

  ipcMain.handle('profiles:default-path', async () => {
    return getDefaultChromeUserDataDir();
  });

  ipcMain.handle('app:meta', async () => {
    return {
      productName: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
    };
  });

  ipcMain.handle('updater:get-status', async () => updateService.getStatus());

  ipcMain.handle('updater:check', async () => {
    if (cloneInProgress) {
      throw new Error('Finish the clone run before checking updates.');
    }
    await updateService.checkForUpdates();
    return updateService.getStatus();
  });

  ipcMain.handle('updater:download', async () => {
    if (cloneInProgress) {
      throw new Error('Finish the clone run before downloading an update.');
    }
    await updateService.downloadUpdate();
    return updateService.getStatus();
  });

  ipcMain.handle('updater:install', async () => {
    if (cloneInProgress) {
      throw new Error('Finish the clone run before installing an update.');
    }
    updateService.installUpdateNow();
    return { ok: true };
  });

  ipcMain.handle('updater:open-feed', async () => {
    await updateService.openReleaseFeed();
    return { ok: true };
  });

  ipcMain.handle('profiles:list', async (_event, userDataDir) => {
    return listChromeProfiles(userDataDir);
  });

  ipcMain.handle('profiles:clone', async (_event, payload) => {
    cloneInProgress = true;
    window.webContents.send('app:busy-state', { cloneInProgress });
    try {
      return await cloneChromeProfiles({
        ...payload,
        managedExtensionRoot: path.join(app.getPath('userData'), 'unpacked-extensions'),
      });
    } finally {
      cloneInProgress = false;
      window.webContents.send('app:busy-state', { cloneInProgress });
    }
  });

  ipcMain.handle('profiles:delete', async (_event, payload) => {
    cloneInProgress = true;
    window.webContents.send('app:busy-state', { cloneInProgress });
    try {
      return await deleteChromeProfiles({
        ...payload,
        managedExtensionRoot: path.join(app.getPath('userData'), 'unpacked-extensions'),
      });
    } finally {
      cloneInProgress = false;
      window.webContents.send('app:busy-state', { cloneInProgress });
    }
  });

  ipcMain.handle('dialog:pick-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  updateService.init().catch((error) => {
    if (!window.isDestroyed()) {
      window.webContents.send('updater:status', {
        ...updateService.getStatus(),
        message: `Update init error: ${error.message}`,
      });
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
