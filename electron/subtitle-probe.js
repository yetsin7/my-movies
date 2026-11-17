const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text']);

/**
 * Runs a binary with arguments returning a promise.
 * @param {string} binary
 * @param {string[]} args
 * @returns {Promise<string>}
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
  SUBTITLE_EXTENSIONS,
  TEXT_SUBTITLE_CODECS,
  adjacentSubtitles,
  inferSubtitleLanguage,
  convertExternalSubtitle,
  extractEmbeddedSubtitles,
  prepareSubtitles
};
