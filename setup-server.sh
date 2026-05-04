#!/bin/bash
# ============================================================
# Script de Instalación — Digital Signage Server (Ubuntu)
# ============================================================
# Uso: sudo bash setup-server.sh
# ============================================================

set -e

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     📺 Digital Signage — Instalación del Servidor   ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Verificar que se ejecuta como root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Este script debe ejecutarse como root (sudo)"
  exit 1
fi

# Variables
WEB_DIR="/var/www/digital-signage"
NGINX_CONF="/etc/nginx/sites-available/digital-signage"
NGINX_LINK="/etc/nginx/sites-enabled/digital-signage"

# ============================================================
# 1. Instalar Nginx (si no está instalado)
# ============================================================
echo "📦 [1/5] Verificando Nginx..."
if ! command -v nginx &> /dev/null; then
  echo "   Instalando Nginx..."
  apt update -qq
  apt install -y nginx
  echo "   ✅ Nginx instalado"
else
  echo "   ✅ Nginx ya está instalado ($(nginx -v 2>&1))"
fi

# ============================================================
# 2. Crear directorio web y copiar archivos
# ============================================================
echo "📁 [2/5] Configurando directorio web..."
mkdir -p "$WEB_DIR"

# Copiar todos los archivos del proyecto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "   Copiando archivos desde: $SCRIPT_DIR"
rsync -av --exclude='setup-server.sh' --exclude='nginx.conf' --exclude='.git' "$SCRIPT_DIR/" "$WEB_DIR/"

# Crear directorios de contenido
mkdir -p "$WEB_DIR/content/videos"
mkdir -p "$WEB_DIR/content/images"
mkdir -p "$WEB_DIR/api"

# Permisos
chown -R www-data:www-data "$WEB_DIR"
chmod -R 755 "$WEB_DIR"

echo "   ✅ Archivos copiados a $WEB_DIR"

# ============================================================
# 3. Configurar Nginx
# ============================================================
echo "🔧 [3/5] Configurando Nginx..."

# Copiar configuración
cp "$SCRIPT_DIR/nginx.conf" "$NGINX_CONF"

# Habilitar sitio
if [ -L "$NGINX_LINK" ]; then
  rm "$NGINX_LINK"
fi
ln -s "$NGINX_CONF" "$NGINX_LINK"

# Desactivar sitio default (si existe)
if [ -L /etc/nginx/sites-enabled/default ]; then
  rm /etc/nginx/sites-enabled/default
  echo "   ℹ️ Sitio default desactivado"
fi

# Verificar configuración
nginx -t

echo "   ✅ Nginx configurado"

# ============================================================
# 4. Reiniciar Nginx
# ============================================================
echo "🔄 [4/5] Reiniciando Nginx..."
systemctl restart nginx
systemctl enable nginx
echo "   ✅ Nginx reiniciado y habilitado al inicio"

# ============================================================
# 5. Mostrar información
# ============================================================
echo "📡 [5/5] Obteniendo información de red..."

# Obtener IP local
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║              ✅ INSTALACIÓN EXITOSA                  ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "║  🖥️  Reproductor (Smart TV):                         ║"
echo "║     http://$LOCAL_IP/                        ║"
echo "║                                                      ║"
echo "║  ⚙️  Panel Admin:                                    ║"
echo "║     http://$LOCAL_IP/admin/                  ║"
echo "║                                                      ║"
echo "║  📁 Videos:   $WEB_DIR/content/videos/   ║"
echo "║  📁 Imágenes: $WEB_DIR/content/images/   ║"
echo "║  📋 Playlist: $WEB_DIR/api/playlist.json  ║"
echo "║                                                      ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  📝 Próximos pasos:                                  ║"
echo "║  1. Copia tus videos a content/videos/               ║"
echo "║  2. Edita la playlist desde /admin/                  ║"
echo "║  3. Abre la URL en la Smart TV                       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
