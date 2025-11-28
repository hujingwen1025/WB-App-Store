const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('progressAPI', {
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => callback(data));
  },
  cancelUpdate: () => {
    ipcRenderer.send('message-to-main', 'cancel-update');
  }
});
