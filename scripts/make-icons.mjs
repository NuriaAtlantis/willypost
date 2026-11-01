// Genera el icono de WillyPost: scripts/willypost.png (1024), scripts/willypost.ico (PNG incrustados)
// y las copias para la web de documentación (docs/assets/icon-*.png, favicon).
// Uso (solo hace falta si cambias el diseño):  node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Cuadrado redondeado azul Willy SEO + calendario blanco con una "W" y un avión de papel.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5881B9"/>
      <stop offset="1" stop-color="#3D6396"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#14233A" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="232" fill="url(#bg)"/>
  <circle cx="860" cy="120" r="300" fill="#ffffff" opacity="0.07"/>
  <!-- calendario -->
  <g filter="url(#sh)">
    <rect x="150" y="230" width="640" height="610" rx="92" fill="#ffffff"/>
  </g>
  <path d="M150 322 a92 92 0 0 1 92 -92 h456 a92 92 0 0 1 92 92 v62 h-640 z" fill="#203046"/>
  <rect x="300" y="168" width="58" height="112" rx="29" fill="#DCE6F3" stroke="#203046" stroke-width="14"/>
  <rect x="582" y="168" width="58" height="112" rx="29" fill="#DCE6F3" stroke="#203046" stroke-width="14"/>
  <!-- W -->
  <path d="M262 500 L352 744 L470 560 L588 744 L678 500" fill="none" stroke="#4A73AA" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- avión de papel -->
  <g filter="url(#sh)" transform="translate(34 -14)">
    <path d="M610 612 L944 390 L842 786 L732 696 L676 752 L664 660 Z" fill="#ffffff" stroke="#203046" stroke-width="22" stroke-linejoin="round"/>
  </g>
  <path transform="translate(34 -14)" d="M664 660 L944 390 L732 696" fill="none" stroke="#4A73AA" stroke-width="18" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;

const png = (size) => sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

function buildIco(images) {
  // images: [{ size, data }]  -> ICO con PNG incrustados (Windows Vista+)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const entries = []; const blobs = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); blobs.push(data); offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = [];
for (const size of sizes) icoImages.push({ size, data: await png(size) });

fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(root, 'scripts', 'willypost.png'), await png(1024));
fs.writeFileSync(path.join(root, 'scripts', 'willypost.ico'), buildIco(icoImages));

// Copias para la web de documentación (GitHub Pages)
const assets = path.join(root, 'docs', 'assets');
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'icon-512.png'), await png(512));
fs.writeFileSync(path.join(assets, 'icon-192.png'), await png(192));
fs.writeFileSync(path.join(assets, 'favicon.png'), await png(64));
fs.writeFileSync(path.join(assets, 'favicon.ico'), buildIco(icoImages.filter((i) => i.size <= 48)));
fs.writeFileSync(path.join(assets, 'icon.svg'), svg);

console.log('Iconos generados en scripts/ y docs/assets/');
