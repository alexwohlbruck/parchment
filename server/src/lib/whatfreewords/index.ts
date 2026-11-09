/**
 * Three-word addresses (what3words), computed locally.
 *
 * what3words is a fixed, deterministic grid of 3 m squares, but the company
 * keeps the algorithm closed and only sells conversions through a paid API.
 * WhatFreeWords (2019) is an independent, compatible reimplementation; this
 * is a port of its JavaScript library to TypeScript with native BigInt, so
 * conversions work on the server and offline in the client without a key.
 * English only — the one word list it recovered. See README.md for the
 * data's provenance and encoding.
 */

export interface LatLng {
  lat: number
  lng: number
}

export interface WhatFreeWords {
  /** "filled.count.soap", or null where the grid has no square. */
  latLngToWords(lat: number, lng: number): string | null
  /** The centre of the square, or null for words not on the list. */
  wordsToLatLng(words: string): LatLng | null
}

// The separators what3words accepts between words, besides ".".
const SEPARATORS = '｡。･・︒។։။۔።।'
const WORDS = String.raw`\p{L}+[.${SEPARATORS}]\p{L}+[.${SEPARATORS}]\p{L}+`
const QUERY = new RegExp(
  String.raw`^(?:\/{3}|https?:\/\/(?:www\.)?(?:w3w\.co|what3words\.com)\/)?(${WORDS})\/?$`,
  'u',
)

/**
 * The three-word address a query names — "///filled.count.soap",
 * "filled.count.soap" or a w3w.co / what3words.com link — normalised to
 * lowercase words joined by dots. Whether the words exist is for
 * `wordsToLatLng` to say; a host name like "maps.google.com" parses here.
 */
export function parseWhat3words(query: string): string | null {
  const m = query.trim().match(QUERY)
  if (!m) return null
  return m[1].replace(new RegExp(`[${SEPARATORS}]`, 'gu'), '.').toLowerCase()
}

let loading: Promise<WhatFreeWords> | null = null

/**
 * Loads the word list and region table (about 0.7 MB over gzip) on first
 * use; later calls share it. Rejects if the data can't be fetched.
 */
export function loadWhatFreeWords(): Promise<WhatFreeWords> {
  loading ??= load().catch(err => {
    loading = null
    throw err
  })
  return loading
}

async function load(): Promise<WhatFreeWords> {
  // A file: URL under Bun, an emitted asset under Vite.
  const [wordsRes, regionsRes] = await Promise.all([
    fetch(new URL('./whatfreewords-words.txt', import.meta.url)),
    fetch(new URL('./whatfreewords-regions.bin', import.meta.url)),
  ])
  if (!wordsRes.ok || !regionsRes.ok) throw new Error('Could not load the what3words data')
  const words = (await wordsRes.text()).trimEnd().split('\n')
  const regions = decodeRegions(new Uint8Array(await regionsRes.arrayBuffer()))
  return createWhatFreeWords(words, regions)
}

/** Grid rows: 1/24° each, 4320 from pole to pole. */
const ROWS = 4320
/** Squares along a cell's latitude. */
const CELL_HEIGHT = 1546

/** One run of cells on a grid row: [x, y, length, first square number]. */
type Region = [number, number, number, number]

/** Square columns per cell at row `y`, narrowing toward the poles. */
function cellWidth(y: number): number {
  return Math.max(1, Math.floor(CELL_HEIGHT * Math.sin(((y + 0.5) / 24) * (Math.PI / 180))))
}

/**
 * The region table as encoded by README.md: a count, then three varint
 * columns — zigzag row delta, zigzag gap from the previous run's end,
 * and run length. Square numbers accumulate in table order.
 */
export function decodeRegions(bytes: Uint8Array): Region[] {
  let pos = 0
  const read = () => {
    let v = 0
    let scale = 1
    for (;;) {
      const b = bytes[pos++]
      v += (b & 127) * scale
      if (b < 128) return v
      scale *= 128
    }
  }
  const unzigzag = (v: number) => (v % 2 ? -(v + 1) / 2 : v / 2)

  const n = read()
  const dy = Array.from({ length: n }, read)
  const gap = Array.from({ length: n }, read)
  const len = Array.from({ length: n }, read)

  const regions: Region[] = []
  let x = 0
  let y = 0
  let q = 0
  for (let i = 0; i < n; i++) {
    y += unzigzag(dy[i])
    x += unzigzag(gap[i])
    regions.push([x, y, len[i], q])
    q += len[i] * cellWidth(y) * CELL_HEIGHT
    x += len[i]
  }
  return regions
}

/**
 * Each block of square numbers is permuted by multiplying with a constant
 * modulo the block size: [start, size, forward factor, inverse factor].
 */
const SHUFFLE_BLOCKS: Array<[bigint, bigint, bigint, bigint]> = [
  [0n, 15625000000n, 9401181441n, 12459868161n],
  [15625000000n, 109375000000n, 87526181441n, 12459868161n],
  [125000000000n, 296875000000n, 118776181441n, 184334868161n],
  [421875000000n, 578125000000n, 525026181441n, 418709868161n],
  [1000000000000n, 953125000000n, 337526181441n, 840584868161n],
  [1953125000000n, 1421875000000n, 1400026181441n, 668709868161n],
  [3375000000000n, 1984375000000n, 1790651181441n, 59334868161n],
  [5359375000000n, 2640625000000n, 2618776181441n, 59334868161n],
  [8000000000000n, 3390625000000n, 2275026181441n, 778084868161n],
  [11390625000000n, 4234375000000n, 228151181441n, 1934334868161n],
  [15625000000000n, 5171875000000n, 1228151181441n, 3934334868161n],
  [20796875000000n, 6203125000000n, 2673590513073n, 1560207133137n],
  [27000000000000n, 7328125000000n, 2275026181441n, 1434334868161n],
  [34328125000000n, 8546875000000n, 7962526181441n, 1949959868161n],
  [42875000000000n, 9859375000000n, 1587526181441n, 403084868161n],
  [52734375000000n, 11265625000000n, 11025026181441n, 7778084868161n],
]

function shuffle(value: number, factorIndex: 2 | 3): number | null {
  const v = BigInt(value)
  for (const block of SHUFFLE_BLOCKS) {
    const [start, size] = block
    if (v >= start && v < start + size) {
      return Number(((v - start) * block[factorIndex]) % size + start)
    }
  }
  return null
}

export function createWhatFreeWords(words: string[], regions: Region[]): WhatFreeWords {
  const wordIndex = new Map(words.map((w, i) => [w, i]))
  const byRow: Region[][] = Array.from({ length: ROWS }, () => [])
  for (const r of regions) byRow[r[1]].push(r)
  for (const row of byRow) row.sort((a, b) => a[0] - b[0])

  /** First square number of cell (x, y), or null off the grid. */
  function cellStart(x: number, y: number): number | null {
    const row = byRow[y]
    if (!row) return null
    let lo = 0
    let hi = row.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const [x1, , length, q] = row[mid]
      if (x >= x1 && x < x1 + length) return q + (x - x1) * cellWidth(y) * CELL_HEIGHT
      if (x < x1) hi = mid
      else lo = mid + 1
    }
    return null
  }

  /** The cell holding square number n: [x, y, its first square number]. */
  function cellOf(n: number): [number, number, number] | null {
    let lo = 0
    let hi = regions.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const [x1, y, length, start] = regions[mid]
      const size = cellWidth(y) * CELL_HEIGHT
      if (n >= start && n < start + length * size) {
        const i = Math.floor((n - start) / size)
        return [x1 + i, y, start + i * size]
      }
      if (n < start) hi = mid
      else lo = mid + 1
    }
    return null
  }

  // A square's number m is spread over three word indices (i, j, k) shell
  // by shell, where l = max(i, j, k).
  function toIndices(m: number): [number, number, number] {
    let l = Math.floor(Math.cbrt(m))
    // Floating-point cube roots can land just under an exact cube.
    while ((l + 1) ** 3 <= m) l++
    while (l ** 3 > m) l--
    const l2 = l * l
    const l3 = l2 * l
    if (m < l3 + l2 + 2 * l + 1) {
      const r = m - l3
      return [l, Math.floor(r / (l + 1)), r % (l + 1)]
    }
    if (m < l3 + 2 * l2 + 3 * l + 1) {
      const r = m - (l3 + l2 + 2 * l + 1)
      return [Math.floor(r / (l + 1)), l, r % (l + 1)]
    }
    const r = m - (l3 + 2 * l2 + 3 * l + 1)
    return [Math.floor(r / l), r % l, l]
  }

  function fromIndices(i: number, j: number, k: number): number {
    const l = Math.max(i, j, k)
    const l2 = l * l
    const l3 = l2 * l
    if (i === l) return l3 + (l + 1) * j + k
    if (j === l) return l3 + l2 + 2 * l + 1 + (l + 1) * i + k
    return l3 + 2 * l2 + 3 * l + 1 + l * i + j
  }

  const frac = (v: number) => v - Math.floor(v)

  return {
    latLngToWords(lat, lng) {
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null
      const X = Math.floor((lng + 180) * 24)
      const Y = Math.floor((lat + 90) * 24)
      const x = Math.floor(cellWidth(Y) * frac((lng + 180) * 24))
      const y = Math.floor(CELL_HEIGHT * frac((lat + 90) * 24))
      const start = cellStart(X, Y)
      if (start === null) return null
      const m = shuffle(start + x * CELL_HEIGHT + y, 2)
      if (m === null) return null
      const names = toIndices(m).map(i => words[i])
      return names.every(Boolean) ? names.join('.') : null
    },

    wordsToLatLng(address) {
      const parts = address.toLowerCase().split('.')
      if (parts.length !== 3) return null
      const indices = parts.map(w => wordIndex.get(w))
      if (indices.some(i => i === undefined)) return null
      const n = shuffle(fromIndices(indices[0]!, indices[1]!, indices[2]!), 3)
      if (n === null) return null
      const cell = cellOf(n)
      if (!cell) return null
      const [X, Y, start] = cell
      const offset = n - start
      const x = Math.floor(offset / CELL_HEIGHT)
      const y = offset - x * CELL_HEIGHT
      const lat = (Y + (y + 0.5) / CELL_HEIGHT) / 24 - 90
      const lng = (X + (x + 0.5) / cellWidth(Y)) / 24 - 180
      return {
        lat: Math.round(lat * 1e6) / 1e6,
        lng: Math.round(lng * 1e6) / 1e6,
      }
    },
  }
}
