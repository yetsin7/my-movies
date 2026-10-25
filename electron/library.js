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
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text']);

function hash(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

function cleanTitle(filename) {
  const stem = path.basename(filename, path.extname(filename))
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|hdr10\+?|dolby[ ._-]?vision|hdr|bluray|blu-ray|webrip|web-dl|x264|x265|h264|h265|hevc|av1|aac|dts|remux)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stem || path.basename(filename);
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
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

function parseFrameRate(value) {
  if (!value || value === '0/0') return 0;
  const [a, b] = String(value).split('/').map(Number);
  if (!Number.isFinite(a)) return 0;
  return b ? a / b : a;
}

function normalizeLanguage(value) {
  return String(value || 'und').toLowerCase();
}

function streamSummary(streams = []) {
  return {
    video: streams
      .filter((s) => s.codec_type === 'video')
      .map((s) => ({
        index: s.index,
        codec: s.codec_name,
        profile: s.profile || null,
        width: s.width,
        height: s.height,
        fps: parseFrameRate(s.avg_frame_rate || s.r_frame_rate),
        pixelFormat: s.pix_fmt || null,
        colorSpace: s.color_space || null,
        colorTransfer: s.color_transfer || null,
        colorPrimaries: s.color_primaries || null,
        language: normalizeLanguage(s.tags?.language),
        title: s.tags?.title || null
      })),
    audio: streams
      .filter((s) => s.codec_type === 'audio')
      .map((s) => ({
        index: s.index,
        codec: s.codec_name,
        profile: s.profile || null,
        channels: s.channels,
        layout: s.channel_layout,
        sampleRate: Number(s.sample_rate || 0),
        language: normalizeLanguage(s.tags?.language),
        title: s.tags?.title || null
      })),
    subtitles: streams
      .filter((s) => s.codec_type === 'subtitle')
      .map((s) => ({
        index: s.index,
        codec: s.codec_name,
        language: normalizeLanguage(s.tags?.language),
        title: s.tags?.title || null,
        textBased: TEXT_SUBTITLE_CODECS.has(String(s.codec_name || '').toLowerCase())
      }))
  };
}

function detectHdr(video) {
  if (!video) return null;
  const transfer = String(video.colorTransfer || '').toLowerCase();
  const primaries = String(video.colorPrimaries || '').toLowerCase();
  if (transfer.includes('smpte2084')) return 'HDR10';
  if (transfer.includes('arib-std-b67')) return 'HLG';
  if (primaries.includes('bt2020')) return 'HDR';
  return null;
}

function detectYear(title, filename) {
  const source = String(title || '') + ' ' + String(filename || '');
  const years = [...source.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
  return years.length ? years[years.length - 1] : null;
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
    const streams = streamSummary(data.streams || []);
    return {
      duration: Number(data.format?.duration || 0),
      size: Number(data.format?.size || 0),
      bitrate: Number(data.format?.bit_rate || 0),
      format: data.format?.format_long_name || data.format?.format_name || '',
      tags: data.format?.tags || {},
      streams,
      hdr: detectHdr(streams.video[0])
    };
  } catch {
    return {
      duration: 0,
      size: 0,
      bitrate: 0,
      format: '',
      tags: {},
      streams: { video: [], audio: [], subtitles: [] },
      hdr: null
    };
  }
}

async function generateFrames(movie, cacheDir, ffmpegPath, count = 5) {
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
  const points = [0.08, 0.22, 0.41, 0.63, 0.82].slice(0, count);
  const created = [];
  for (let i = 0; i < points.length; i++) {
    const output = path.join(movieDir, 'frame-' + i + '.jpg');
    try {
      await run(ffmpegPath, [
        '-y',
        '-ss', String(Math.max(2, duration * points[i])),
        '-i', movie.path,
        '-frames:v', '1',
        '-vf', 'scale=1280:-2',
        '-q:v', '3',
        output
      ]);
      created.push(output);
    } catch {}
  }
  return created;
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

function inferSubtitleLanguage(filename) {
  const lower = String(filename || '').toLowerCase();
  const pairs = [
    ['es', ['.es.', '.spa.', '.spanish.', '.latino.', '.castellano.']],
    ['en', ['.en.', '.eng.', '.english.']],
    ['fr', ['.fr.', '.fre.', '.fra.', '.french.']],
    ['de', ['.de.', '.ger.', '.deu.', '.german.']],
    ['it', ['.it.', '.ita.', '.italian.']],
    ['pt', ['.pt.', '.por.', '.portuguese.']],
    ['ja', ['.ja.', '.jpn.', '.japanese.']]
  ];
  for (const [lang, patterns] of pairs) {
    if (patterns.some((p) => lower.includes(p))) return lang;
  }
  return 'und';
}

async function convertExternalSubtitle(subtitle, movieDir, ffmpegPath, index) {
  const out = path.join(movieDir, 'external-sub-' + index + '.vtt');
  if (subtitle.extension === '.vtt') {
    try {
      await fsp.copyFile(subtitle.path, out);
      return out;
    } catch {
      return subtitle.path;
    }
  }
  try {
    await run(ffmpegPath, ['-y', '-i', subtitle.path, '-f', 'webvtt', out]);
    return out;
  } catch {
    return null;
  }
}

async function extractEmbeddedSubtitles(movie, cacheDir, ffmpegPath) {
  const textStreams = (movie.streams?.subtitles || []).filter((s) => s.textBased);
  if (!textStreams.length) return [];
  const movieDir = path.join(cacheDir, movie.id);
  await fsp.mkdir(movieDir, { recursive: true });
  const results = [];
  for (let i = 0; i < textStreams.length; i++) {
    const stream = textStreams[i];
    const output = path.join(movieDir, 'embedded-sub-' + i + '.vtt');
    try {
      await fsp.access(output);
    } catch {
      try {
        await run(ffmpegPath, [
          '-y',
          '-i', movie.path,
          '-map', '0:' + stream.index,
          '-f', 'webvtt',
          output
        ]);
      } catch {
        continue;
      }
    }
    results.push({
      path: output,
      label: stream.title || (stream.language.toUpperCase() + ' · embedded'),
      language: stream.language,
      source: 'embedded',
      codec: stream.codec
    });
  }
  return results;
}

async function prepareSubtitles(movie, cacheDir, ffmpegPath) {
  const movieDir = path.join(cacheDir, movie.id);
  await fsp.mkdir(movieDir, { recursive: true });
  const external = await adjacentSubtitles(movie.path);
  const preparedExternal = [];
  for (let i = 0; i < external.length; i++) {
    const converted = await convertExternalSubtitle(external[i], movieDir, ffmpegPath, i);
    if (!converted) continue;
    preparedExternal.push({
      path: converted,
      originalPath: external[i].path,
      label: external[i].label,
      language: inferSubtitleLanguage('.' + external[i].label.toLowerCase() + '.'),
      source: 'external',
      codec: external[i].extension.replace('.', '')
    });
  }
  const embedded = await extractEmbeddedSubtitles(movie, cacheDir, ffmpegPath);
  return [...preparedExternal, ...embedded];
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
    for (const folder of this.state.folders) all.push(...await walk(folder));
    const unique = [...new Set(all)];
    const previous = new Map((this.state.movies || []).map((movie) => [movie.path.toLowerCase(), movie]));
    const movies = [];
    let done = 0;

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
          favorite: Boolean(this.state.favorites[id]),
          progress: this.state.progress[id] || null
        };
        if (!movie.frames?.length) movie.frames = await generateFrames(movie, this.cacheDir, this.ffmpegPath, 5);
        if (!movie.playableSubtitles) movie.playableSubtitles = await prepareSubtitles(movie, this.cacheDir, this.ffmpegPath);
      } else {
        const info = await probe(filePath, this.ffprobePath);
        movie = {
          id,
          path: filePath,
          title: info.tags?.title || cleanTitle(filePath),
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
          year: detectYear(info.tags?.title || cleanTitle(filePath), path.basename(filePath)),
          favorite: Boolean(this.state.favorites[id]),
          progress: this.state.progress[id] || null,
          frames: [],
          playableSubtitles: []
        };
        movie.frames = await generateFrames(movie, this.cacheDir, this.ffmpegPath, 5);
        movie.playableSubtitles = await prepareSubtitles(movie, this.cacheDir, this.ffmpegPath);
      }

      movies.push(movie);
      done += 1;
      this.onProgress({
        done,
        total: unique.length,
        title: movie.title,
        cached: unchanged
      });
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
