const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const inputFile = path.join(__dirname, 'public', 'icons', 'icon-source.jpg');
const outputDir = path.join(__dirname, 'public', 'icons');

async function generateIcons() {
  for (const size of sizes) {
    const outputFile = path.join(outputDir, `icon-${size}x${size}.png`);
    await sharp(inputFile)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(outputFile);
    console.log(`Generated: icon-${size}x${size}.png`);
  }

  // Maskable icon (with padding)
  await sharp(inputFile)
    .resize(462, 462, { fit: 'cover' })
    .extend({ top: 25, bottom: 25, left: 25, right: 25, background: { r: 26, g: 23, b: 20, alpha: 1 } })
    .resize(512, 512)
    .png()
    .toFile(path.join(outputDir, 'maskable-icon-512x512.png'));
  console.log('Generated: maskable-icon-512x512.png');

  // Apple touch icon (180x180)
  await sharp(inputFile)
    .resize(180, 180, { fit: 'cover' })
    .png()
    .toFile(path.join(outputDir, 'apple-touch-icon.png'));
  console.log('Generated: apple-touch-icon.png');

  // Favicon 32x32
  await sharp(inputFile)
    .resize(32, 32, { fit: 'cover' })
    .png()
    .toFile(path.join(outputDir, 'favicon-32x32.png'));
  console.log('Generated: favicon-32x32.png');

  // Favicon 16x16
  await sharp(inputFile)
    .resize(16, 16, { fit: 'cover' })
    .png()
    .toFile(path.join(outputDir, 'favicon-16x16.png'));
  console.log('Generated: favicon-16x16.png');

  // OG Image 1200x630
  await sharp(inputFile)
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .png()
    .toFile(path.join(outputDir, 'og-image.png'));
  console.log('Generated: og-image.png');

  console.log('\nAll icons generated successfully!');
}

generateIcons().catch(console.error);
