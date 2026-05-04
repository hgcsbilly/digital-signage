FROM nginx:stable

# Instalar Python y FFmpeg (para el script de compresión)
RUN apt-get update && \
    apt-get install -y python3 ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Eliminar la configuración por defecto de Nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copiar la configuración personalizada de Nginx
COPY nginx.conf /etc/nginx/conf.d/digital-signage.conf

# Crear el directorio donde vivirá la app
WORKDIR /var/www/digital-signage

# Copiar todos los archivos del proyecto al contenedor
COPY . /var/www/digital-signage/

# Asegurar que existan los directorios y dar permisos
RUN mkdir -p /var/www/digital-signage/content/videos && \
    mkdir -p /var/www/digital-signage/api && \
    chown -R nginx:nginx /var/www/digital-signage

# Crear un script de arranque para correr Python y Nginx simultáneamente
RUN echo '#!/bin/bash\n\
echo "Iniciando mini API Server..."\n\
python3 /var/www/digital-signage/save-api.py &\n\
echo "Iniciando Nginx..."\n\
nginx -g "daemon off;"\n\
' > /start.sh && chmod +x /start.sh

# Exponer el puerto 80
EXPOSE 80

# Ejecutar el script al iniciar el contenedor
CMD ["/start.sh"]
