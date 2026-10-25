# My Movies

Una aplicación de escritorio local construida con Electron para organizar y reproducir películas almacenadas en tu propia computadora. La interfaz toma inspiración de los patrones modernos de servicios de streaming (hero cinematográfico, carruseles, previsualizaciones y continuidad), pero usa identidad propia.

## Funciones actuales

- Selección de una o varias carpetas desde Windows.
- Escaneo recursivo de videos.
- Compatibilidad de biblioteca con MP4, MKV, MOV, M4V, AVI, WEBM, WMV, FLV, MPEG/MPG, TS/M2TS/MTS y OGV.
- Lectura de metadatos mediante FFprobe: duración, formato, resolución, codecs, pistas de audio y subtítulos embebidos.
- Generación automática de 4 fotogramas por película con FFmpeg.
- Previsualización animada de tarjetas alternando fotogramas.
- Hero destacado con imagen de la propia película.
- Búsqueda.
- Mi lista / favoritos.
- Agregadas recientemente.
- Continuar viendo con progreso persistente.
- Reproductor integrado con play/pause, salto ±10 s, seek, mute, fullscreen y atajos.
- Detección de subtítulos externos contiguos. Los VTT externos pueden activarse directamente desde el reproductor.
- Persistencia de biblioteca, favoritos, progreso y caché en el directorio de datos de Electron.
- Empaquetado de Windows mediante electron-builder.

## Ejecutar en Windows

Desde CMD o PowerShell:

```bat
cd C:\Dev\apps_electron
git clone https://github.com/yetsin7/my-movies.git
cd my-movies
npm install
npm start
```

Para construir instalador:

```bat
npm run dist
```

El instalador aparecerá en `dist\`.

## Nota sobre codecs

Electron/Chromium puede reproducir de forma nativa muchos videos H.264/AAC, VP8/VP9/Opus y formatos web compatibles. My Movies puede **indexar** muchos contenedores gracias a FFmpeg/FFprobe aunque un codec concreto no sea decodificable de forma nativa por Chromium.

La siguiente evolución prevista es incorporar un backend de reproducción FFmpeg/MPV para conmutación real entre múltiples pistas de audio, subtítulos embebidos ASS/PGS y codecs no soportados por Chromium sin depender del soporte multimedia de Electron.

## Privacidad

La biblioteca es local. La app no sube películas, nombres de archivos ni historial a ningún servicio externo.

## Arquitectura

- `electron/main.js`: ventana, IPC, selección de carpetas y estado.
- `electron/library.js`: escaneo, FFprobe, thumbnails y persistencia.
- `electron/preload.js`: API segura para el renderer.
- `src/`: interfaz y reproductor.
