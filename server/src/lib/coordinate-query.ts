/**
 * Recognises a search query that is a coordinate pair rather than a place
 * name, in the shapes people paste from other apps: decimal pairs with or
 * without brackets, hemisphere letters, degrees-minutes-seconds, `geo:` URIs,
 * map URLs and plus codes.
 */
import { decode as decodePlusCode, expand as expandPlusCode } from 'pluscodes'

export interface LatLng {
  lat: number
  lng: number
}

// One axis: degrees, optional minutes and seconds, and an optional hemisphere
// letter either before or after. The two placements are separate patterns,
// because with both optional "N40.7 W73.9" reads W as trailing the first axis.
// Runs on normalised input, where primes are already ASCII ' and ".
const NUMBER =
  String.raw`([-+]?\d{1,3}(?:\.\d+)?)\s*(°)?\s*` +
  String.raw`(?:(\d{1,2}(?:\.\d+)?)\s*'\s*(?:(\d{1,2}(?:\.\d+)?)\s*"\s*)?)?`
const pair = (axis: string) => new RegExp(String.raw`^${axis}\s*([,;/]?)\s*${axis}$`, 'i')
const PAIRS = [
  { re: pair(String.raw`([NSEW])\s*${NUMBER}`), letterFirst: true },
  { re: pair(String.raw`${NUMBER}\s*([NSEW])`), letterFirst: false },
  { re: pair(NUMBER), letterFirst: null },
]

// Brackets people wrap a pair in, e.g. "(40.71, -73.99)" from a Python print.
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' }

// `lat: 40.71, lng: -73.99` or `lat=40.71&lon=-73.99`
const LABEL = /\b(?:lat(?:itude)?|lng|lon(?:g(?:itude)?)?)\s*[:=]\s*/gi

/**
 * `reference` is the point a short plus code ("PX7V+4H") is recovered near —
 * the map centre, typically. Without one, short codes aren't recognised.
 */
export function parseCoordinateQuery(query: string, reference?: LatLng): LatLng | null {
  const fromUrl = parseMapUrl(query.trim())
  if (fromUrl) return fromUrl

  const plusCode = parsePlusCode(query)
  if (plusCode) {
    if (!plusCode.short) return decodePlus(plusCode.code)
    // A named locality says where to recover the code; the map centre
    // could be anywhere else, so leave it to a caller that can geocode it.
    if (plusCode.locality || !reference) return null
    return recoverShortPlusCode(plusCode.code, reference)
  }

  let text = normalise(query)
  if (text.toLowerCase().startsWith('geo:')) text = text.slice(4).split(/[;?]/)[0]
  text = stripBrackets(text).replace(LABEL, '').replace(/&/g, ',').trim()

  for (const { re, letterFirst } of PAIRS) {
    const m = text.match(re)
    if (m) return fromMatch(m, letterFirst)
  }
  return null
}

function fromMatch(m: RegExpMatchArray, letterFirst: boolean | null): LatLng | null {
  // Without letters there are 4 groups per axis; a letter adds a fifth.
  const width = letterFirst === null ? 4 : 5
  const axis = (start: number) => {
    const g = m.slice(start, start + width)
    const letter = letterFirst === null ? undefined : letterFirst ? g.shift() : g.pop()
    const [deg, degSign, min, sec] = g
    return { deg, degSign, min, sec, hemi: letter?.toUpperCase() as Hemisphere | undefined }
  }
  const one = axis(1)
  const separator = m[1 + width]
  const two = axis(2 + width)

  // A pair split only by whitespace needs some marker of being a coordinate,
  // or "123 45" (a house number and a street) would be read as one.
  const marked = one.hemi || one.degSign || two.degSign || one.min || two.min
  if (!separator && !marked && !(one.deg.includes('.') && two.deg.includes('.'))) return null

  const a = toDecimal(one.deg, one.min, one.sec)
  const b = toDecimal(two.deg, two.min, two.sec)
  if (a === null || b === null) return null

  if (!one.hemi || !two.hemi) return validateAndNormalizeCoords(a, b)
  return fromHemispheres(a, one.hemi, b, two.hemi)
}

// Open Location Code alphabet. A full code has 8 digits before the "+"; a
// short one drops the first 2 or 4 and is recovered near a reference point.
const OLC = '[23456789CFGHJMPQRVWX]'
const PLUS_CODE = new RegExp(String.raw`^(${OLC}{8}|${OLC}{4}|${OLC}{6})\+(${OLC}{2,3})?(?:[\s,]+(.+))?$`, 'i')

export interface PlusCodeQuery {
  code: string
  short: boolean
  /** The place a short code is relative to, as in "PX7V+4H New York, NY". */
  locality?: string
}

export function parsePlusCode(query: string): PlusCodeQuery | null {
  const m = query.trim().match(PLUS_CODE)
  if (!m) return null
  const [, head, tail = '', locality] = m
  // A full code can't carry a locality; "87G7PX7V+4H Foo" isn't a code.
  if (head.length === 8 && locality) return null
  // pluscodes reads two digits after the "+"; an 11th refines a 14 m cell
  // to 3 m, which a search result doesn't need.
  const code = `${head}+${tail.slice(0, 2)}`.toUpperCase()
  return { code, short: head.length < 8, locality: locality?.trim() || undefined }
}

/** The centre of a short plus code's cell, taken nearest `reference`. */
export function recoverShortPlusCode(code: string, reference: LatLng): LatLng | null {
  const full = expandPlusCode(code, { latitude: reference.lat, longitude: reference.lng })
  return full ? decodePlus(full) : null
}

function decodePlus(code: string): LatLng | null {
  const decoded = decodePlusCode(code)
  return decoded ? validateAndNormalizeCoords(decoded.latitude, decoded.longitude, false) : null
}

function normalise(query: string): string {
  return query
    .trim()
    .replace(/[−–—]/g, '-') // minus sign and dashes
    .replace(/[º˚]/g, '°')
    .replace(/[′’‘`]|''/g, (c) => (c === "''" ? '"' : "'"))
    .replace(/[″“”]/g, '"')
}

function stripBrackets(text: string): string {
  let out = text
  while (out.length > 1 && BRACKETS[out[0]] === out[out.length - 1]) {
    out = out.slice(1, -1).trim()
  }
  return out
}

/**
 * Pulls the point out of a pasted map link: Google's `@lat,lng,zoom` path and
 * `q=` / `ll=` / `query=` parameters, OSM's `#map=zoom/lat/lng` and
 * `mlat`/`mlon`.
 */
function parseMapUrl(text: string): LatLng | null {
  if (!/^https?:\/\//i.test(text)) return null
  let url: string
  try {
    url = decodeURIComponent(text)
  } catch {
    url = text
  }

  const num = String.raw`(-?\d{1,3}(?:\.\d+)?)`
  const pair =
    url.match(new RegExp(String.raw`[?&](?:q|ll|query|destination)=${num},\s*${num}`)) ??
    url.match(new RegExp(String.raw`@${num},${num}`))
  if (pair) return validateAndNormalizeCoords(parseFloat(pair[1]), parseFloat(pair[2]), false)

  const osmMarker = url.match(new RegExp(String.raw`[?&]mlat=${num}&mlon=${num}`))
  if (osmMarker) return validateAndNormalizeCoords(parseFloat(osmMarker[1]), parseFloat(osmMarker[2]), false)

  const osmView = url.match(new RegExp(String.raw`#map=\d+(?:\.\d+)?/${num}/${num}`))
  if (osmView) return validateAndNormalizeCoords(parseFloat(osmView[1]), parseFloat(osmView[2]), false)

  return null
}

type Hemisphere = 'N' | 'S' | 'E' | 'W'

function toDecimal(deg: string, min?: string, sec?: string): number | null {
  const d = parseFloat(deg)
  const m = min ? parseFloat(min) : 0
  const s = sec ? parseFloat(sec) : 0
  if (m >= 60 || s >= 60) return null
  // Minutes on a fractional degree ("40.5°30'") mean nothing.
  if ((min || sec) && deg.includes('.')) return null
  const magnitude = Math.abs(d) + m / 60 + s / 3600
  const value = d < 0 || deg.startsWith('-') ? -magnitude : magnitude
  // DMS converts to long binary fractions; 7 places is about a centimetre.
  return Math.round(value * 1e7) / 1e7
}

/** Places each value on the axis its hemisphere letter names, in either order. */
function fromHemispheres(a: number, hemiA: Hemisphere, b: number, hemiB: Hemisphere): LatLng | null {
  // A letter already carries the sign; "-40.7 S" is a contradiction, not a double negative.
  if (a < 0 || b < 0) return null

  const isLat = (h: Hemisphere) => h === 'N' || h === 'S'
  if (isLat(hemiA) === isLat(hemiB)) return null

  const signed = (v: number, h: Hemisphere) => (h === 'S' || h === 'W' ? -v : v)
  const [lat, lng] = isLat(hemiA)
    ? [signed(a, hemiA), signed(b, hemiB)]
    : [signed(b, hemiB), signed(a, hemiA)]
  return validateAndNormalizeCoords(lat, lng, false)
}

/**
 * Accepts `a, b` as lat, lng, or swaps them when only the other order is in
 * range (someone typed lng, lat). `allowSwap` is off when the order is known.
 */
export function validateAndNormalizeCoords(a: number, b: number, allowSwap = true): LatLng | null {
  if (!isFinite(a) || !isFinite(b)) return null

  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    return { lat: a, lng: b }
  }

  if (allowSwap && Math.abs(b) <= 90 && Math.abs(a) <= 180) {
    return { lat: b, lng: a }
  }

  return null
}
