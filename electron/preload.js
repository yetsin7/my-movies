const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myMovies', {
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  getState: () => ipcRenderer.invoke('library:state'),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  getMediaInfo: (movieId) => ipcRenderer.invoke('movie:info', movieId),
  revealFile: (movieId) => ipcRenderer.invoke('movie:reveal', movieId),
  toggleFavorite: (movieId) => ipcRenderer.invoke('movie:favorite', movieId),
  setProgress: (movieId, seconds, duration) =>
    ipcRenderer.invoke('movie:progress', { movieId, seconds, duration }),
  onScanProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('library:scan-progress', handler);
    return () => ipcRenderer.removeListener('library:scan-progress', handler);
  }
});
