/**
 * Localization module for My Movies application.
 * Supports Spanish (default) and English with natural phrasing.
 */

const DICTIONARIES = {
  es: {
    // Player controls & context menu
    play: 'Reproducir',
    pause: 'Pausar',
    rewind10: 'Retroceder 10 s',
    forward10: 'Adelantar 10 s',
    audioTracks: 'Pistas de audio',
    audioTrackNumber: 'Pista {number}',
    noAudioTracks: 'Sin pistas adicionales',
    subtitles: 'Subtítulos',
    subtitlesOff: 'Desactivados',
    noSubtitles: 'Sin subtítulos disponibles',
    playbackSpeed: 'Velocidad de reproducción',
    normalSpeed: 'Normal (1.0x)',
    aspectRatio: 'Ajuste de pantalla',
    aspectContain: 'Ajustar (Original)',
    aspectCover: 'Rellenar pantalla (Zoom)',
    aspectFill: 'Estirar a pantalla completa',
    pictureInPicture: 'Ventana flotante (PiP)',
    fullscreen: 'Pantalla completa',
    exitFullscreen: 'Salir de pantalla completa',
    mute: 'Silenciar',
    unmute: 'Activar sonido',
    exitPlayer: 'Cerrar reproductor',
    spaceShortcut: 'Espacio',
    fShortcut: 'F',
    escShortcut: 'Esc',
    doubleClickShortcut: 'Doble clic',

    // Language names
    lang_es: 'Español',
    lang_en: 'Inglés',
    lang_fr: 'Francés',
    lang_de: 'Alemán',
    lang_it: 'Italiano',
    lang_pt: 'Portugués',
    lang_ja: 'Japonés',
    lang_zh: 'Chino',
    lang_ru: 'Ruso',
    lang_ko: 'Coreano',
    lang_und: 'Sin idioma'
  },
  en: {
    // Player controls & context menu
    play: 'Play',
    pause: 'Pause',
    rewind10: 'Rewind 10s',
    forward10: 'Forward 10s',
    audioTracks: 'Audio tracks',
    audioTrackNumber: 'Track {number}',
    noAudioTracks: 'No additional audio tracks',
    subtitles: 'Subtitles',
    subtitlesOff: 'Off',
    noSubtitles: 'No subtitles available',
    playbackSpeed: 'Playback speed',
    normalSpeed: 'Normal (1.0x)',
    aspectRatio: 'Aspect ratio',
    aspectContain: 'Fit (Original)',
    aspectCover: 'Fill screen (Crop)',
    aspectFill: 'Stretch to screen',
    pictureInPicture: 'Picture in Picture',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    mute: 'Mute',
    unmute: 'Unmute',
    exitPlayer: 'Close player',
    spaceShortcut: 'Space',
    fShortcut: 'F',
    escShortcut: 'Esc',
    doubleClickShortcut: 'Double click',

    // Language names
    lang_es: 'Spanish',
    lang_en: 'English',
    lang_fr: 'French',
    lang_de: 'German',
    lang_it: 'Italian',
    lang_pt: 'Portuguese',
    lang_ja: 'Japanese',
    lang_zh: 'Chinese',
    lang_ru: 'Russian',
    lang_ko: 'Korean',
    lang_und: 'Unknown language'
  }
};

let currentLocale = 'es';

// Auto-detect browser/system language if English
if (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('en')) {
  currentLocale = 'en';
}

/**
 * Returns translated string for given key.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
function t(key, params = {}) {
  const dict = DICTIONARIES[currentLocale] || DICTIONARIES.es;
  let text = dict[key] || DICTIONARIES.es[key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return text;
}

/**
 * Returns natural localized name for language code.
 * @param {string} code
 * @returns {string}
 */
function humanLanguage(code) {
  const normalized = String(code || 'und').toLowerCase();
  const aliasMap = { spa: 'es', eng: 'en', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', por: 'pt', jpn: 'ja', zho: 'zh', chi: 'zh', rus: 'ru', kor: 'ko' };
  const key = `lang_${aliasMap[normalized] || normalized}`;
  const dict = DICTIONARIES[currentLocale] || DICTIONARIES.es;
  return dict[key] || DICTIONARIES.es[key] || normalized.toUpperCase();
}

/**
 * Get current active locale.
 * @returns {string}
 */
function getLocale() {
  return currentLocale;
}

/**
 * Set current active locale.
 * @param {'es'|'en'} locale
 */
function setLocale(locale) {
  if (DICTIONARIES[locale]) {
    currentLocale = locale;
  }
}

const I18n = { t, humanLanguage, getLocale, setLocale };

if (typeof window !== 'undefined') {
  window.I18n = I18n;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = I18n;
}
