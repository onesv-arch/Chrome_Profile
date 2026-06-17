const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chromeCloner', {
  getUpdateStatus: () => ipcRenderer.invoke('updater:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  openUpdateFeed: () => ipcRenderer.invoke('updater:open-feed'),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
  onBusyState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:busy-state', listener);
    return () => ipcRenderer.removeListener('app:busy-state', listener);
  },
  getAppMeta: () => ipcRenderer.invoke('app:meta'),
  getDefaultPath: () => ipcRenderer.invoke('profiles:default-path'),
  listProfiles: (userDataDir) => ipcRenderer.invoke('profiles:list', userDataDir),
  cloneProfiles: (payload) => ipcRenderer.invoke('profiles:clone', payload),
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
});
