import sharp from 'sharp'
import { buildTransmittanceLookup, TRANSMITTANCE_WIDTH, TRANSMITTANCE_HEIGHT } from '../src/lib/map-globe/atmosphere'

const result = await sharp(buildTransmittanceLookup(), {
  raw: { width: TRANSMITTANCE_WIDTH, height: TRANSMITTANCE_HEIGHT, channels: 3 },
}).png().toFile(new URL('../src/assets/map-globe/transmittance.png', import.meta.url).pathname)
console.log(`Atmosphere transmission: ${result.width}×${result.height}, ${result.size} bytes`)
