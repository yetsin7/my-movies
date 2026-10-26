const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require('electron');
const { Library } = require('./library');

const APP_ID = 'com.mymovies.desktop';
const WINDOW_ICON = path.join(__dirname, '..', 'src', 'assets', 'icon.png');

let mainWindow;
let library;

app.setAppUserModelId(APP_ID);

// Two instances would fight over the same Chromium cache and library.json.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function getFfmpegPath() {
  try {
    const staticPkg = require('ffmpeg-static');
    if (staticPkg) return unpacked(staticPkg);
  } catch {}

  const defaultWinGet = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WinGet',
    'Links',
    'ffmpeg.exe'
  );
  if (fs.existsSync(defaultWinGet)) return defaultWinGet;
  return 'ffmpeg';
}

function getFfprobePath() {
  try {
    const staticPkg = require('ffprobe-static');
    if (staticPkg && staticPkg.path) return unpacked(staticPkg.path);
  } catch {}

  const defaultWinGet = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WinGet',
    'Links',
    'ffprobe.exe'
  );
  if (fs.existsSync(defaultWinGet)) return defaultWinGet;
  return 'ffprobe';
}

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

let updateTimer = null;
const LIBRARY_UPDATE_INTERVAL_MS = 1200;

function sendLibraryUpdate() {
  clearTimeout(updateTimer);
  updateTimer = null;
  mainWindow?.webContents.send('library:updated', publicState());
}

// Throttled: the renderer rebuilds every row on each update, so batch bursts of new movies.
function scheduleLibraryUpdate() {
  if (!updateTimer) updateTimer = setTimeout(sendLibraryUpdate, LIBRARY_UPDATE_INTERVAL_MS);
}

// Scans without blocking the IPC reply; the UI follows progress and library:updated events.
function scanInBackground() {
  mainWindow?.webContents.send('library:scan-progress', { done: 0, total: 0 });
  library.scan()
    .catch((error) => console.error('Library scan failed:', error))
    .finally(() => {
      sendLibraryUpdate();
      sendScanComplete();
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
    icon: nativeImage.createFromPath(WINDOW_ICON),
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
  if (!hasInstanceLock) return;
  const userData = app.getPath('userData');
  library = new Library({
    configPath: path.join(userData, 'library.json'),
    cacheDir: path.join(userData, 'preview-cache'),
    ffmpegPath: getFfmpegPath(),
    ffprobePath: getFfprobePath(),
    onProgress: (payload) => mainWindow?.webContents.send('library:scan-progress', payload),
    onUpdate: scheduleLibraryUpdate
  });

  await library.load();
  await createWindow();

  if (library.state.folders.length && !library.state.movies.length) {
    scanInBackground();
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
  scanInBackground();
  return publicState();
});

ipcMain.handle('library:rescan', () => {
  scanInBackground();
  return publicState();
});

ipcMain.handle('library:remove-folder', async (_event, folder) => {
  if (typeof folder === 'string' && folder) await library.removeFolder(folder);
  return publicState();
});

ipcMain.handle('movie:info',(_event, id) => publicMovie(library.find(id)));

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
