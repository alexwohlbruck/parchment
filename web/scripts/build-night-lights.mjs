import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const source = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/BlackMarble_2016_3km_gray.jpg'
const response = await fetch(source)
if (!response.ok) throw new Error(`NASA night lights: ${response.status}`)
const target = new URL('../src/assets/map-globe/', import.meta.url)
await mkdir(target, { recursive: true })
const result = await sharp(Buffer.from(await response.arrayBuffer()))
  .resize(4096, 2048)
  .webp({ quality: 90, effort: 6 })
  .toFile(new URL('night-lights.webp', target).pathname)
console.log(`NASA night lights: ${result.width}×${result.height}, ${(result.size / 1024).toFixed(0)} KB`)
