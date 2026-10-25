const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const { Library } = require('./library');

let mainWindow;
let library;

function unpacked(binaryPath) {
  if (!binaryPath) return binaryPath;
  return app.isPackaged ? binaryPath.replace('app.asar', 'app.asar.unpacked') : binaryPath;
}

function asFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function publicMovie(movie) {
  if (!movie) return null;
  return {
    ...movie,
    mediaUrl: asFileUrl(movie.path),
    frames: (movie.frames || []).map(asFileUrl),
    playableSubtitles: (movie.playableSubtitles || []).map((sub) => ({
      ...sub,
      url: asFileUrl(sub.path)
    }))
  };
}

function publicState() {
  return {
    folders: library.state.folders,
    movies: library.state.movies.map(publicMovie)
  };
}

function sendScanComplete() {
  mainWindow?.webContents.send('library:scan-progress', {
    done: library.state.movies.length,
    total: library.state.movies.length,
    complete: true
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: '#090909',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#090909',
      symbolColor: '#f5f5f5',
      height: 42
    },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  library = new Library({
    configPath: path.join(userData, 'library.json'),
    cacheDir: path.join(userData, 'preview-cache'),
    ffmpegPath: unpacked(ffmpegStatic),
    ffprobePath: unpacked(ffprobeStatic.path),
    onProgress: (payload) => mainWindow?.webContents.send('library:scan-progress', payload)
  });

  await library.load();
  await createWindow();

  if (library.state.folders.length && !library.state.movies.length) {
    library.scan().then(sendScanComplete);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('library:state', () => publicState());

ipcMain.handle('library:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona carpetas con películas',
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled || !result.filePaths.length) return publicState();

  const merged = [...new Set([...(library.state.folders || []), ...result.filePaths])];
  await library.setFolders(merged);
  sendScanComplete();
  return publicState();
});

ipcMain.handle('library:rescan', async () => {
  await library.scan();
  sendScanComplete();
  return publicState();
});

ipcMain.handle('movie:info', (_event, id) => publicMovie(library.find(id)));

ipcMain.handle('movie:reveal', (_event, id) => {
  const movie = library.find(id);
  if (movie) shell.showItemInFolder(movie.path);
  return true;
});

ipcMain.handle('movie:favorite', async (_event, id) => {
  const favorite = await library.toggleFavorite(id);
  return { favorite };
});

ipcMain.handle('movie:progress', async (_event, { movieId, seconds, duration }) => {
  return library.setProgress(movieId, seconds, duration);
});
