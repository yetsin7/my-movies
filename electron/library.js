const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.mov', '.m4v', '.avi', '.webm', '.wmv', '.flv', '.mpeg',
  '.mpg', '.ts', '.m2ts', '.mts', '.ogv'
]);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);

function hash(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

function cleanTitle(filename) {
  const stem = path.basename(filename, path.extname(filename))
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|hdr10|hdr|bluray|blu-ray|webrip|web-dl|x264|x265|h264|h265|hevc|aac|dts|remux)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stem || path.basename(filename);
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

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
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) results.push(full);
    }
  }
  return results;
}

async function adjacentSubtitles(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && SUBTITLE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .filter((e) => path.basename(e.name, path.extname(e.name)).toLowerCase().startsWith(base))
    .map((e) => ({
      path: path.join(dir, e.name),
      label: path.basename(e.name),
      extension: path.extname(e.name).toLowerCase()
    }));
}

function streamSummary(streams = []) {
  return {
    video: streams
      .filter((s) => s.codec_type === 'video')
      .map((s) => ({
        index: s.index,
        codec: s.codec_name,
        width: s.width,
        height: s.height,
        language: s.tags?.language || null,
        title: s.tags?.title || null
      })),
    audio: streams
      .filter((s) => s.codec_type === 'audio')
      .map((s) => ({
        index: s.index,
        codec: s.codec_name,
        channels: s.channels,
        layout: s.channel_layout,
        language: s.tags?.language || 'und',
        title: s.tags?.title || null
      })),
    subtitles: streams
      .filter((s) => s.codec_type === 'subtitle')
      .map((s) => ({
        index: s.index,
        codec: s.codec_name,
        language: s.tags?.language || 'und',
        title: s.tags?.title || null
      }))
  };
}

async function probe(filePath, ffprobePath) {
  try {
    const raw = await run(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]);
    const data = JSON.parse(raw);
    return {
      duration: Number(data.format?.duration || 0),
      size: Number(data.format?.size || 0),
      bitrate: Number(data.format?.bit_rate || 0),
      format: data.format?.format_long_name || data.format?.format_name || '',
      tags: data.format?.tags || {},
      streams: streamSummary(data.streams || [])
    };
  } catch {
    return {
      duration: 0,
      size: 0,
      bitrate: 0,
      format: '',
      tags: {},
      streams: { video: [], audio: [], subtitles: [] }
    };
  }
}

async function generateFrames(movie, cacheDir, ffmpegPath, count = 4) {
  const movieDir = path.join(cacheDir, movie.id);
  await fsp.mkdir(movieDir, { recursive: true });
  const existing = [];
  for (let i = 0; i < count; i++) {
    const candidate = path.join(movieDir, 'frame-' + i + '.jpg');
    try {
      await fsp.access(candidate);
      existing.push(candidate);
    } catch {}
  }
  if (existing.length === count) return existing;

  const duration = Math.max(movie.duration || 0, 1);
  const points = [0.14, 0.32, 0.58, 0.78].slice(0, count);
  const created = [];
  for (let i = 0; i < points.length; i++) {
    const output = path.join(movieDir, 'frame-' + i + '.jpg');
    try {
      await run(ffmpegPath, [
        '-y',
        '-ss', String(Math.max(2, duration * points[i])),
        '-i', movie.path,
        '-frames:v', '1',
        '-vf', 'scale=960:-2',
        '-q:v', '3',
        output
      ]);
      created.push(output);
    } catch {}
  }
  return created;
}

class Library {
  constructor({ configPath, cacheDir, ffmpegPath, ffprobePath, onProgress }) {
    this.configPath = configPath;
    this.cacheDir = cacheDir;
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.onProgress = onProgress || (() => {});
    this.state = {
      folders: [],
      movies: [],
      favorites: {},
      progress: {}
    };
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.configPath, 'utf8');
      this.state = { ...this.state, ...JSON.parse(raw) };
    } catch {}
    return this.state;
  }

  async save() {
    await fsp.mkdir(path.dirname(this.configPath), { recursive: true });
    await fsp.writeFile(this.configPath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  async setFolders(folders) {
    this.state.folders = [...new Set(folders)];
    await this.save();
    return this.scan();
  }

  async scan() {
    const all = [];
    for (const folder of this.state.folders) {
      all.push(...await walk(folder));
    }
    const unique = [...new Set(all)];
    const movies = [];
    let done = 0;

    for (const filePath of unique) {
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat) continue;
      const id = hash(filePath.toLowerCase());
      const info = await probe(filePath, this.ffprobePath);
      const externalSubtitles = await adjacentSubtitles(filePath);
      const movie = {
        id,
        path: filePath,
        title: info.tags?.title || cleanTitle(filePath),
        filename: path.basename(filePath),
        folder: path.dirname(filePath),
        extension: path.extname(filePath).toLowerCase(),
        modifiedAt: stat.mtimeMs,
        duration: info.duration,
        size: info.size,
        bitrate: info.bitrate,
        format: info.format,
        streams: info.streams,
        externalSubtitles,
        favorite: Boolean(this.state.favorites[id]),
        progress: this.state.progress[id] || null,
        frames: []
      };
      movie.frames = await generateFrames(movie, this.cacheDir, this.ffmpegPath, 4);
      movies.push(movie);
      done += 1;
      this.onProgress({ done, total: unique.length, title: movie.title });
    }

    movies.sort((a, b) => b.modifiedAt - a.modifiedAt);
    this.state.movies = movies;
    await this.save();
    return this.state;
  }

  find(id) {
    return this.state.movies.find((movie) => movie.id === id) || null;
  }

  async toggleFavorite(id) {
    this.state.favorites[id] = !this.state.favorites[id];
    const movie = this.find(id);
    if (movie) movie.favorite = this.state.favorites[id];
    await this.save();
    return Boolean(this.state.favorites[id]);
  }

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
