import SunCalc from 'suncalc'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

export function getSubSolarPoint(date: Date): { lat: number; lng: number } {
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  const lng = (12 - utcH) * 15

  const pos = SunCalc.getPosition(date, 0, lng)
  const absDecl = Math.PI / 2 - pos.altitude

  const posNorth = SunCalc.getPosition(date, 45, lng)
  const posSouth = SunCalc.getPosition(date, -45, lng)
  const lat = (posNorth.altitude > posSouth.altitude ? absDecl : -absDecl) * RAD2DEG

  return { lat, lng: ((lng % 360) + 540) % 360 - 180 }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function getDayNightColor(angularDistDeg: number): [number, number, number, number] {
  if (angularDistDeg < 87) return [0, 0, 0, 0]
  if (angularDistDeg >= 105) return [0, 0, 15, 170]

  const night = smoothstep(87, 105, angularDistDeg)

  const r = 0
  const g = 0
  const b = Math.round(lerp(0, 15, night))
  const a = Math.round(lerp(0, 170, night))

  return [r, g, b, a]
}

export function renderDayNightImage(width: number, height: number): string {
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
    const lat = (0.5 - y / height) * Math.PI
    const sinLat = Math.sin(lat)
    const cosLat = Math.cos(lat)

    for (let x = 0; x < width; x++) {
      const lng = (x / width - 0.5) * 2 * Math.PI
      const cosD = sinSunLat * sinLat + cosSunLat * cosLat * Math.cos(lng - sunLngRad)
      const d = Math.acos(Math.max(-1, Math.min(1, cosD))) * RAD2DEG

      const [r, g, b, a] = getDayNightColor(d)
      const idx = (y * width + x) * 4
      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = b
      data[idx + 3] = a
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}
