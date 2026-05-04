/**
 * Service Worker — Digital Signage Guardian
 * Versión: 2.0
 *
 * Estrategia:
 * - App Shell: Cache First (siempre sirve lo que tiene)
 * - Videos e Imágenes: Cache First con Network Fallback
 * - playlist.json: Network First con Cache Fallback (para actualizaciones)
 * - Soporta HTTP Range Requests para reproducción de video eficiente
 */

const CACHE_VERSION = 'v2';
const APP_CACHE = `ds-app-shell-${CACHE_VERSION}`;
const MEDIA_CACHE = `ds-media-${CACHE_VERSION}`;
const API_CACHE = `ds-api-${CACHE_VERSION}`;

// Archivos del App Shell — se cachean en la instalación
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/css/player.css',
  '/assets/js/player.js',
  '/assets/js/playlist.js',
];

// ============================================================
// Evento: install — Precache del App Shell
// ============================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => {
      console.log('[SW] Precaching App Shell');
      return cache.addAll(APP_SHELL_ASSETS).catch((err) => {
        console.warn('[SW] Error en precache (normal en desarrollo):', err);
      });
    }).then(() => {
      console.log('[SW] Instalación completa. Activando inmediatamente.');
      return self.skipWaiting();
    })
  );
});

// ============================================================
// Evento: activate — Limpiar caches antiguas
// ============================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando nueva versión...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // Elimina caches que no corresponden a esta versión
            return name.startsWith('ds-') && ![APP_CACHE, MEDIA_CACHE, API_CACHE].includes(name);
          })
          .map((name) => {
            console.log('[SW] Eliminando cache antigua:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Activación completa. Controlando todos los clientes.');
      return self.clients.claim();
    })
  );
});

// ============================================================
// Evento: fetch — Interceptar todas las peticiones
// ============================================================
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const pathname = url.pathname;

  // Ignorar peticiones de extensiones del navegador
  if (!url.protocol.startsWith('http')) return;

  // --- 1. API / playlist.json: Network First ---
  if (pathname.includes('/api/') || pathname.includes('playlist.json')) {
    event.respondWith(networkFirst(event.request, API_CACHE));
    return;
  }

  // --- 2. Videos: Cache First con soporte Range ---
  if (isVideoRequest(pathname)) {
    event.respondWith(handleVideoRequest(event.request));
    return;
  }

  // --- 3. Imágenes de contenido: Cache First ---
  if (isImageRequest(pathname)) {
    event.respondWith(cacheFirst(event.request, MEDIA_CACHE));
    return;
  }

  // --- 4. App Shell: Cache First ---
  event.respondWith(cacheFirst(event.request, APP_CACHE));
});

// ============================================================
// Estrategia: Cache First
// Primero busca en cache. Si no existe, va a la red y guarda.
// ============================================================
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    // Background: actualizar en paralelo sin bloquear
    updateInBackground(request, cache);
    return cached;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.error('[SW] Sin red y sin cache para:', request.url);
    throw err;
  }
}

// ============================================================
// Estrategia: Network First
// Intenta la red primero. Si falla, usa el cache.
// ============================================================
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request, { cache: 'no-store' });
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] Red no disponible, usando cache para:', request.url);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

// ============================================================
// Manejo especial de Videos con Range Requests
// Permite seek/scrubbing sin re-descargar el video completo
// ============================================================
async function handleVideoRequest(request) {
  const rangeHeader = request.headers.get('Range');

  // Si el browser pide un rango, servir desde cache con soporte de range
  if (rangeHeader) {
    const cache = await caches.open(MEDIA_CACHE);
    const cachedResponse = await cache.match(request.url); // match sin range

    if (cachedResponse) {
      return serveRange(cachedResponse, rangeHeader);
    }
  }

  // Sin range: intentar cachear el video completo si no está en cache
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request.url);

  if (cached) {
    if (rangeHeader) {
      return serveRange(cached, rangeHeader);
    }
    return cached;
  }

  // No está en cache — descargar y guardar
  try {
    // Hacer fetch sin el range header para descargar completo
    const fullRequest = new Request(request.url, {
      headers: {},
      mode: request.mode,
      credentials: request.credentials,
    });

    const networkResponse = await fetch(fullRequest);
    if (networkResponse.ok) {
      cache.put(request.url, networkResponse.clone());
      notifyClients({ type: 'VIDEO_CACHED', url: request.url });
    }

    if (rangeHeader) {
      return serveRange(networkResponse, rangeHeader);
    }
    return networkResponse;
  } catch (err) {
    console.error('[SW] Error descargando video:', request.url, err);
    throw err;
  }
}

// ============================================================
// Servir rango de bytes desde una respuesta cacheada
// ============================================================
async function serveRange(response, rangeHeader) {
  const buffer = await response.clone().arrayBuffer();
  const totalSize = buffer.byteLength;

  // Parsear header: "bytes=start-end" o "bytes=start-"
  const [, rangeSpec] = rangeHeader.split('=');
  const [startStr, endStr] = rangeSpec.split('-');
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : totalSize - 1;
  const chunkSize = end - start + 1;

  const slicedBuffer = buffer.slice(start, end + 1);
  const contentType = response.headers.get('Content-Type') || 'video/mp4';

  return new Response(slicedBuffer, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize.toString(),
      'Content-Type': contentType,
    },
  });
}

// ============================================================
// Actualizar cache en background (sin bloquear al usuario)
// ============================================================
async function updateInBackground(request, cache) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse);
    }
  } catch {
    // Silencioso — es una actualización de fondo
  }
}

// ============================================================
// Helpers
// ============================================================
function isVideoRequest(pathname) {
  return /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(pathname);
}

function isImageRequest(pathname) {
  return /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(pathname) && pathname.includes('/content/');
}

// ============================================================
// Notificar a los clientes (tabs/TVs abiertas)
// ============================================================
async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => client.postMessage(message));
}

// ============================================================
// Evento: message — Comandos desde el reproductor
// ============================================================
self.addEventListener('message', async (event) => {
  const { type, data } = event.data || {};

  if (type === 'PRECACHE_MEDIA') {
    // Precargar lista de medios enviada desde el reproductor
    precacheMediaList(data.urls);
  }

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (type === 'GET_CACHE_STATUS') {
    const status = await getCacheStatus(data.url);
    event.source.postMessage({ type: 'CACHE_STATUS', url: data.url, cached: status });
  }
});

// ============================================================
// Precargar lista de medios en background
// ============================================================
async function precacheMediaList(urls = []) {
  const cache = await caches.open(MEDIA_CACHE);
  console.log(`[SW] Iniciando precache de ${urls.length} archivos media...`);

  for (const url of urls) {
    const cached = await cache.match(url);
    if (!cached) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          await cache.put(url, response);
          console.log('[SW] Cacheado:', url);
          notifyClients({ type: 'MEDIA_CACHED', url });
        }
      } catch (err) {
        console.warn('[SW] No se pudo cachear:', url, err);
      }
    } else {
      console.log('[SW] Ya estaba en cache:', url);
    }
  }
  notifyClients({ type: 'PRECACHE_COMPLETE' });
}

// ============================================================
// Verificar si una URL está en cache
// ============================================================
async function getCacheStatus(url) {
  const mediaCache = await caches.open(MEDIA_CACHE);
  const cached = await mediaCache.match(url);
  return !!cached;
}
