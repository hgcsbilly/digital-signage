import os
import json
from datetime import datetime

# Rutas relativas al script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VIDEOS_DIR = os.path.join(BASE_DIR, 'content', 'videos')
PLAYLIST_FILE = os.path.join(BASE_DIR, 'api', 'playlist.json')

def sync():
    print(f"[SEARCH] Escaneando videos en: {VIDEOS_DIR}")
    
    # 1. Intentar mantener configuración actual
    settings = {
        "defaultImageDuration": 10,
        "transitionDuration": 800,
        "transitionType": "fade",
        "loopPlaylist": True,
        "showClock": True,
        "clockPosition": "bottom-right"
    }
    
    if os.path.exists(PLAYLIST_FILE):
        try:
            with open(PLAYLIST_FILE, 'r', encoding='utf-8') as f:
                old_data = json.load(f)
                settings = old_data.get('settings', settings)
        except Exception as e:
            print(f"[WARN] No se pudo leer la playlist anterior, usando settings por defecto. ({e})")

    # 2. Listar videos en la carpeta
    if not os.path.exists(VIDEOS_DIR):
        print(f"[ERROR] La carpeta {VIDEOS_DIR} no existe.")
        return

    videos = []
    # Ordenar alfabéticamente para mantener un orden consistente
    files = sorted(os.listdir(VIDEOS_DIR))
    
    for filename in files:
        if filename.lower().endswith(('.mp4', '.webm', '.ogg', '.mov')):
            # Generar un ID único simple basado en el nombre
            video_id = f"item-{abs(hash(filename)) % 1000000}"
            
            # Usar el nombre del archivo (sin extensión) como título
            title = os.path.splitext(filename)[0]
            
            videos.append({
                "id": video_id,
                "type": "video",
                "src": f"content/videos/{filename}",
                "title": title,
                "enabled": True,
                "muted": True,
                "duration": None
            })

    # 3. Construir nueva estructura
    new_data = {
        "version": "1.1",
        "lastUpdated": datetime.now().strftime('%Y-%m-%dT%H:%M:%SZ'),
        "settings": settings,
        "playlist": videos
    }

    # 4. Guardar archivo
    try:
        # Asegurar que el directorio api existe
        os.makedirs(os.path.dirname(PLAYLIST_FILE), exist_ok=True)
        
        with open(PLAYLIST_FILE, 'w', encoding='utf-8') as f:
            json.dump(new_data, f, indent=2, ensure_ascii=False)
        
        print(f"[OK] Sincronización completa. Se encontraron {len(videos)} videos.")
        print(f"[INFO] Ubicación: {PLAYLIST_FILE}")
        
    except Exception as e:
        print(f"[ERROR] Al guardar la playlist: {e}")


if __name__ == "__main__":
    sync()
