const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.mov', '.m4v', '.avi', '.webm', '.wmv', '.flv', '.mpeg',
  '.mpg', '.ts', '.m2ts', '.mts', '.ogv'
]);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text']);

/**
 * Executes a binary executable with arguments and returns stdout.
 * @param {string} binary Binary name or absolute path.
 * @param {string[]} args Command arguments.
 * @returns {Promise<string>} Output string.
 */
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

const AUDIO_CODECS_SUPPORTED_BY_CHROMIUM = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const audioCopyPromises = new Map();

function needsAudioTranscode(movie) {
  const audio = movie.streams?.audio || [];
  return audio.length > 0 && audio.some((track) =>
    !AUDIO_CODECS_SUPPORTED_BY_CHROMIUM.has(String(track.codec || '').toLowerCase())
  );
}

async function createAudioCompatibleCopy(movie, trackIndex, cacheDir, ffmpegPath) {
  if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= (movie.streams?.audio?.length || 0)) {
    throw new Error('Pista de audio no válida.');
  }
  const stat = await fsp.stat(movie.path);
  const output = path.join(cacheDir, `${movie.id}-${stat.size}-${Math.floor(stat.mtimeMs)}-${trackIndex}.m4a`);
  if (await fsp.access(output).then(() => true, () => false)) return output;

  let conversion = audioCopyPromises.get(output);
  if (!conversion) {
    conversion = (async () => {
      await fsp.mkdir(cacheDir, { recursive: true });
      const temporary = output.replace(/\.m4a$/, '.tmp.m4a');
      try {
        await run(ffmpegPath, [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-i', movie.path,
          '-map', `0:a:${trackIndex}`,
          '-vn',
          '-c:a', 'aac',
          '-b:a', '256k',
          temporary
        ]);
        await fsp.rename(temporary, output);
      } catch (error) {
        await fsp.unlink(temporary).catch(() => {});
        throw new Error(`No se pudo preparar el audio compatible: ${error.message}`);
      }
    })();
    audioCopyPromises.set(output, conversion);
  }

  try {
    await conversion;
    return output;
  } finally {
    if (audioCopyPromises.get(output) === conversion) audioCopyPromises.delete(output);
  }
}

/**
 * Cleans movie filenames into readable display titles.
 * @param {string} filename File path or file name.
 * @returns {string} Sanitized title.
 */
function cleanTitle(filename) {
  const stem = path.basename(filename, path.extname(filename))
    .replace(/^[\d\s._\-⭐★]+\s*/, '')
    .replace(/\b\d+([.,]\d+)?\s*(gb|mb|gib|mib)\b/gi, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|hdr10\+?|dolby[ ._-]?vision|hdr|bluray|blu-ray|webrip|web-dl|x264|x265|h264|h265|hevc|av1|aac|dts|remux|dual|60fps)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stem || path.basename(filename, path.extname(filename));
}

/**
 * Resolves the cleanest title possible by detecting spam watermark tags.
 * @param {string} tagsTitle Metadata title tag if present.
 * @param {string} filePath Full file path.
 * @returns {string} Best human-readable title.
 */
function resolveTitle(tagsTitle, filePath) {
  const cleanedFile = cleanTitle(filePath);
  if (!tagsTitle) return cleanedFile;

  const isSpamTag = /(www\.|http|\.net|\.com|\.org|\.to|\.mx|aporte|refuleros|gdrive|peliculas|descarga|\bby\b|latino)/i.test(tagsTitle);
  if (isSpamTag) return cleanedFile;

  const cleanedTag = cleanTitle(tagsTitle);
  return cleanedTag || cleanedFile;
}

/**
 * Parses numeric framerate from ffmpeg fraction string.
 * @param {string} value Fraction string like "24000/1001".
 * @returns {number} Floating point frames per second.
 */
function parseFrameRate(value) {
  if (!value || value === '0/0') return 0;
  const [a, b] = String(value).split('/').map(Number);
  if (!Number.isFinite(a)) return 0;
  return b ? a / b : a;
}

/**
 * Normalizes language codes to lower-case.
 * @param {string} value Language string.
 * @returns {string} Normalized language.
 */
function normalizeLanguage(value) {
  return String(value || 'und').toLowerCase();
}

/**
 * Summarizes audio, video, and subtitle streams from ffprobe.
 * @param {Array} streams List of raw stream metadata.
 * @returns {object} Summarized stream groups.
 */
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

/**
 * Determines HDR color profile from color transfer and primaries.
 * @param {object} video Video stream object.
 * @returns {string|null} HDR label if present.
 */
function detectHdr(video) {
  if (!video) return null;
  const transfer = String(video.colorTransfer || '').toLowerCase();
  const primaries = String(video.colorPrimaries || '').toLowerCase();
  if (transfer.includes('smpte2084')) return 'HDR10';
  if (transfer.includes('arib-std-b67')) return 'HLG';
  if (primaries.includes('bt2020')) return 'HDR';
  return null;
}

/**
 * Extracts 4-digit release year from title or raw filename.
 * @param {string} title Cleaned or tag title.
 * @param {string} filename Original filename.
 * @returns {number|null} Year.
 */
function detectYear(title, filename) {
  const source = String(title || '') + ' ' + String(filename || '');
  const years = [...source.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
  return years.length ? years[years.length - 1] : null;
}

/**
 * Probes media file metadata using ffprobe.
 * @param {string} filePath Path to media file.
 * @param {string} ffprobePath Path to ffprobe binary.
 * @returns {Promise<object>} File metadata.
 */
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

const FRAME_VERSION = 2;
const FRAME_CANDIDATE_COUNT = 12;
const FRAME_TARGET_LUMA = 110;
const FRAME_MIN_LUMA = 30;
const FRAME_MAX_LUMA = 215;

/**
 * Measures the average luma (0-255) of an image with FFmpeg's signalstats filter.
 * @param {string} imagePath Image file path.
 * @param {string} ffmpegPath Path to ffmpeg binary.
 * @returns {Promise<number|null>} Average luma, or null when it could not be measured.
 */
function measureLuma(imagePath, ffmpegPath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, [
      '-hide_banner',
      '-i', imagePath,
      '-vf', 'signalstats,metadata=mode=print',
      '-f', 'null', '-'
    ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_error, _stdout, stderr) => {
      const match = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(stderr || '');
      resolve(match ? Number(match[1]) : null);
    });
  });
}

/**
 * Generates thumbnail frames for cinematic hover preview.
 * @param {object} movie Movie object.
 * @param {string} cacheDir Cache directory path.
 * @param {string} ffmpegPath Path to ffmpeg binary.
 * @param {number} count Number of frames to extract.
 * @returns {Promise<string[]>} Array of frame file paths.
 */
async function generateFrames(movie, cacheDir, ffmpegPath, count = 5) {
  const movieDir = path.join(cacheDir, movie.id);
  await fsp.mkdir(movieDir, { recursive: true });
  const finalPaths = Array.from({ length: count }, (_, i) => path.join(movieDir, 'best-' + i + '.jpg'));
  const existing = await Promise.all(finalPaths.map((p) => fsp.access(p).then(() => true, () => false)));
  if (existing.every(Boolean)) return finalPaths;

  // Sample more candidates than needed, then keep the best one from each segment of the timeline.
  const duration = Math.max(movie.duration || 0, 1);
  const candidates = [];
  for (let i = 0; i < FRAME_CANDIDATE_COUNT; i++) {
    const ratio = 0.05 + (0.9 * i) / (FRAME_CANDIDATE_COUNT - 1);
    const output = path.join(movieDir, 'candidate-' + i + '.jpg');
    try {
      await run(ffmpegPath, [
        '-y',
        '-ss', String(Math.max(2, duration * ratio)),
        '-i', movie.path,
        '-frames:v', '1',
        '-vf', 'scale=1280:-2',
        '-q:v', '3',
        output
      ]);
    } catch {
      continue;
    }
    candidates.push({ output, luma: await measureLuma(output, ffmpegPath) });
  }

  const created = [];
  for (let segment = 0; segment < count; segment++) {
    const start = Math.floor((segment * candidates.length) / count);
    const end = Math.floor(((segment + 1) * candidates.length) / count);
    const pool = candidates.slice(start, end);
    if (!pool.length) continue;
    const usable = pool.filter((c) => c.luma !== null && c.luma >= FRAME_MIN_LUMA && c.luma <= FRAME_MAX_LUMA);
    const lumaDistance = (c) => Math.abs((c.luma ?? FRAME_TARGET_LUMA) - FRAME_TARGET_LUMA);
    const best = (usable.length ? usable : pool).reduce((a, b) => (lumaDistance(b) < lumaDistance(a) ? b : a));
    await fsp.copyFile(best.output, finalPaths[segment]);
    created.push(finalPaths[segment]);
  }
  await Promise.all(candidates.map((c) => fsp.unlink(c.output).catch(() => {})));
  return created;
}

/**
 * Finds external subtitles located in the same directory.
 * @param {string} videoPath Path to video file.
 * @returns {Promise<Array>} List of subtitle descriptors.
 */
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

/**
 * Infers language code from subtitle filename patterns.
 * @param {string} filename Subtitle file name.
 * @returns {string} Language code.
 */
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

/**
 * Converts external subtitle to WebVTT format for browser player.
 * @param {object} subtitle External subtitle descriptor.
 * @param {string} movieDir Movie cache directory.
 * @param {string} ffmpegPath Path to ffmpeg binary.
 * @param {number} index Subtitle index.
 * @returns {Promise<string|null>} Path to converted file.
 */
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

/**
 * Extracts embedded text subtitles to WebVTT.
 * @param {object} movie Movie object.
 * @param {string} cacheDir Cache directory path.
 * @param {string} ffmpegPath Path to ffmpeg binary.
 * @returns {Promise<Array>} Extracted subtitle list.
 */
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

/**
 * Prepares all playable subtitles for a given movie.
 * @param {object} movie Movie object.
 * @param {string} cacheDir Cache directory path.
 * @param {string} ffmpegPath Path to ffmpeg binary.
 * @returns {Promise<Array>} List of playable WebVTT subtitles.
 */
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

module.exports = {
  VIDEO_EXTENSIONS,
  FRAME_VERSION,
SUBTITLE_EXTENSIONS,
  cleanTitle,
  resolveTitle,
  detectYear,
  detectHdr,
  probe,
  needsAudioTranscode,
  createAudioCompatibleCopy,
  generateFrames,
  prepareSubtitles
};
