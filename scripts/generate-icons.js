'use strict';

/**
 * Generates the My Movies brand assets from a single SVG definition:
 *   src/assets/logo.svg           in-app logo
 *   src/assets/icon.png           window icon (256 px)
 *   build/icon.ico                Windows executable, installer and shortcuts
 *   build/icon.png                512 px master raster
 *   build/installerSidebar.bmp    NSIS installer/uninstaller sidebar
 *
 * Run with: pnpm run icons  (uses Electron's Chromium to rasterize the SVG).
 */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const ASSETS_DIR = path.join(ROOT, 'src', 'assets');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const DETAIL_MIN_SIZE = 64;

const M_PATH = 'M232 760V264h100l180 256 180-256h100v496H692V452L544 664h-64L332 452v308z';

/**
 * Builds the logo SVG.
 * @param {number} size Rendered width/height in pixels.
 * @param {boolean} detailed Include film-strip perforations (too noisy below ~64 px).
 * @returns {string} SVG markup.
 */
function logoSvg(size, detailed = true) {
  const perforations = detailed
    ? '<g fill="#2a0003" fill-opacity=".3">' + Array.from({ length: 10 }, (_, i) => {
      const x = 90 + i * 88;
      return `<rect x="${x}" y="56" width="52" height="52" rx="13"/><rect x="${x}" y="916" width="52" height="52" rx="13"/>`;
    }).join('') + '</g>'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="140" y1="60" x2="880" y2="980" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff4650"/>
      <stop offset=".55" stop-color="#d4101b"/>
      <stop offset="1" stop-color="#7a0008"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".3"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#ffd6d9"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#3a0004" flood-opacity=".55"/>
    </filter>
    <clipPath id="clip"><rect width="1024" height="1024" rx="236"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <rect width="1024" height="560" fill="url(#sheen)"/>
    ${perforations}
    <path d="${M_PATH}" fill="url(#mark)" filter="url(#shadow)"/>
  </g>
</svg>`;
}

const CANVAS_SIZE = 560;
let canvas;

/**
 * Creates the single hidden Chromium window reused for every capture.
 * @returns {Promise<void>}
 */
async function openCanvas() {
  canvas = new BrowserWindow({
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: { backgroundThrottling: false }
  });
  const page = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}</style><body></body>';
  await canvas.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
}

/**
 * Renders markup in the top-left corner of the canvas and captures that region.
 * @param {string} html Body markup.
 * @param {number} width Capture width.
 * @param {number} height Capture height.
 * @returns {Promise<Electron.NativeImage>} Captured image.
 */
async function render(html, width, height) {
  await canvas.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return canvas.webContents.capturePage({ x: 0, y: 0, width, height });
}

/**
 * Packs PNG images into a Windows .ico container.
 * @param {{size: number, png: Buffer}[]} entries Icon images.
 * @returns {Buffer} ICO file contents.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const directory = [];
  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    directory.push(entry);
  }
  return Buffer.concat([header, ...directory, ...entries.map((e) => e.png)]);
}

/**
 * Encodes a BGRA bitmap as an opaque 24-bit BMP (the format NSIS requires).
 * @param {Buffer} bitmap BGRA pixels, top-down.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @returns {Buffer} BMP file contents.
 */
function buildBmp(bitmap, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const target = (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      pixels[target + x * 3] = bitmap[source];
      pixels[target + x * 3 + 1] = bitmap[source + 1];
      pixels[target + x * 3 + 2] = bitmap[source + 2];
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  return Buffer.concat([header, pixels]);
}

function sidebarHtml() {
  return `<div style="width:164px;height:314px;position:relative;overflow:hidden;color:#fff;font-family:'Segoe UI',Arial,sans-serif;background:linear-gradient(180deg,#0b0b0d 0%,#1d0508 100%)">
    <div style="position:absolute;inset:0;background:radial-gradient(circle at 15% 105%,rgba(255,57,67,.32),transparent 65%)"></div>
    <div style="position:absolute;left:22px;top:30px">${logoSvg(120, true)}</div>
    <div style="position:absolute;left:22px;top:172px;font-weight:800;letter-spacing:.2em;font-size:15px">MY MOVIES</div>
    <div style="position:absolute;left:22px;top:196px;font-size:9px;letter-spacing:.34em;color:#a0a0aa">LOCAL CINEMA</div>
  </div>`;
}

async function main() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  fs.writeFileSync(path.join(ASSETS_DIR, 'logo.svg'), logoSvg(1024, true) + '\n', 'utf8');
  await openCanvas();

  const rasters = new Map();
  for (const size of [...new Set([...ICO_SIZES, 512])]) {
    const image = await render(logoSvg(size, size >= DETAIL_MIN_SIZE), size, size);
    rasters.set(size, image.toPNG());
  }

  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), rasters.get(512));
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), rasters.get(256));
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), buildIco(ICO_SIZES.map((size) => ({ size, png: rasters.get(size) }))));

  const sidebar = await render(sidebarHtml(), 164, 314);
  const { width, height } = sidebar.getSize();
  fs.writeFileSync(path.join(BUILD_DIR, 'installerSidebar.bmp'), buildBmp(sidebar.toBitmap(), width, height));

  console.log('Brand assets written to build/ and src/assets/');
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
