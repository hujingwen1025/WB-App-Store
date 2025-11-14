const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  receiveMessage: (callback) => {
    ipcRenderer.on('main-message', (event, data) => callback(data));
  },

  installedMessage: (callback) => {
    ipcRenderer.on('installedList', (event, data) => callback(data));
  },
  
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('main-message');
  }
});

ipcRenderer.on('clearLS', () => {localStorage.clear()});