/**
 * Player Engine — Digital Signage
 * Controla la reproducción de video/imagen, transiciones y UI del HUD.
 * Diseñado para Smart TVs (LG WebOS, Samsung Tizen, navegadores modernos).
 */

(function () {
  'use strict';

  // ============================================================
  // DOM References
  // ============================================================
  const playerContainer = document.getElementById('player-container');
  const splashScreen = document.getElementById('splash-screen');
  const loadingBar = document.getElementById('loading-bar');
  const loadingText = document.getElementById('loading-text');
  const clockDisplay = document.getElementById('clock-display');
  const clockTime = document.querySelector('.clock-time');
  const clockDate = document.querySelector('.clock-date');
  const connectionStatus = document.getElementById('connection-status');
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.getElementById('status-text');
  const playlistIndicator = document.getElementById('playlist-indicator');
  const imageProgress = document.getElementById('image-progress-bar');
  const errorOverlay = document.getElementById('error-overlay');
  const errorMsg = document.getElementById('error-msg');
  const offlineBanner = document.getElementById('offline-banner');

  // ============================================================
  // State
  // ============================================================
  let playlist = null;
  let isPlaying = false;
  let imageTimeout = null;
  let currentMediaElement = null;
  let clockInterval = null;
  let hudTimeout = null;
  let retryCount = 0;
  const MAX_RETRIES = 5;
  let currentDevice = null;
  let backgroundAudio = null;
  let backgroundAudioElement = null;

  // ============================================================
  // Initialize
  // ============================================================
  async function init() {
    console.log('[Player] Inicializando Digital Signage Player...');
    updateLoadingText('Cargando sistema...');
    updateLoadingBar(10);

    // 1) Registrar Service Worker
    await registerServiceWorker();
    updateLoadingBar(25);
    updateLoadingText('Service Worker activo');

    // 2) Cargar playlist
    playlist = new PlaylistManager();
    const loaded = await playlist.load();
    updateLoadingBar(40);

    if (!loaded || playlist.count === 0) {
      showError('Sin contenido', 'La playlist está vacía o no se pudo cargar. Añade contenido desde el panel de administración.');
      updateLoadingText('Esperando contenido...');
      // Reintentar en 10 segundos
      setTimeout(() => init(), 10000);
      return;
    }

    updateLoadingText(`${playlist.count} items en la playlist`);
    updateLoadingBar(55);

    // 3) Solicitar precache de medios al SW
    requestMediaPrecache();
    updateLoadingBar(70);
    updateLoadingText('Precacheando contenido...');

    // 4) Configurar UI
    buildPlaylistIndicator();
    setupClock();
    setupConnectionMonitor();
    setupServiceWorkerMessages();
    updateLoadingBar(90);

    // 4.5) Configurar dispositivo y audio de fondo
    currentDevice = getDeviceFromUrl();
    if (currentDevice) {
      console.log(`[Player] Dispositivo detectado: ${currentDevice}`);
    }
    initBackgroundAudio();
    updateLoadingBar(95);

    // 5) Auto-refresh de playlist cada 30 segundos
    playlist.startAutoRefresh(30000);
    playlist.onPlaylistUpdated = onPlaylistUpdated;

    // 6) ¡Empezar a reproducir!
    updateLoadingBar(100);
    updateLoadingText('¡Comenzando!');

    await sleep(600);
    hideSplash();
    showHud();
    playNext();
  }

  // ============================================================
  // Service Worker
  // ============================================================
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[Player] Service Worker no soportado en este navegador');
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            console.log('[Player] Nuevo Service Worker activado');
          }
        });
      });

      // Esperar a que el SW esté activo
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
          // Timeout de seguridad
          setTimeout(resolve, 3000);
        });
      }

      console.log('[Player] Service Worker registrado ✓');
    } catch (err) {
      console.error('[Player] Error registrando SW:', err);
    }
  }

  function setupServiceWorkerMessages() {
    if (!navigator.serviceWorker) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type, url } = event.data || {};

      if (type === 'VIDEO_CACHED' || type === 'MEDIA_CACHED') {
        console.log(`[Player] Cacheado: ${url}`);
        updateCacheIndicator(url);
      }

      if (type === 'PRECACHE_COMPLETE') {
        console.log('[Player] Precache completo ✓');
        updateStatusDot('cached');
      }
    });
  }

  function requestMediaPrecache() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;

    const urls = playlist.getMediaUrls();
    navigator.serviceWorker.controller.postMessage({
      type: 'PRECACHE_MEDIA',
      data: { urls },
    });
    console.log(`[Player] Solicitando precache de ${urls.length} archivos`);
  }

  // ============================================================
  // Playback Engine
  // ============================================================
  function playNext() {
    const item = playlist.next();
    if (!item) {
      console.warn('[Player] No hay items para reproducir');
      return;
    }

    console.log(`[Player] Reproduciendo: [${item.type}] ${item.title || item.src}`);
    updatePlaylistIndicator(playlist.currentIndex);

    if (item.type === 'video') {
      playVideo(item);
    } else if (item.type === 'image') {
      showImage(item);
    } else {
      console.warn('[Player] Tipo desconocido:', item.type);
      playNext();
    }
  }

  // ============================================================
  // Video Playback
  // ============================================================
  function playVideo(item) {
    clearImageTimer();
    hideImageProgress();

    const video = document.createElement('video');
    video.className = 'media-element';
    video.src = item.src;
    video.muted = item.muted !== false; // Muted por defecto (autoplay policy)
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    // Cuando termina → siguiente
    video.addEventListener('ended', () => {
      transitionOut(video, () => {
        video.remove();
        playNext();
      });
    });

    // Error handling con reintentos
    video.addEventListener('error', (e) => {
      console.error('[Player] Error de video:', e);
      retryCount++;
      if (retryCount <= MAX_RETRIES) {
        console.log(`[Player] Reintentando (${retryCount}/${MAX_RETRIES})...`);
        video.remove();
        setTimeout(() => playNext(), 2000);
      } else {
        showError('Error de reproducción', `No se puede reproducir: ${item.title || item.src}`);
        retryCount = 0;
        setTimeout(() => {
          hideError();
          playNext();
        }, 5000);
      }
    });

    // Cuando está listo para reproducir
    video.addEventListener('canplay', () => {
      retryCount = 0;
      transitionIn(video);
      video.play().catch((err) => {
        console.warn('[Player] Autoplay bloqueado, intentando muted:', err);
        video.muted = true;
        video.play();
      });
    }, { once: true });

    // Limpiar elemento anterior
    if (currentMediaElement) {
      const old = currentMediaElement;
      transitionOut(old, () => old.remove());
    }
    currentMediaElement = video;
    playerContainer.appendChild(video);
  }

  // ============================================================
  // Image Playback
  // ============================================================
  function showImage(item) {
    clearImageTimer();

    const img = document.createElement('img');
    img.className = 'slide-image';
    img.src = item.src;
    img.alt = item.title || '';

    const duration = (item.duration || playlist.settings.defaultImageDuration || 10) * 1000;

    img.addEventListener('load', () => {
      retryCount = 0;
      transitionIn(img);
      showImageProgress(duration);

      imageTimeout = setTimeout(() => {
        transitionOut(img, () => {
          img.remove();
          playNext();
        });
      }, duration);
    }, { once: true });

    img.addEventListener('error', () => {
      console.error('[Player] Error cargando imagen:', item.src);
      img.remove();
      setTimeout(() => playNext(), 1000);
    });

    if (currentMediaElement) {
      const old = currentMediaElement;
      transitionOut(old, () => old.remove());
    }
    currentMediaElement = img;
    playerContainer.appendChild(img);
  }

  // ============================================================
  // Transitions
  // ============================================================
  function transitionIn(element) {
    requestAnimationFrame(() => {
      element.classList.add('active');
    });
  }

  function transitionOut(element, callback) {
    element.classList.remove('active');
    element.classList.add('exiting');
    setTimeout(() => {
      if (callback) callback();
    }, playlist.transitionDuration);
  }

  // ============================================================
  // Image Progress Bar
  // ============================================================
  function showImageProgress(duration) {
    if (!imageProgress) return;
    imageProgress.classList.remove('animating');
    imageProgress.style.transform = 'scaleX(0)';
    imageProgress.style.transitionDuration = '0s';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        imageProgress.style.transitionDuration = `${duration}ms`;
        imageProgress.classList.add('animating');
      });
    });
  }

  function hideImageProgress() {
    if (!imageProgress) return;
    imageProgress.classList.remove('animating');
    imageProgress.style.transform = 'scaleX(0)';
  }

  function clearImageTimer() {
    if (imageTimeout) {
      clearTimeout(imageTimeout);
      imageTimeout = null;
    }
  }

  // ============================================================
  // Playlist Indicator (dots)
  // ============================================================
  function buildPlaylistIndicator() {
    if (!playlistIndicator) return;
    playlistIndicator.innerHTML = '';

    // Limitar a 20 puntos max
    const maxDots = Math.min(playlist.count, 20);
    for (let i = 0; i < maxDots; i++) {
      const dot = document.createElement('div');
      dot.className = 'indicator-dot';
      playlistIndicator.appendChild(dot);
    }
  }

  function updatePlaylistIndicator(index) {
    if (!playlistIndicator) return;
    const dots = playlistIndicator.querySelectorAll('.indicator-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });
  }

  // ============================================================
  // Clock
  // ============================================================
  function setupClock() {
    if (!playlist.showClock || !clockDisplay) return;

    updateClock();
    clockInterval = setInterval(updateClock, 1000);
    clockDisplay.classList.add('visible');
  }

  function updateClock() {
    const now = new Date();

    // Hora
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    if (clockTime) {
      clockTime.textContent = `${hours}:${minutes}`;
    }

    // Fecha
    if (clockDate) {
      const options = { weekday: 'long', day: 'numeric', month: 'long' };
      clockDate.textContent = now.toLocaleDateString('es-HN', options);
    }
  }

  // ============================================================
  // Connection Monitor
  // ============================================================
  function setupConnectionMonitor() {
    updateConnectionStatus();

    window.addEventListener('online', () => {
      updateConnectionStatus();
      hideOfflineBanner();
    });

    window.addEventListener('offline', () => {
      updateConnectionStatus();
      showOfflineBanner();
    });
  }

  function updateConnectionStatus() {
    const isOnline = navigator.onLine;
    if (statusDot) {
      statusDot.className = `status-dot ${isOnline ? '' : 'offline'}`;
    }
    if (statusText) {
      statusText.textContent = isOnline ? 'En línea' : 'Modo Offline';
    }
  }

  function updateStatusDot(status) {
    if (statusDot) statusDot.className = `status-dot ${status}`;
  }

  function updateCacheIndicator(url) {
    // Podría actualizar UI para mostrar qué archivos están cacheados
    console.log(`[Player] Cache indicator: ${url}`);
  }

  // ============================================================
  // Splash / Loading
  // ============================================================
  function updateLoadingBar(percent) {
    if (loadingBar) loadingBar.style.width = `${percent}%`;
  }

  function updateLoadingText(text) {
    if (loadingText) loadingText.textContent = text;
  }

  function hideSplash() {
    if (splashScreen) splashScreen.classList.add('hidden');
  }

  // ============================================================
  // HUD — Heads Up Display
  // ============================================================
  function showHud() {
    if (connectionStatus) connectionStatus.classList.add('visible');
    // Auto-hide after 8 seconds
    hudTimeout = setTimeout(() => {
      if (connectionStatus) connectionStatus.classList.remove('visible');
    }, 8000);
  }

  // ============================================================
  // Error Overlay
  // ============================================================
  function showError(title, msg) {
    const titleEl = document.querySelector('.error-title');
    if (titleEl) titleEl.textContent = title;
    if (errorMsg) errorMsg.textContent = msg;
    if (errorOverlay) errorOverlay.classList.add('visible');
  }

  function hideError() {
    if (errorOverlay) errorOverlay.classList.remove('visible');
  }

  // ============================================================
  // Offline Banner
  // ============================================================
  function showOfflineBanner() {
    if (offlineBanner) offlineBanner.classList.add('visible');
  }

  function hideOfflineBanner() {
    if (offlineBanner) offlineBanner.classList.remove('visible');
  }

  // ============================================================
  // Playlist Update Handler
  // ============================================================
  function onPlaylistUpdated() {
    console.log('[Player] Playlist actualizada. Reiniciando pantalla para aplicar cambios...');
    
    // Esperar 2 segundos antes de recargar para permitir que el Service Worker 
    // detecte nuevos archivos si es necesario, o simplemente para dar feedback visual.
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  }

  // ============================================================
  // Device Detection (Query Params)
  // ============================================================
  function getDeviceFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('device');
  }

  function getDeviceConfig() {
    if (!currentDevice || !playlist.settings.devices) return null;
    return playlist.settings.devices[currentDevice] || null;
  }

  // ============================================================
  // Background Audio
  // ============================================================
  function initBackgroundAudio() {
    const deviceConfig = getDeviceConfig();
    let audioConfig = null;

    if (deviceConfig && deviceConfig.backgroundAudio) {
      audioConfig = deviceConfig.backgroundAudio;
    } else if (playlist.settings.backgroundAudio) {
      audioConfig = playlist.settings.backgroundAudio;
    }

    if (!audioConfig || !audioConfig.enabled) {
      console.log('[Player] Audio de fondo desactivado');
      return;
    }

    console.log('[Player] Iniciando audio de fondo:', audioConfig.url);

    backgroundAudioElement = new Audio();
    backgroundAudioElement.src = audioConfig.url;
    backgroundAudioElement.loop = true;
    backgroundAudioElement.volume = audioConfig.volume || 0.5;
    backgroundAudioElement.crossOrigin = 'anonymous';

    backgroundAudioElement.addEventListener('canplay', () => {
      backgroundAudioElement.play().catch(err => {
        console.warn('[Player] Error al reproducir audio de fondo:', err);
      });
    });

    backgroundAudioElement.addEventListener('error', (e) => {
      console.error('[Player] Error cargando audio de fondo:', e);
    });

    backgroundAudio = audioConfig;
  }

  function stopBackgroundAudio() {
    if (backgroundAudioElement) {
      backgroundAudioElement.pause();
      backgroundAudioElement = null;
    }
  }

  // ============================================================
  // Utilities
  // ============================================================
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // Lifecycle — Visibility Changes (TV sleep/wake)
  // ============================================================
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('[Player] Pantalla oculta (TV sleep?)');
    } else {
      console.log('[Player] Pantalla visible (TV wake)');
      // Reiniciar el reloj por si se desfazó
      updateClock();
    }
  });

  // ============================================================
  // Prevent context menu and selection (TV remote protection)
  // ============================================================
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => e.preventDefault());

  // ============================================================
  // Keyboard shortcuts (para debugging vía teclado)
  // ============================================================
  document.addEventListener('keydown', (e) => {
    // N = siguiente
    if (e.key === 'n' || e.key === 'N') {
      playNext();
    }
    // I = mostrar/ocultar info
    if (e.key === 'i' || e.key === 'I') {
      if (connectionStatus) connectionStatus.classList.toggle('visible');
      if (clockDisplay) clockDisplay.classList.toggle('visible');
    }
    // F = fullscreen
    if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
  });

  // ============================================================
  // Boot!
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
