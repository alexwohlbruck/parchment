/**
 * Where the sun is, for a place and a moment.
 *
 * The low-precision solar position from the Astronomical Almanac — the same
 * formulation SunCalc uses. It is accurate to roughly a hundredth of a degree
 * over a century either side of 2000, which is far past what a shadow on a map
 * can show, and it is forty lines rather than a dependency.
 *
 * Everything here is radians. Azimuth is measured from **north, clockwise** —
 * the compass convention, matching `Map.getBearing()` — rather than SunCalc's
 * from-south, so it can be compared with a map bearing without a correction at
 * every call site.
 */

const RAD = Math.PI / 180
/** Days from the Unix epoch to J2000.0 (2000-01-01 12:00 UT). */
const J2000_OFFSET_DAYS = 10957.5
const MS_PER_DAY = 86400000

/** Earth's axial tilt at J2000, in radians. Its drift is far below what matters here. */
const OBLIQUITY = 23.4397 * RAD

export type SunPosition = {
  /** Radians from north, clockwise. 0 = due north, π/2 = due east. */
  azimuth: number
  /** Radians above the horizon. Negative when the sun is down. */
  altitude: number
}

/** Days since J2000.0. */
function toDays(date: Date): number {
  return date.getTime() / MS_PER_DAY - J2000_OFFSET_DAYS
}

/**
 * The sun's ecliptic longitude, and from it the equatorial coordinates.
 *
 * `g` is the mean anomaly and `L` the ecliptic longitude after the equation of
 * centre — the two-term correction for Earth's orbit being an ellipse rather
 * than a circle, which is what makes solar noon wander through the year.
 */
function sunCoords(days: number) {
  const g = (357.5291 + 0.98560028 * days) * RAD
  const L = g + (1.9148 * Math.sin(g) + 0.02 * Math.sin(2 * g) + 0.0003 * Math.sin(3 * g)) * RAD
    + 102.9372 * RAD + Math.PI
  return {
    declination: Math.asin(Math.sin(OBLIQUITY) * Math.sin(L)),
    rightAscension: Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L)),
  }
}

/**
 * The sun's position over `lat`/`lng` at `date`.
 *
 * @param lat degrees north
 * @param lng degrees east
 */
export function sunPosition(date: Date, lat: number, lng: number): SunPosition {
  const days = toDays(date)
  const { declination, rightAscension } = sunCoords(days)

  // Sidereal time at the observer's meridian, minus the sun's right ascension,
  // is how far the sun sits from due south.
  const siderealTime = (280.16 + 360.9856235 * days) * RAD + lng * RAD
  const hourAngle = siderealTime - rightAscension

  const phi = lat * RAD
  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(declination) +
    Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle),
  )
  // atan2 here gives the angle from due south; adding π turns it into a compass
  // bearing from north.
  const fromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi),
  )
  const azimuth = (fromSouth + Math.PI) % (2 * Math.PI)

  return { azimuth, altitude }
}
