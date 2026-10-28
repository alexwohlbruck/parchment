import sharp from 'sharp'

const response = await fetch('https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg')
if (!response.ok) throw new Error(`NASA Moon: ${response.status}`)
const result = await sharp(Buffer.from(await response.arrayBuffer()))
  .resize(1024, 512)
  .webp({ quality: 85 })
  .toFile(new URL('../src/assets/map-globe/moon.webp', import.meta.url).pathname)
console.log(`NASA Moon: ${result.width}×${result.height}, ${(result.size / 1024).toFixed(0)} KB`)
