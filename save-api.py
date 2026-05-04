#!/usr/bin/env python3
"""
Mini API Server — Digital Signage
Servidor Python ligero para soportar escritura de playlist.json desde el admin panel.

USO:
    python3 save-api.py

Esto inicia un servidor en el puerto 8080 que acepta PUT requests
para guardar el archivo playlist.json.

NOTA: Corre esto aparte de Nginx. Nginx sirve los archivos estáticos,
      y este mini-server solo maneja la escritura de la playlist.
      Configura un proxy_pass en Nginx para /api/ → localhost:8080
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

# Ruta al archivo playlist
PLAYLIST_PATH = '/var/www/digital-signage/api/playlist.json'
PORT = 8080

class PlaylistHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """CORS preflight"""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        """Leer playlist"""
        if self.path.startswith('/api/playlist.json'):
            try:
                with open(PLAYLIST_PATH, 'r', encoding='utf-8') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._cors_headers()
                self.end_headers()
                self.wfile.write(content.encode())
            except FileNotFoundError:
                self.send_error(404, 'Playlist no encontrada')
        else:
            self.send_error(404)

    def do_PUT(self):
        """Guardar playlist"""
        if self.path.startswith('/api/playlist.json'):
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                data = json.loads(body)

                # Validar que es JSON válido con los campos esperados
                if 'playlist' not in data:
                    self.send_error(400, 'JSON inválido: falta campo "playlist"')
                    return

                # Backup del anterior
                if os.path.exists(PLAYLIST_PATH):
                    backup = PLAYLIST_PATH + '.backup'
                    os.replace(PLAYLIST_PATH, backup)

                # Guardar nuevo
                with open(PLAYLIST_PATH, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)

                timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                print(f'[{timestamp}] ✅ Playlist guardada ({len(data["playlist"])} items)')

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'ok', 'saved': timestamp}).encode())

            except json.JSONDecodeError:
                self.send_error(400, 'JSON inválido')
            except Exception as e:
                self.send_error(500, str(e))
        else:
            self.send_error(404)

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, format, *args):
        """Formato de log personalizado"""
        timestamp = datetime.now().strftime('%H:%M:%S')
        print(f'[{timestamp}] {args[0]}')

if __name__ == '__main__':
    if not os.path.exists(os.path.dirname(PLAYLIST_PATH)):
        os.makedirs(os.path.dirname(PLAYLIST_PATH), exist_ok=True)

    # Permitir reutilizar el puerto inmediatamente (evita OSError 98)
    HTTPServer.allow_reuse_address = True

    server = HTTPServer(('0.0.0.0', PORT), PlaylistHandler)
    print(f'📡 Mini API Server corriendo en puerto {PORT}')

    print(f'📋 Playlist: {PLAYLIST_PATH}')
    print(f'   PUT http://localhost:{PORT}/api/playlist.json')
    print('')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n🛑 Servidor detenido')
        server.server_close()
