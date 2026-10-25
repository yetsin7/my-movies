const state = {
  folders: [],
  movies: [],
  currentView: 'home',
  query: '',
  hero: null,
  details: null,
  activeMovie: null,
  previewTimers: new Map()
};

const $ = (id) => document.getElementById(id);
const emptyState = $('emptyState');
const libraryView = $('libraryView');
const rows = $('rows');
const heroBackdrop = $('heroBackdrop');
const heroTitle = $('heroTitle');
const heroMeta = $('heroMeta');
const detailsDialog = $('detailsDialog');
const playerOverlay = $('playerOverlay');
const videoPlayer = $('videoPlayer');
const subtitleSelect = $('subtitleSelect');

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + s : m + ':' + s;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B','KB','MB','GB','TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return n.toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

function resolution(movie) {
  const v = movie.streams?.video?.[0];
  if (!v?.height) return '';
  if (v.height >= 2100) return '4K';
  if (v.height >= 1000) return '1080p';
  if (v.height >= 700) return '720p';
  return v.height + 'p';
}

function meta(movie) {
  return [formatTime(movie.duration), resolution(movie), movie.extension?.replace('.', '').toUpperCase()]
    .filter(Boolean).join('  •  ');
}

function img(movie, index = 0) {
  return movie.frames?.[index] || '';
}

function setData(next) {
  state.folders = next.folders || [];
  state.movies = next.movies || [];
  render();
}

function filteredMovies() {
  let items = [...state.movies];
  if (state.currentView === 'favorites') items = items.filter((m) => m.favorite);
  if (state.currentView === 'recent') items.sort((a,b) => b.modifiedAt - a.modifiedAt);
  if (state.query) {
    const q = state.query.toLowerCase();
    items = items.filter((m) => (m.title + ' ' + m.filename + ' ' + m.folder).toLowerCase().includes(q));
  }
  return items;
}

function render() {
  const hasLibrary = state.folders.length > 0;
  emptyState.classList.toggle('hidden', hasLibrary);
  libraryView.classList.toggle('hidden', !hasLibrary);
  if (!hasLibrary) return;

  const items = filteredMovies();
  state.hero = items[0] || state.movies[0] || null;
  renderHero(state.hero);

  rows.innerHTML = '';
  if (!items.length) {
    rows.innerHTML = '<div style="padding:120px 4vw;color:#aaa"><h2>No hay títulos aquí.</h2><p>Prueba otra vista, otra búsqueda o vuelve a analizar tus carpetas.</p></div>';
    return;
  }

  const continueWatching = items.filter((m) => m.progress?.seconds > 30 && m.progress.seconds < (m.duration || Infinity) * .95);
  const favorites = items.filter((m) => m.favorite);
  const long = items.filter((m) => m.duration >= 5400);
  const recent = [...items].sort((a,b) => b.modifiedAt - a.modifiedAt).slice(0, 24);

  const groups = [];
  if (continueWatching.length) groups.push(['Continuar viendo', continueWatching]);
  if (state.currentView === 'home' && recent.length) groups.push(['Agregadas recientemente', recent]);
  if (favorites.length && state.currentView === 'home') groups.push(['Mi lista', favorites]);
  groups.push([state.query ? 'Resultados' : 'Todas tus películas', items]);
  if (long.length > 3 && state.currentView === 'home') groups.push(['Para una noche de cine', long]);

  const seen = new Set();
  groups.forEach(([title, movies]) => {
    const key = title + ':' + movies.map((m) => m.id).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    rows.appendChild(makeRow(title, movies));
  });
}

function renderHero(movie) {
  if (!movie) {
    heroTitle.textContent = 'Tu biblioteca';
    heroMeta.textContent = 'Añade películas para comenzar.';
    heroBackdrop.style.backgroundImage = '';
    return;
  }
  heroTitle.textContent = movie.title;
  heroMeta.textContent = meta(movie);
  const frame = img(movie, 1) || img(movie, 0);
  heroBackdrop.style.backgroundImage = frame ? 'url("' + frame + '")' : 'linear-gradient(135deg,#451111,#111)';
}

function makeRow(title, movies) {
  const section = document.createElement('section');
  section.className = 'row';
  section.innerHTML = '<div class="row-header"><h2>' + escapeHtml(title) + '</h2><span style="color:#777">' + movies.length + '</span></div>';
  const rail = document.createElement('div');
  rail.className = 'rail';
  movies.forEach((movie) => rail.appendChild(makeCard(movie)));
  section.appendChild(rail);
  return section;
}

function makeCard(movie) {
  const card = document.createElement('article');
  card.className = 'movie-card';
  card.tabIndex = 0;
  const image = document.createElement('img');
  image.src = img(movie, 0);
  image.alt = movie.title;
  image.loading = 'lazy';
  card.appendChild(image);

  const gradient = document.createElement('div');
  gradient.className = 'card-gradient';
  card.appendChild(gradient);

  const info = document.createElement('div');
  info.className = 'card-info';
  info.innerHTML = '<div class="card-title">' + escapeHtml(movie.title) + '</div><div class="card-meta">' + escapeHtml(meta(movie)) + '</div>';
  card.appendChild(info);

  if (movie.progress?.duration) {
    const p = Math.max(0, Math.min(100, (movie.progress.seconds / movie.progress.duration) * 100));
    const progress = document.createElement('div');
    progress.className = 'progress';
    progress.innerHTML = '<span style="width:' + p + '%"></span>';
    card.appendChild(progress);
  }

  card.addEventListener('click', () => openDetails(movie));
  card.addEventListener('dblclick', () => playMovie(movie));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openDetails(movie);
  });

  let frameIndex = 0;
  card.addEventListener('mouseenter', () => {
    if (!movie.frames?.length) return;
    const timer = setInterval(() => {
      frameIndex = (frameIndex + 1) % movie.frames.length;
      image.src = movie.frames[frameIndex];
    }, 900);
    state.previewTimers.set(movie.id, timer);
  });
  card.addEventListener('mouseleave', () => {
    clearInterval(state.previewTimers.get(movie.id));
    state.previewTimers.delete(movie.id);
    image.src = img(movie, 0);
  });

  return card;
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function openDetails(movie) {
  state.details = movie;
  $('detailsTitle').textContent = movie.title;
  $('detailsMeta').textContent = meta(movie) + (movie.size ? '  •  ' + formatBytes(movie.size) : '');
  $('detailsPath').textContent = movie.path;
  $('detailsBackdrop').style.backgroundImage = img(movie, 2) ? 'url("' + img(movie, 2) + '")' : '';
  $('audioInfo').textContent = movie.streams?.audio?.length
    ? movie.streams.audio.map((a, i) => (i + 1) + '. ' + (a.language || 'und').toUpperCase() + ' · ' + a.codec + (a.layout ? ' · ' + a.layout : '')).join('\n')
    : 'No se detectaron pistas';
  const embedded = movie.streams?.subtitles || [];
  const external = movie.externalSubtitles || [];
  $('subtitleInfo').textContent = (embedded.length + external.length)
    ? [
        ...embedded.map((s) => (s.language || 'und').toUpperCase() + ' · ' + s.codec),
        ...external.map((s) => s.label)
      ].join('\n')
    : 'Sin subtítulos detectados';
  $('formatInfo').textContent = movie.format || movie.extension;
  $('favoriteButton').textContent = movie.favorite ? '✓' : '＋';
  detailsDialog.showModal();
}

async function playMovie(movie) {
  state.activeMovie = movie;
  detailsDialog.close();
  $('playerTitle').textContent = movie.title;
  videoPlayer.src = movie.mediaUrl;
  playerOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  await prepareSubtitles(movie);
  videoPlayer.addEventListener('loadedmetadata', resumeOnce, { once: true });
  try { await videoPlayer.play(); } catch {}
  updatePlayIcon();
}

function resumeOnce() {
  const p = state.activeMovie?.progress;
  if (p?.seconds && p.seconds < videoPlayer.duration * .95) {
    videoPlayer.currentTime = p.seconds;
  }
}

async function prepareSubtitles(movie) {
  [...videoPlayer.querySelectorAll('track')].forEach((t) => t.remove());
  subtitleSelect.innerHTML = '<option value="">Subtítulos: desactivados</option>';
  (movie.externalSubtitles || []).forEach((sub, index) => {
    if (sub.extension !== '.vtt') return;
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.label;
    track.srclang = 'und';
    track.src = sub.url;
    videoPlayer.appendChild(track);
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = sub.label;
    subtitleSelect.appendChild(option);
  });
}

function closePlayer() {
  if (!state.activeMovie) return;
  saveProgress();
  videoPlayer.pause();
  videoPlayer.removeAttribute('src');
  videoPlayer.load();
  playerOverlay.classList.add('hidden');
  document.body.style.overflow = '';
  state.activeMovie = null;
  render();
}

function saveProgress() {
  if (!state.activeMovie || !Number.isFinite(videoPlayer.currentTime)) return;
  window.myMovies.setProgress(state.activeMovie.id, videoPlayer.currentTime, videoPlayer.duration || state.activeMovie.duration);
  state.activeMovie.progress = { seconds: videoPlayer.currentTime, duration: videoPlayer.duration || state.activeMovie.duration };
}

function updatePlayIcon() {
  $('playPause').textContent = videoPlayer.paused ? '▶' : '❚❚';
}

function updateTime() {
  if (!Number.isFinite(videoPlayer.duration) || !videoPlayer.duration) return;
  $('seekBar').value = String((videoPlayer.currentTime / videoPlayer.duration) * 1000);
  $('timeLabel').textContent = formatTime(videoPlayer.currentTime) + ' / ' + formatTime(videoPlayer.duration);
}

$('libraryButton').addEventListener('click', async () => setData(await window.myMovies.chooseLibrary()));
$('emptyLibraryButton').addEventListener('click', async () => setData(await window.myMovies.chooseLibrary()));
$('rescanButton').addEventListener('click', async () => setData(await window.myMovies.rescan()));
$('searchInput').addEventListener('input', (e) => { state.query = e.target.value.trim(); render(); });
document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-link').forEach((b) => b.classList.remove('active'));
  button.classList.add('active');
  state.currentView = button.dataset.view;
  render();
}));
$('heroPlay').addEventListener('click', () => state.hero && playMovie(state.hero));
$('heroInfo').addEventListener('click', () => state.hero && openDetails(state.hero));
$('detailsPlay').addEventListener('click', () => state.details && playMovie(state.details));
$('favoriteButton').addEventListener('click', async () => {
  if (!state.details) return;
  const result = await window.myMovies.toggleFavorite(state.details.id);
  state.details.favorite = result.favorite;
  $('favoriteButton').textContent = result.favorite ? '✓' : '＋';
});
$('revealButton').addEventListener('click', () => state.details && window.myMovies.revealFile(state.details.id));
document.querySelector('[data-close-dialog]').addEventListener('click', () => detailsDialog.close());

$('playerClose').addEventListener('click', closePlayer);
$('playPause').addEventListener('click', () => videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause());
$('backTen').addEventListener('click', () => videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10));
$('forwardTen').addEventListener('click', () => videoPlayer.currentTime = Math.min(videoPlayer.duration || Infinity, videoPlayer.currentTime + 10));
$('muteButton').addEventListener('click', () => {
  videoPlayer.muted = !videoPlayer.muted;
  $('muteButton').textContent = videoPlayer.muted ? '🔇' : '🔊';
});
$('fullscreenButton').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : playerOverlay.requestFullscreen());
$('seekBar').addEventListener('input', (e) => {
  if (videoPlayer.duration) videoPlayer.currentTime = (Number(e.target.value) / 1000) * videoPlayer.duration;
});
subtitleSelect.addEventListener('change', () => {
  const tracks = videoPlayer.textTracks;
  for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
  if (subtitleSelect.value !== '') {
    const index = Number(subtitleSelect.value);
    if (tracks[index]) tracks[index].mode = 'showing';
  }
});
$('subtitleButton').addEventListener('click', () => subtitleSelect.focus());

videoPlayer.addEventListener('play', updatePlayIcon);
videoPlayer.addEventListener('pause', updatePlayIcon);
videoPlayer.addEventListener('timeupdate', updateTime);
videoPlayer.addEventListener('ended', saveProgress);
setInterval(() => { if (state.activeMovie && !videoPlayer.paused) saveProgress(); }, 10000);

let hideControlsTimer;
playerOverlay.addEventListener('mousemove', () => {
  playerOverlay.classList.remove('controls-hidden');
  clearTimeout(hideControlsTimer);
  hideControlsTimer = setTimeout(() => {
    if (!videoPlayer.paused) playerOverlay.classList.add('controls-hidden');
  }, 2600);
});

document.addEventListener('keydown', (e) => {
  if (playerOverlay.classList.contains('hidden')) return;
  if (e.key === 'Escape' && !document.fullscreenElement) closePlayer();
  if (e.code === 'Space') {
    e.preventDefault();
    videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
  }
  if (e.key === 'ArrowLeft') videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10);
  if (e.key === 'ArrowRight') videoPlayer.currentTime = Math.min(videoPlayer.duration || Infinity, videoPlayer.currentTime + 10);
});

window.myMovies.onScanProgress((p) => {
  const status = $('scanStatus');
  status.classList.remove('hidden');
  status.textContent = p.complete ? 'Biblioteca actualizada' : 'Analizando ' + p.done + ' / ' + p.total + (p.title ? ' · ' + p.title : '');
  if (p.complete) setTimeout(() => status.classList.add('hidden'), 1800);
});

window.myMovies.getState().then(setData);
