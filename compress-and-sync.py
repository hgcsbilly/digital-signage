import os
import json
import subprocess
import shutil
from datetime import datetime

import argparse

# Rutas relativas al script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VIDEOS_DIR = os.path.join(BASE_DIR, 'content', 'videos')
PLAYLIST_FILE = os.path.join(BASE_DIR, 'api', 'playlist.json')

# Configuración de compresión
MAX_SIZE_MB = 30  # Videos mayores a este peso se comprimirán automáticamente
# Argument parser for optional flags
parser = argparse.ArgumentParser(description='Sync videos and generate playlist')
parser.add_argument('--skip-compress', action='store_true', help='Skip video compression step')
args = parser.parse_args()

def check_ffmpeg():
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path is None:
        return False
    
    # Resolver la ruta real por si es un symlink (común en Ubuntu)
    real_path = os.path.realpath(ffmpeg_path)
    
    # Check if it's a snap package
    if "snap" in real_path or "snap" in ffmpeg_path:
        print(f"[WARN] FFmpeg detectado en: {real_path}")
        print("[WARN] Detectado FFmpeg instalado vía SNAP. Los snaps NO pueden acceder a /var/www.")
        print("[WARN] POR FAVOR EJECUTA: sudo snap remove ffmpeg && sudo apt install ffmpeg")
    
    return True

def compress_video(filepath):
    if not os.access(filepath, os.R_OK):
        print(f"[ERROR] No hay permisos de LECTURA para el archivo: {os.path.basename(filepath)}")
        return False
        
    filesize_mb = os.path.getsize(filepath) / (1024 * 1024)
    if filesize_mb <= MAX_SIZE_MB:
        return True # No necesita compresión
    
    print(f"\n[COMPRESS] Detectado video pesado: {os.path.basename(filepath)} ({filesize_mb:.1f} MB)")
    print(f"[COMPRESS] Iniciando compresión... (Esto puede tardar varios minutos dependiendo del equipo)")
    
    temp_filepath = filepath + ".tmp.mp4"
    
    # Comando FFmpeg: Codec H.264, Calidad 23, preset fast, SIN audio (-an)
    # -nostdin: Evita que ffmpeg intente leer del teclado (crítico en scripts)
    # -hide_banner: Menos ruido en la consola
    command = [
        "ffmpeg", "-y", "-nostdin", "-hide_banner",
        "-i", filepath,
        "-vcodec", "libx264", "-crf", "23", "-preset", "fast",
        "-an",
        temp_filepath
    ]
    
    try:
        # Ejecutar ffmpeg (suprimiendo la salida estándar para no inundar la terminal)
        process = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        
        if process.returncode == 0:
            new_size_mb = os.path.getsize(temp_filepath) / (1024 * 1024)
            print(f"[COMPRESS] Exito. Nuevo peso: {new_size_mb:.1f} MB (Ahorraste {filesize_mb - new_size_mb:.1f} MB)")
            # Reemplazar original
            os.replace(temp_filepath, filepath)
            return True
        else:
            print(f"[ERROR] Falló la compresión de {os.path.basename(filepath)}.")
            if process.stderr:
                print(f"[DEBUG] FFmpeg Error: {process.stderr.strip()}")
            if os.path.exists(temp_filepath):
                os.remove(temp_filepath)
            return False
            
    except Exception as e:
        print(f"[ERROR] Excepción al comprimir: {e}")
        if os.path.exists(temp_filepath):
            os.remove(temp_filepath)
        return False

def sync():
    print(f"[SEARCH] Escaneando videos en: {VIDEOS_DIR}")
    
    if not os.path.exists(VIDEOS_DIR):
        print(f"[ERROR] La carpeta {VIDEOS_DIR} no existe.")
        return

    has_ffmpeg = check_ffmpeg()
    if not has_ffmpeg:
        print("[WARN] FFmpeg no está instalado en el sistema.")
        print("[WARN] La compresión se omitirá. Instálalo en Ubuntu con: sudo apt install ffmpeg")
        # Force skip compression if ffmpeg missing
        skip_compress = True
    else:
        skip_compress = args.skip_compress
    
    files = sorted(os.listdir(VIDEOS_DIR))
    videos_data = []
    
    for filename in files:
        if filename.lower().endswith(('.mp4', '.webm', '.ogg', '.mov')):
            filepath = os.path.join(VIDEOS_DIR, filename)
            
            # 1. Comprimir si es necesario y si ffmpeg está instalado
            if not skip_compress:
                # Si falla la compresión, simplemente avisamos y seguimos con el original
                compress_video(filepath)
            
            # 2. Generar item para la playlist (siempre se añade, falle o no la compresión)
            video_id = f"item-{abs(hash(filename)) % 1000000}"
            title = os.path.splitext(filename)[0]
            
            videos_data.append({
                "id": video_id,
                "type": "video",
                "src": f"content/videos/{filename}",
                "title": title,
                "enabled": True,
                "muted": True,
                "duration": None
            })

    # 3. Guardar Playlist (manteniendo settings actuales)
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
        except Exception:
            pass
            
    new_data = {
        "version": "1.2",
        "lastUpdated": datetime.now().strftime('%Y-%m-%dT%H:%M:%SZ'),
        "settings": settings,
        "playlist": videos_data
    }

    try:
        os.makedirs(os.path.dirname(PLAYLIST_FILE), exist_ok=True)
        with open(PLAYLIST_FILE, 'w', encoding='utf-8') as f:
            json.dump(new_data, f, indent=2, ensure_ascii=False)
        print(f"\n[OK] Sincronización completa. Playlist generada con {len(videos_data)} videos.")
    except Exception as e:
        print(f"[ERROR] Al guardar la playlist: {e}")

if __name__ == "__main__":
    sync()
