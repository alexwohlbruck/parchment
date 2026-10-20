import sharp from 'sharp'

const source = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_land.geojson'
const response = await fetch(source)
if (!response.ok) throw new Error(`Natural Earth land: ${response.status}`)
const land = await response.json()
const paths = land.features.flatMap(({ geometry }) => {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.map(polygon => polygon.map(ring => ring.map(([lon, lat], index) => `${index ? 'L' : 'M'}${((lon + 180) / 360 * 3072).toFixed(2)},${((90 - lat) / 180 * 1536).toFixed(2)}`).join(' ') + 'Z').join(' '))
})
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3072" height="1536"><rect width="100%" height="100%" fill="white"/><g fill="black" fill-rule="evenodd">${paths.map(d => `<path d="${d}"/>`).join('')}</g></svg>`
const result = await sharp(Buffer.from(svg)).flatten().greyscale().webp({ lossless: true, effort: 6 })
  .toFile(new URL('../src/assets/map-globe/ocean-mask.webp', import.meta.url).pathname)
console.log(`Ocean mask: ${result.width}×${result.height}, ${result.size} bytes`)
