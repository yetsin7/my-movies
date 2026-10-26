'use strict';

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MOVIE_ID_PATTERN = /^[a-f0-9]{40}$/;
const LIMITER = 'alimiter=limit=0.97:level=0';

/**
 * Builds the audio filter that downmixes a track to stereo.
 * FFmpeg's implicit downmix changes level depending on the internal sample format
 * (the default one measured about -26 dB mean on a real movie), so 5.1 and 7.1 use an
 * explicit matrix: centre -3 dB, surrounds -6 dB, low LFE, plus a limiter for peaks.
 * Channel order is FL FR FC LFE then the back/side pairs; stereo and mono pass through.
 * @param {number} channels Channel count of the source track.
 * @returns {string} ffmpeg -af expression.
 */
function buildAudioFilter(channels) {
  if (channels === 6) {
    return `pan=stereo|c0=c0+0.7071*c2+0.5*c4+0.3*c3|c1=c1+0.7071*c2+0.5*c5+0.3*c3,${LIMITER}`;
  }
  if (channels === 8) {
    return `pan=stereo|c0=c0+0.7071*c2+0.35*c4+0.35*c6+0.3*c3|c1=c1+0.7071*c2+0.35*c5+0.35*c7+0.3*c3,${LIMITER}`;
  }
  return 'aformat=channel_layouts=stereo';
}

/**
 * Builds the ffmpeg arguments that decode one audio track and re-encode it as
 * stereo AAC (ADTS) on stdout, starting at the requested position.
 * @param {string} moviePath Absolute path of the movie file.
 * @param {number} trackIndex Zero-based index among the audio streams.
 * @param {number} startSeconds Position to start from.
 * @param {number} [channels] Channel count of the source track.
 * @returns {string[]} ffmpeg arguments.
 */
function buildAudioStreamArgs(moviePath, trackIndex, startSeconds, channels = 2) {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-ss', String(Math.max(0, startSeconds)),
    '-i', moviePath,
    '-map', `0:a:${trackIndex}`,
    '-vn', '-sn', '-dn',
    '-af', buildAudioFilter(channels),
    '-c:a', 'aac', '-b:a', '192k',
    '-f', 'adts', 'pipe:1'
  ];
}

/**
 * Local HTTP server that streams a transcoded audio track for movies whose
 * audio Chromium cannot decode (AC3, E-AC3, DTS...). Audio starts within a
 * second or two instead of waiting for the whole track to be converted.
 * Listens on loopback only and requires a per-run random token.
 * @param {object} options Server options.
 * @param {(id: string) => object|null} options.findMovie Looks a movie up by id.
 * @param {() => string} options.getFfmpegPath Returns the ffmpeg binary path.
 * @returns {{start: Function, urlFor: Function, stop: Function}} Server controller.
 */
function createAudioStreamServer({ findMovie, getFfmpegPath }) {
  const token = crypto.randomBytes(16).toString('hex');
  const children = new Set();
  let server = null;
  let port = 0;

  function validToken(candidate) {
    const expected = Buffer.from(token);
    const received = Buffer.from(String(candidate || ''));
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  function fail(res, status, message) {
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(message);
  }

  function handle(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const match = /^\/audio\/([a-f0-9]{40})\/(\d{1,2})$/.exec(url.pathname);
    if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${port}`) return fail(res, 400, 'Solicitud no válida.');
    if (!match || !validToken(url.searchParams.get('token'))) return fail(res, 403, 'Acceso denegado.');

    const movie = MOVIE_ID_PATTERN.test(match[1]) ? findMovie(match[1]) : null;
    const trackIndex = Number(match[2]);
    if (!movie || trackIndex >= (movie.streams?.audio?.length || 0)) return fail(res, 404, 'Pista no encontrada.');

    const requested = Number(url.searchParams.get('start'));
    const duration = Number(movie.duration) || Infinity;
    const start = Number.isFinite(requested) && requested > 0 ? Math.min(requested, Math.max(0, duration - 1)) : 0;

    const channels = Number(movie.streams.audio[trackIndex].channels) || 2;
    const ffmpeg = spawn(getFfmpegPath(), buildAudioStreamArgs(movie.path, trackIndex, start, channels), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    children.add(ffmpeg);

    let stderr = '';
    let clientGone = false;
    ffmpeg.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    ffmpeg.on('error', (error) => fail(res, 500, `No se pudo iniciar ffmpeg: ${error.message}`));
    ffmpeg.on('close', (code) => {
      children.delete(ffmpeg);
      if (code && !clientGone) console.error(`Audio stream ended with code ${code}: ${stderr.trim()}`);
      res.end();
    });

    res.writeHead(200, { 'Content-Type': 'audio/aac', 'Cache-Control': 'no-store' });
    ffmpeg.stdout.pipe(res);
    res.on('close', () => {
      clientGone = true;
      ffmpeg.kill();
    });
  }

  return {
    /**
     * Starts listening on a random loopback port.
     * @returns {Promise<void>} Resolves once the server accepts connections.
     */
    start() {
      return new Promise((resolve, reject) => {
        server = http.createServer(handle);
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve();
        });
      });
    },

    /**
     * Builds the stream URL for a movie track.
     * @param {string} movieId Movie id.
     * @param {number} trackIndex Zero-based audio stream index.
     * @param {number} startSeconds Position to start from.
     * @returns {string} Loopback URL for the audio element.
     */
    urlFor(movieId, trackIndex, startSeconds) {
      const start = Number.isFinite(startSeconds) && startSeconds > 0 ? startSeconds.toFixed(2) : '0';
      return `http://127.0.0.1:${port}/audio/${movieId}/${trackIndex}?start=${start}&token=${token}`;
    },

    /** Stops the server and kills any running ffmpeg process. */
    stop() {
      for (const child of children) child.kill();
      children.clear();
      server?.close();
      server = null;
    }
  };
}

module.exports = { createAudioStreamServer, buildAudioStreamArgs, buildAudioFilter };
