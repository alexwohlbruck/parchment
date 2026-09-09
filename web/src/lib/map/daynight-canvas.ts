import SunCalc from 'suncalc'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

function getSubSolarPoint(date: Date): { lat: number; lng: number } {
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  const lng = (12 - utcH) * 15

  const pos = SunCalc.getPosition(date, 0, lng)
  const absDecl = Math.PI / 2 - pos.altitude

  const posNorth = SunCalc.getPosition(date, 45, lng)
  const posSouth = SunCalc.getPosition(date, -45, lng)
  const lat = (posNorth.altitude > posSouth.altitude ? absDecl : -absDecl) * RAD2DEG

  return { lat, lng: ((lng % 360) + 540) % 360 - 180 }
}

function getPixelColor(angularDistDeg: number): [number, number, number, number] {
  if (angularDistDeg < 87) return [0, 0, 0, 0]

  // Pre-terminator warm glow
  if (angularDistDeg < 90) {
    const t = (angularDistDeg - 87) / 3
    return [255, 120, 40, t * 0.06]
  }

  // Civil twilight — warm sunset fading into cool darkness
  if (angularDistDeg < 96) {
    const t = (angularDistDeg - 90) / 6
    const r = Math.round(255 * (1 - t * t) + 10 * t * t)
    const g = Math.round(100 * (1 - t * t) + 10 * t * t)
    const b = Math.round(40 * (1 - t) + 50 * t)
    const a = 0.06 + t * 0.24
    return [r, g, b, a]
  }

  // Nautical + astronomical twilight
  if (angularDistDeg < 108) {
    const t = (angularDistDeg - 96) / 12
    const a = 0.3 + t * 0.15
    return [8, 8, Math.round(40 - 15 * t), a]
  }

  // Full night
  return [5, 5, 20, 0.45]
}

export function renderDayNightCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.createImageData(width, height)
  const data = imageData.data

  const now = new Date()
  const sun = getSubSolarPoint(now)
  const sunLatRad = sun.lat * DEG2RAD
  const sunLngRad = sun.lng * DEG2RAD
  const sinSunLat = Math.sin(sunLatRad)
  const cosSunLat = Math.cos(sunLatRad)

  for (let y = 0; y < height; y++) {
    const lat = (0.5 - y / height) * 170 * DEG2RAD
    const sinLat = Math.sin(lat)
    const cosLat = Math.cos(lat)

    for (let x = 0; x < width; x++) {
      const lng = (x / width - 0.5) * 360 * DEG2RAD
      const cosD = sinSunLat * sinLat + cosSunLat * cosLat * Math.cos(lng - sunLngRad)
      const d = Math.acos(Math.max(-1, Math.min(1, cosD))) * RAD2DEG

      const [r, g, b, a] = getPixelColor(d)
      const idx = (y * width + x) * 4
      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = b
      data[idx + 3] = Math.round(a * 255)
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}
