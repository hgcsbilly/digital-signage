/**
 * Playlist Manager — Digital Signage
 * Gestiona la carga, parsing y control de la playlist.
 */

class PlaylistManager {
  constructor() {
    this.items = [];
    this.settings = {};
    this.currentIndex = -1;
    this.lastUpdated = null;
    this.refreshInterval = null;
    this.playlistUrl = '/api/playlist.json';
    this.onPlaylistLoaded = null;
    this.onPlaylistUpdated = null;
  }

  /**
   * Cargar la playlist desde el servidor
   */
  async load() {
    try {
      const cacheBuster = `?t=${Date.now()}`;
      const response = await fetch(this.playlistUrl + cacheBuster, { cache: 'no-store' });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      this._applyData(data);
      console.log(`[Playlist] Cargada: ${this.items.length} items activos`);
      return true;
    } catch (err) {
      console.warn('[Playlist] Error cargando dalla red, intentado cache...', err);
      return this._loadFromCache();
    }
  }

  /**
   * Intentar cargar la playlist desde el cache del SW
   */
  async _loadFromCache() {
    try {
      const cache = await caches.open('ds-api-v2');
      const response = await cache.match(this.playlistUrl);
      if (response) {
        const data = await response.json();
        this._applyData(data);
        console.log('[Playlist] Cargada desde cache');
        return true;
      }
    } catch (err) {
      console.error('[Playlist] Error cargando desde cache:', err);
    }
    return false;
  }

  /**
   * Aplicar los datos de la playlist
   */
  _applyData(data) {
    this.settings = data.settings || {};
    this.lastUpdated = data.lastUpdated;
    // Solo items habilitados
    this.items = (data.playlist || []).filter(item => item.enabled !== false);
  }

  /**
   * Obtener el siguiente item (circular)
   */
  next() {
    if (this.items.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    return this.items[this.currentIndex];
  }

  /**
   * Obtener el item actual
   */
  current() {
    if (this.currentIndex < 0 || this.currentIndex >= this.items.length) return null;
    return this.items[this.currentIndex];
  }

  /**
   * Obtener todas las URLs de medios para precaching
   */
  getMediaUrls() {
    return this.items.map(item => {
      // Convertir ruta relativa a absoluta
      if (item.src.startsWith('http')) return item.src;
      return new URL(item.src, window.location.origin).href;
    });
  }

  /**
   * Cantidad total de items
   */
  get count() {
    return this.items.length;
  }

  /**
   * Configuración: duración por defecto de imágenes (segundos)
   */
  get defaultImageDuration() {
    return (this.settings.defaultImageDuration || 10) * 1000;
  }

  /**
   * Configuración: duración de transición (milisegundos)
   */
  get transitionDuration() {
    return this.settings.transitionDuration || 800;
  }

  /**
   * Configuración: mostrar reloj
   */
  get showClock() {
    return this.settings.showClock !== false;
  }

  /**
   * Iniciar auto-refresh de la playlist (verificar cambios)
   * @param {number} intervalMs — intervalo en milisegundos (default: 60s)
   */
  startAutoRefresh(intervalMs = 60000) {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(async () => {
      const previousItems = JSON.stringify(this.items);
      await this.load();
      if (JSON.stringify(this.items) !== previousItems) {
        console.log('[Playlist] ¡Playlist actualizada!');
        if (this.onPlaylistUpdated) this.onPlaylistUpdated();
      }
    }, intervalMs);
    console.log(`[Playlist] Auto-refresh cada ${intervalMs / 1000}s`);
  }

  /**
   * Detener auto-refresh
   */
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

// Export para uso como módulo o global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlaylistManager;
} else {
  window.PlaylistManager = PlaylistManager;
}
