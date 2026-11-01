// Regenerate the extension PNGs from the font-independent SVG source.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const directory = path.resolve(__dirname, '../ai-rtl/icons');
const source = fs.readFileSync(path.join(directory, 'icon.svg'));
Promise.all([16, 32, 48, 128].map(async (size) => {
  await sharp(source, { density: 384 }).resize(size, size).png().toFile(path.join(directory, `icon${size}.png`));
  console.log(`RTL icon: ${size}x${size}`);
})).catch((error) => { console.error(error); process.exitCode = 1; });
