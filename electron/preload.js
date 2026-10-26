const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myMovies', {
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  getState: () => ipcRenderer.invoke('library:state'),
  removeFolder: (folder) => ipcRenderer.invoke('library:remove-folder', folder),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  getMediaInfo: (movieId) => ipcRenderer.invoke('movie:info', movieId),
  prepareAudio: (movieId, trackIndex) => ipcRenderer.invoke('movie:audio-compatible', movieId, trackIndex),
  audioStreamUrl: (movieId, trackIndex, startSeconds) =>
    ipcRenderer.invoke('movie:audio-stream-url', movieId, trackIndex, startSeconds),
  revealFile: (movieId) => ipcRenderer.invoke('movie:reveal', movieId),
  toggleFavorite: (movieId) => ipcRenderer.invoke('movie:favorite', movieId),
  setProgress: (movieId, seconds, duration) =>
    ipcRenderer.invoke('movie:progress', { movieId, seconds, duration }),
  onLibraryUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('library:updated', handler);
    return () => ipcRenderer.removeListener('library:updated', handler);
  },
  onScanProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('library:scan-progress', handler);
    return () => ipcRenderer.removeListener('library:scan-progress', handler);
  }
});
