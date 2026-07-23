/**
 * Gera ícones PWA a partir de uma imagem JPG de origem usando apenas
 * o módulo 'fs' do Node.js e a biblioteca 'jimp' (sem binários nativos).
 *
 * Uso: node generate-icons.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Tenta usar jimp (sem binários nativos)
async function run() {
  let Jimp;
  try {
    ({ Jimp } = await import('jimp'));
  } catch {
    console.log('jimp não encontrado — instalando...');
    const { execSync } = require('child_process');
    execSync('npm install jimp --no-save', { stdio: 'inherit', cwd: __dirname });
    ({ Jimp } = await import('jimp'));
  }

  const inputFile = path.join(__dirname, 'public', 'icons', 'icon-source.jpg');
  const outputDir = path.join(__dirname, 'public', 'icons');

  if (!fs.existsSync(inputFile)) {
    console.error('Arquivo não encontrado:', inputFile);
    process.exit(1);
  }

  const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];
  const image = await Jimp.read(inputFile);

  for (const size of sizes) {
    const clone = image.clone().resize({ w: size, h: size });
    await clone.write(path.join(outputDir, `icon-${size}x${size}.png`));
    console.log(`✓ icon-${size}x${size}.png`);
  }

  // Maskable (com padding de ~10%)
  const maskable = image.clone().resize({ w: 462, h: 462});
  // Cria canvas 512x512 com background escuro
  const bg = new Jimp({ width: 512, height: 512, color: 0x1a1714ff });
  bg.composite(maskable, 25, 25);
  await bg.write(path.join(outputDir, 'maskable-icon-512x512.png'));
  console.log('✓ maskable-icon-512x512.png');

  // Apple touch icon
  const apple = image.clone().resize({ w: 180, h: 180 });
  await apple.write(path.join(outputDir, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png');

  // Favicons
  const fav32 = image.clone().resize({ w: 32, h: 32 });
  await fav32.write(path.join(outputDir, 'favicon-32x32.png'));
  console.log('✓ favicon-32x32.png');

  const fav16 = image.clone().resize({ w: 16, h: 16 });
  await fav16.write(path.join(outputDir, 'favicon-16x16.png'));
  console.log('✓ favicon-16x16.png');

  // OG Image 1200x630
  const og = image.clone().resize({ w: 1200, h: 630 });
  await og.write(path.join(outputDir, 'og-image.png'));
  console.log('✓ og-image.png');

  console.log('\n✅ Todos os ícones gerados com sucesso!');
  console.log(`📁 Pasta: ${outputDir}`);
}

run().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
