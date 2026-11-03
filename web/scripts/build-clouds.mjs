import sharp from 'sharp'

const source = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif'
const response = await fetch(source)
if (!response.ok) throw new Error(`NASA clouds: ${response.status}`)
const pixels = Buffer.from(await response.arrayBuffer())
const result = await sharp(pixels).resize(3072, 1536).greyscale().webp({ quality: 70, effort: 6 })
  .toFile(new URL('../src/assets/map-globe/clouds.webp', import.meta.url).pathname)
console.log(`Clouds: ${result.width}×${result.height}, ${result.size} bytes`)
