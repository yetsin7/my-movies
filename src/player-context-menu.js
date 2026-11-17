/**
 * Player Context Menu Component
 * Provides a cinematic dark-themed context menu for the video player with
 * audio track selection, subtitles, playback speed, aspect ratio, and controls.
 */

(function () {
  'use strict';

  let activeMenuEl = null;
  let clickOutsideHandler = null;
  let keydownHandler = null;

  function loc(key, params) {
    if (typeof window !== 'undefined' && window.I18n && typeof window.I18n.t === 'function') {
      return window.I18n.t(key, params);
    }
    return key;
  }

  function locLang(code) {
    if (typeof window !== 'undefined' && window.I18n && typeof window.I18n.humanLanguage === 'function') {
      return window.I18n.humanLanguage(code);
    }
    return String(code || 'und').toUpperCase();
  }

  function close() {
    if (activeMenuEl) {
      activeMenuEl.remove();
      activeMenuEl = null;
    }
    if (clickOutsideHandler) {
      document.removeEventListener('pointerdown', clickOutsideHandler, true);
      clickOutsideHandler = null;
    }
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }
  }

  function isOpen() {
    return Boolean(activeMenuEl && document.body.contains(activeMenuEl));
  }

  function createMenuItem(options) {
    if (options.separator) {
      const sep = document.createElement('li');
      sep.className = 'context-menu-separator';
      sep.setAttribute('role', 'separator');
      return sep;
    }

    const item = document.createElement('li');
    item.className = 'context-menu-item';
    item.setAttribute('role', 'menuitem');
    if (options.disabled) {
      item.classList.add('disabled');
      item.setAttribute('aria-disabled', 'true');
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = 'context-menu-icon';
    iconSpan.textContent = options.icon || '';
    item.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'context-menu-label';
    labelSpan.textContent = options.label || '';
    item.appendChild(labelSpan);

    if (options.checked) {
      const checkSpan = document.createElement('span');
      checkSpan.className = 'context-menu-check';
      checkSpan.textContent = '✓';
      item.appendChild(checkSpan);
    } else if (options.hasCheckPlaceholder) {
      const placeholder = document.createElement('span');
      placeholder.className = 'context-menu-check';
      item.appendChild(placeholder);
    }

    if (options.shortcut) {
      const shortcutSpan = document.createElement('span');
      shortcutSpan.className = 'context-menu-shortcut';
      shortcutSpan.textContent = options.shortcut;
      item.appendChild(shortcutSpan);
    }

    if (options.submenu) {
      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'context-menu-arrow';
      arrowSpan.textContent = '▶';
      item.appendChild(arrowSpan);

      const submenuList = document.createElement('ul');
      submenuList.className = 'context-submenu';
      submenuList.setAttribute('role', 'menu');
      options.submenu.forEach((subOption) => submenuList.appendChild(createMenuItem(subOption)));
      item.appendChild(submenuList);

      item.addEventListener('mouseenter', () => adjustSubmenuPosition(submenuList, item));
    }

    if (options.onClick && !options.disabled && !options.submenu) {
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        close();
        options.onClick();
      });
    }

    return item;
  }

  function adjustSubmenuPosition(submenu, parentItem) {
    submenu.classList.remove('open-left', 'open-up');
    const rect = submenu.getBoundingClientRect();
    const parentRect = parentItem.getBoundingClientRect();
    if (parentRect.right + rect.width > window.innerWidth - 10) submenu.classList.add('open-left');
    if (parentRect.top + rect.height > window.innerHeight - 10) submenu.classList.add('open-up');
  }

  function buildAudioSubmenu(movie, videoPlayer, isExternalAudio, selectedAudioTrack, onSelectAudio) {
    const audioStreams = movie?.streams?.audio || [];
    if (!audioStreams.length) {
      return [{ label: loc('noAudioTracks'), disabled: true, hasCheckPlaceholder: true }];
    }
    return audioStreams.map((stream, idx) => {
      const lang = locLang(stream.language);
      const codec = stream.codec ? ` · ${stream.codec.toUpperCase()}` : '';
      const layout = stream.layout ? ` (${stream.layout})` : '';
      const isChecked = isExternalAudio
        ? idx === selectedAudioTrack
        : (videoPlayer?.audioTracks?.length ? Boolean(videoPlayer.audioTracks[idx]?.enabled) : idx === selectedAudioTrack);
      return {
        label: `${loc('audioTrackNumber', { number: idx + 1 })}: ${lang}${codec}${layout}`,
        checked: isChecked,
        hasCheckPlaceholder: true,
        onClick: () => onSelectAudio && onSelectAudio(idx)
      };
    });
  }

  function buildSubtitleSubmenu(movie, videoPlayer, onSelectSubtitle) {
    const subtitles = movie?.playableSubtitles || [];
    const textTracks = videoPlayer?.textTracks || [];
    let hasActive = false;
    for (let i = 0; i < textTracks.length; i++) {
      if (textTracks[i].mode === 'showing') {
        hasActive = true;
        break;
      }
    }
    const result = [{
      label: loc('subtitlesOff'),
      checked: !hasActive,
      hasCheckPlaceholder: true,
      onClick: () => onSelectSubtitle && onSelectSubtitle(-1)
    }];

    if (!subtitles.length) {
      result.push({ label: loc('noSubtitles'), disabled: true, hasCheckPlaceholder: true });
      return result;
    }

    subtitles.forEach((sub, idx) => {
      const lang = locLang(sub.language);
      const isChecked = Boolean(textTracks[idx] && textTracks[idx].mode === 'showing');
      result.push({
        label: sub.label ? `${lang} · ${sub.label}` : lang,
        checked: isChecked,
        hasCheckPlaceholder: true,
        onClick: () => onSelectSubtitle && onSelectSubtitle(idx)
      });
    });
    return result;
  }

  function buildSpeedSubmenu(videoPlayer, onSetPlaybackRate) {
    const currentRate = videoPlayer ? videoPlayer.playbackRate : 1.0;
    return [0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((speed) => ({
      label: speed === 1.0 ? loc('normalSpeed') : `${speed}x`,
      checked: Math.abs(currentRate - speed) < 0.05,
      hasCheckPlaceholder: true,
      onClick: () => onSetPlaybackRate && onSetPlaybackRate(speed)
    }));
  }

  function buildAspectSubmenu(videoPlayer, onSetAspectRatio) {
    const fit = videoPlayer?.style?.objectFit || 'contain';
    return [
      { label: loc('aspectContain'), mode: 'contain' },
      { label: loc('aspectCover'), mode: 'cover' },
      { label: loc('aspectFill'), mode: 'fill' }
    ].map((item) => ({
      label: item.label,
      checked: fit === item.mode,
      hasCheckPlaceholder: true,
      onClick: () => onSetAspectRatio && onSetAspectRatio(item.mode)
    }));
  }

  function show(cfg) {
    close();
    const menuEl = document.createElement('div');
    menuEl.className = 'player-context-menu';
    menuEl.setAttribute('role', 'menu');

    const listEl = document.createElement('ul');
    listEl.className = 'context-menu-list';

    const isPaused = cfg.videoPlayer ? cfg.videoPlayer.paused : true;
    listEl.appendChild(createMenuItem({
      icon: isPaused ? '▶' : '❚❚',
      label: isPaused ? loc('play') : loc('pause'),
      shortcut: loc('spaceShortcut'),
      onClick: cfg.onTogglePlay
    }));

    listEl.appendChild(createMenuItem({ separator: true }));

    listEl.appendChild(createMenuItem({
      icon: '🔊',
      label: loc('audioTracks'),
      submenu: buildAudioSubmenu(cfg.movie, cfg.videoPlayer, cfg.isExternalAudio, cfg.selectedAudioTrack, cfg.onSelectAudio)
    }));

    listEl.appendChild(createMenuItem({
      icon: '💬',
      label: loc('subtitles'),
      submenu: buildSubtitleSubmenu(cfg.movie, cfg.videoPlayer, cfg.onSelectSubtitle)
    }));

    listEl.appendChild(createMenuItem({ separator: true }));

    listEl.appendChild(createMenuItem({
      icon: '⚡',
      label: loc('playbackSpeed'),
      submenu: buildSpeedSubmenu(cfg.videoPlayer, cfg.onSetPlaybackRate)
    }));

    listEl.appendChild(createMenuItem({
      icon: '📐',
      label: loc('aspectRatio'),
      submenu: buildAspectSubmenu(cfg.videoPlayer, cfg.onSetAspectRatio)
    }));

    listEl.appendChild(createMenuItem({ separator: true }));

    listEl.appendChild(createMenuItem({ icon: '↶', label: loc('rewind10'), shortcut: '←', onClick: () => cfg.onSeekBy && cfg.onSeekBy(-10) }));
    listEl.appendChild(createMenuItem({ icon: '↷', label: loc('forward10'), shortcut: '→', onClick: () => cfg.onSeekBy && cfg.onSeekBy(10) }));

    listEl.appendChild(createMenuItem({ separator: true }));

    const isFullscreen = Boolean(document.fullscreenElement);
    listEl.appendChild(createMenuItem({
      icon: '⛶',
      label: isFullscreen ? loc('exitFullscreen') : loc('fullscreen'),
      shortcut: `${loc('fShortcut')} / ${loc('doubleClickShortcut')}`,
      onClick: cfg.onToggleFullscreen
    }));

    if (document.pictureInPictureEnabled) {
      listEl.appendChild(createMenuItem({
        icon: '🗗',
        label: loc('pictureInPicture'),
        checked: Boolean(document.pictureInPictureElement),
        hasCheckPlaceholder: true,
        onClick: cfg.onTogglePiP
      }));
    }

    const isMuted = cfg.videoPlayer ? cfg.videoPlayer.muted : false;
    listEl.appendChild(createMenuItem({
      icon: isMuted ? '🔊' : '🔇',
      label: isMuted ? loc('unmute') : loc('mute'),
      onClick: cfg.onToggleMute
    }));

    listEl.appendChild(createMenuItem({ separator: true }));

    listEl.appendChild(createMenuItem({
      icon: '✕',
      label: loc('exitPlayer'),
      shortcut: loc('escShortcut'),
      onClick: cfg.onClosePlayer
    }));

    menuEl.appendChild(listEl);
    document.body.appendChild(menuEl);
    activeMenuEl = menuEl;

    const rect = menuEl.getBoundingClientRect();
    const margin = 8;
    let posX = cfg.x;
    let posY = cfg.y;

    if (posX + rect.width > window.innerWidth - margin) posX = Math.max(margin, window.innerWidth - rect.width - margin);
    if (posY + rect.height > window.innerHeight - margin) posY = Math.max(margin, window.innerHeight - rect.height - margin);

    menuEl.style.left = `${Math.round(posX)}px`;
    menuEl.style.top = `${Math.round(posY)}px`;

    clickOutsideHandler = (event) => {
      if (!menuEl.contains(event.target)) close();
    };
    setTimeout(() => document.addEventListener('pointerdown', clickOutsideHandler, true), 10);

    keydownHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', keydownHandler, true);
  }

  const PlayerContextMenu = { show, close, isOpen };

  if (typeof window !== 'undefined') window.PlayerContextMenu = PlayerContextMenu;
  if (typeof module !== 'undefined' && module.exports) module.exports = PlayerContextMenu;
})();
