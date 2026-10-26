const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const {
  VIDEO_EXTENSIONS,
  FRAME_VERSION,
  resolveTitle,
  detectYear,
  probe,
  generateFrames,
  prepareSubtitles
} = require('./media-probe');

/**
 * Generates a consistent SHA-1 hash from input string.
 * @param {string} input String to hash.
 * @returns {string} Hexadecimal hash.
 */
function hash(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

/**
 * Asynchronously walks a directory tree and collects all matching video files.
 * @param {string} root Base folder path.
 * @returns {Promise<string[]>} List of absolute video file paths.
 */
async function walk(root) {
  const results = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(full);
      }
    }
  }
  return results;
}

/**
 * Normalizes a path for case-insensitive comparison (Windows file systems).
 * @param {string} value Path to normalize.
 * @returns {string} Absolute lowercase path.
 */
function normalizePath(value) {
  return path.resolve(value).toLowerCase();
}

/**
 * Tells whether a file lives inside any of the given folders.
 * @param {string} file Absolute file path.
 * @param {string[]} folders Folder paths.
 * @returns {boolean} True when at least one folder contains the file.
 */
function isInsideAny(file, folders) {
  const target = normalizePath(file);
  return folders.some((folder) => {
    const root = normalizePath(folder);
    return target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  });
}

/**
 * Manages the movie library state, folder discovery, and video indexing.
 */
class Library {
  /**
   * Initializes the Library manager instance.
   * @param {object} options Configuration options.
   * @param {string} options.configPath Path to library.json storage.
   * @param {string} options.cacheDir Directory path for generated previews.
   * @param {string} options.ffmpegPath Path to ffmpeg binary.
   * @param {string} options.ffprobePath Path to ffprobe binary.
   * @param {Function} [options.onProgress] Scan progress callback.
   * @param {Function} [options.onUpdate] Called whenever the movie list changes during a scan.
   */
  constructor({ configPath, cacheDir, ffmpegPath, ffprobePath, onProgress, onUpdate } = {}) {
    this.configPath = configPath;
    this.cacheDir = cacheDir;
    this.ffmpegPath = ffmpegPath || 'ffmpeg';
    this.ffprobePath = ffprobePath || 'ffprobe';
    this.onProgress = onProgress || (() => {});
    this.onUpdate = onUpdate || (() => {});
    this.scanPromise = null;
    this.rescanQueued = false;
    this.state = {
      folders: [],
      movies: [],
      favorites: {},
      progress: {}
    };
  }

  /**
   * Loads persisted library configuration and movie metadata from disk.
   * @returns {Promise<object>} Current library state.
   */
  async load() {
    try {
      const raw = await fsp.readFile(this.configPath, 'utf8');
      this.state = { ...this.state, ...JSON.parse(raw) };
      if (Array.isArray(this.state.movies)) {
        this.state.movies = this.state.movies.map((m) => ({
          ...m,
          title: resolveTitle(m.title, m.path)
        }));
      }
    } catch {}
    return this.state;
  }

  /**
   * Saves current library configuration and movie list to disk.
   * @returns {Promise<void>}
   */
  async save() {
    await fsp.mkdir(path.dirname(this.configPath), { recursive: true });
    await fsp.writeFile(this.configPath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  /**
   * Updates configured video library folders and persists them. Does not scan;
   * call scan() afterwards so the caller decides whether to wait for it.
   * @param {string[]} folders Array of directory paths.
   * @returns {Promise<object>} Updated library state.
   */
  async setFolders(folders) {
    this.state.folders = [...new Set(folders)];
    await this.save();
    return this.state;
  }

  /**
   * Removes a folder from the library and drops the movies only it provided.
   * Files on disk are never touched; favorites and progress are kept in case
   * the folder is added again.
   * @param {string} folder Folder path as stored in state.folders.
   * @returns {Promise<object>} Updated library state.
   */
  async removeFolder(folder) {
    const target = normalizePath(folder);
    this.state.folders = this.state.folders.filter((item) => normalizePath(item) !== target);
    this.state.movies = this.state.movies.filter((movie) => isInsideAny(movie.path, this.state.folders));
    // A scan already walking the removed folder could re-add its movies; queue a pass that prunes them.
    if (this.scanPromise) this.rescanQueued = true;
    await this.save();
    this.onUpdate();
    return this.state;
  }

  /**
   * Scans configured folders without overlapping runs. A request made while a
   * scan is running queues one more pass so newly added folders are not missed.
   * @returns {Promise<object>} Library state once all queued passes finish.
   */
  scan() {
    if (this.scanPromise) {
      this.rescanQueued = true;
      return this.scanPromise;
    }
    this.scanPromise = (async () => {
      try {
        do {
          this.rescanQueued = false;
          await this.runScan();
        } while (this.rescanQueued);
        return this.state;
      } finally {
        this.scanPromise = null;
      }
    })();
    return this.scanPromise;
  }

  /**
   * Inserts or replaces a movie and keeps the list sorted by newest first.
   * @param {object} movie Movie to store.
   */
  upsertMovie(movie) {
    const index = this.state.movies.findIndex((m) => m.id === movie.id);
    if (index >= 0) this.state.movies[index] = movie;
    else this.state.movies.push(movie);
    this.state.movies.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  /**
   * Walks configured folders, extracts metadata, frames, and subtitles, and
   * publishes each movie as soon as it is ready.
   * @returns {Promise<object>} Updated library state with sorted movies.
   */
  async runScan() {
    const all = [];
    for (const folder of this.state.folders) {
      all.push(...await walk(folder));
    }
    const unique = [...new Set(all)];
    const previous = new Map((this.state.movies || []).map((movie) => [movie.path.toLowerCase(), movie]));
    const found = new Set(unique.map((filePath) => filePath.toLowerCase()));
    // Drop entries whose file or folder is gone; keep the rest visible while scanning.
    this.state.movies = (this.state.movies || []).filter((movie) => found.has(movie.path.toLowerCase()));
    let done = 0;
    this.onProgress({ done, total: unique.length });
    this.onUpdate();

    for (const filePath of unique) {
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat) continue;

      const id = hash(filePath.toLowerCase());
      const cached = previous.get(filePath.toLowerCase());
      const unchanged = cached &&
        Number(cached.modifiedAt) === Number(stat.mtimeMs) &&
        Number(cached.fileSizeOnDisk || cached.size || 0) === Number(stat.size);

      let movie;
      if (unchanged) {
        movie = {
          ...cached,
          title: resolveTitle(cached.title, filePath),
          favorite: Boolean(this.state.favorites[id]),
          progress: this.state.progress[id] || null
        };
        if (!movie.frames?.length || movie.framesVersion !== FRAME_VERSION) {
          movie.frames = await generateFrames(movie, this.cacheDir, this.ffmpegPath, 5);
          movie.framesVersion = FRAME_VERSION;
        }
        if (!movie.playableSubtitles) {
          movie.playableSubtitles = await prepareSubtitles(movie, this.cacheDir, this.ffmpegPath);
        }
      } else {
        const info = await probe(filePath, this.ffprobePath);
        const movieTitle = resolveTitle(info.tags?.title, filePath);

        movie = {
          id,
          path: filePath,
          title: movieTitle,
          filename: path.basename(filePath),
          folder: path.dirname(filePath),
          extension: path.extname(filePath).toLowerCase(),
          modifiedAt: stat.mtimeMs,
          fileSizeOnDisk: stat.size,
          duration: info.duration,
          size: info.size || stat.size,
          bitrate: info.bitrate,
          format: info.format,
          streams: info.streams,
          hdr: info.hdr,
          year: detectYear(movieTitle, path.basename(filePath)),
          favorite: Boolean(this.state.favorites[id]),
          progress: this.state.progress[id] || null,
          frames: [],
          playableSubtitles: []
        };
        movie.frames = await generateFrames(movie, this.cacheDir, this.ffmpegPath, 5);
        movie.framesVersion = FRAME_VERSION;
        movie.playableSubtitles = await prepareSubtitles(movie, this.cacheDir, this.ffmpegPath);
      }

      this.upsertMovie(movie);
      done += 1;
      this.onProgress({
        done,
        total: unique.length,
        title: movie.title,
        cached: unchanged
      });
      this.onUpdate();
      if (!unchanged && done % 10 === 0) await this.save();
    }

    await this.save();
    return this.state;
  }

  /**
   * Finds a movie in memory by its unique hash ID.
   * @param {string} id Unique movie hash.
   * @returns {object|null} Movie object if found.
   */
  find(id) {
    return this.state.movies.find((movie) => movie.id === id) || null;
  }

  /**
   * Toggles the favorite status for a movie.
   * @param {string} id Unique movie hash.
   * @returns {Promise<boolean>} New favorite state.
   */
  async toggleFavorite(id) {
    this.state.favorites[id] = !this.state.favorites[id];
    const movie = this.find(id);
    if (movie) movie.favorite = this.state.favorites[id];
    await this.save();
    return Boolean(this.state.favorites[id]);
  }

  /**
   * Records playback timestamp progress for resuming.
   * @param {string} id Unique movie hash.
   * @param {number} seconds Current playback position in seconds.
   * @param {number} duration Total movie duration in seconds.
   * @returns {Promise<object>} Updated progress record.
   */
  async setProgress(id, seconds, duration) {
    this.state.progress[id] = {
      seconds: Number(seconds || 0),
      duration: Number(duration || 0),
      updatedAt: Date.now()
    };
    const movie = this.find(id);
    if (movie) movie.progress = this.state.progress[id];
    await this.save();
    return this.state.progress[id];
  }
}

module.exports = { Library };
