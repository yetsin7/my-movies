# My Movies

Aplicación de escritorio local construida con Electron para organizar y reproducir películas almacenadas en tu propia computadora. La experiencia visual está inspirada en los patrones premium de servicios de streaming, con identidad propia y funcionamiento completamente local.

## Funciones actuales

- Selección acumulativa de una o varias carpetas desde Windows.
- Escaneo recursivo de videos.
- Escaneo incremental: los archivos que no cambiaron reutilizan metadatos, miniaturas y subtítulos procesados.
- Biblioteca compatible con MP4, MKV, MOV, M4V, AVI, WEBM, WMV, FLV, MPEG/MPG, TS/M2TS/MTS y OGV.
- FFprobe para duración, bitrate, resolución, FPS, codecs, audio, subtítulos y características HDR.
- Detección de HDR10, HLG y contenido BT.2020 cuando los metadatos lo permiten.
- Generación automática de 5 fotogramas cinematográficos por película mediante FFmpeg.
- Previsualización animada de tarjetas.
- Hero premium con imágenes extraídas de la propia película.
- Búsqueda rápida con Ctrl+K.
- Mi lista / favoritos.
- Recientes, alta definición, HDR, películas largas y continuar viendo.
- Progreso persistente y reanudación automática.
- Reproductor integrado con play/pause, ±10 s, seek, mute y fullscreen.
- Conversión automática de subtítulos externos SRT/ASS/SSA a WebVTT.
- Extracción automática a WebVTT de subtítulos embebidos de texto compatibles.
- Selector de subtítulos directamente en el reproductor.
- Selector de pista de audio cuando el motor Chromium expone múltiples pistas.
- Avisos claros cuando un codec no puede reproducirse con el motor integrado.
- Persistencia de biblioteca, favoritos, progreso y caché en el directorio de datos de Electron.
- Empaquetado para Windows con electron-builder.

## Ejecutar en Windows

```bat
cd C:\Dev\apps_electron
git clone https://github.com/yetsin7/my-movies.git
cd my-movies
npm install
npm start
```

Si ya lo tienes clonado:

```bat
cd C:\Dev\apps_electron\my-movies
git pull
npm install
npm start
```

Para generar instalador:

```bat
npm run dist
```

El instalador se genera en `dist\`.

## Compatibilidad multimedia

My Movies usa FFmpeg/FFprobe para analizar prácticamente cualquier archivo habitual de biblioteca local, aunque la reproducción final integrada sigue dependiendo del conjunto de codecs que Chromium/Electron pueda decodificar.

Por eso un MKV puede aparecer perfectamente catalogado, con miniaturas, pistas y subtítulos, aunque una combinación concreta como HEVC + TrueHD + PGS no sea reproducible aún por el motor integrado.

La arquitectura está preparada para una futura capa de reproducción nativa basada en MPV/FFmpeg para ampliar la compatibilidad de codecs sin degradar la interfaz Electron.

## Privacidad

La biblioteca permanece local. My Movies no sube archivos, títulos, rutas, historial ni miniaturas a servicios externos.

## Arquitectura

- `electron/main.js`: ventana, IPC, selección de carpetas y exposición segura de medios.
- `electron/library.js`: escaneo incremental, FFprobe, miniaturas, HDR, preparación de subtítulos y persistencia.
- `electron/preload.js`: puente seguro entre Electron y el renderer.
- `src/index.html`: estructura de la experiencia.
- `src/styles.css`: sistema visual premium.
- `src/renderer.js`: biblioteca, navegación, player, subtítulos, audio y estados interactivos.
