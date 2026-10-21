const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'build-resources', 'icon.svg');
const outputPath = path.join(root, 'build-resources', 'icon.ico');
const sizes = '256,128,64,48,32,24,16';

if (!fs.existsSync(sourcePath)) {
  console.error(`Missing ${path.relative(root, sourcePath)}. Place your SVG there first.`);
  process.exit(1);
}

try {
  execFileSync(
    'magick',
    [
      '-background',
      'none',
      // Set a high SVG density before resizing, or ImageMagick rasterizes the 16px icon and upscales it.
      '-density',
      '1024',
      sourcePath,
      '-define',
      `icon:auto-resize=${sizes}`,
      outputPath,
    ],
    { stdio: 'inherit' },
  );
} catch (error) {
  if (error && error.code === 'ENOENT') {
    console.error('ImageMagick was not found. Install it or add magick.exe to PATH.');
  } else {
    console.error(`Could not generate ${path.relative(root, outputPath)}.`);
  }
  process.exit(1);
}

console.log(`Wrote ${path.relative(root, outputPath)} from ${path.relative(root, sourcePath)}.`);
