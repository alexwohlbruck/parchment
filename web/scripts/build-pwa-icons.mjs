/**
 * Generate the PWA icon set into public/icons/ from the Tauri app icon
 * (the only full-bleed raster of the mark in the repo).
 *
 * Outputs are committed, like the sprite and glyph builds — run again only
 * when the app icon changes:  bun run build:pwa-icons
 *
 * The maskable variant scales the art to ~80% over the icon's own edge
 * colour, so launchers that crop to a circle keep the mark inside the safe
 * zone instead of clipping its corners.
 */
import sharp from 'sharp'
import { mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SOURCE = path.join(root, 'src-tauri/icons/icon.png')
const OUT_DIR = path.join(root, 'public/icons')

mkdirSync(OUT_DIR, { recursive: true })

const { data } = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true })
const edge = { r: data[0], g: data[1], b: data[2], alpha: 1 }

async function plain(size, name) {
  await sharp(SOURCE)
    .resize(size, size)
    .png()
    .toFile(path.join(OUT_DIR, name))
}

async function maskable(size, name) {
  const inner = Math.round(size * 0.8)
  const margin = Math.round((size - inner) / 2)
  const art = await sharp(SOURCE).resize(inner, inner).png().toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: edge },
  })
    .composite([{ input: art, top: margin, left: margin }])
    .png()
    .toFile(path.join(OUT_DIR, name))
}

await plain(192, 'pwa-192.png')
await plain(512, 'pwa-512.png')
await plain(180, 'apple-touch-icon.png')
await maskable(512, 'maskable-512.png')

console.log('PWA icons written to public/icons/')
