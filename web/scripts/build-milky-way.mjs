import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const response = await fetch('https://cdn.eso.org/images/large/eso0932a.jpg')
if (!response.ok) throw new Error(`ESO Milky Way: ${response.status}`)
const target = new URL('../src/assets/map-globe/', import.meta.url)
await mkdir(target, { recursive: true })
const result = await sharp(Buffer.from(await response.arrayBuffer()))
  .resize(4096, 2048)
  .webp({ quality: 80, effort: 5 })
  .toFile(new URL('milky-way.webp', target).pathname)
console.log(`ESO Milky Way: ${result.width}×${result.height}, ${(result.size / 1024).toFixed(0)} KB`)
