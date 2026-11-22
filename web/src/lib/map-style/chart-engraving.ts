/**
 * The engraver's marks a sea chart lays over its colour washes: the coast
 * inked and lined out to sea, the sea scored with fine ripples, woods
 * stippled with tree tufts, and the sheet itself grained and browned at the
 * edges. Every mark is a pattern or a line on tiles already loaded, so the
 * whole chart costs a handful of layers and one fixed overlay.
 */
import type { FlavorId } from './build'
import { SOURCE } from './build'
import { FACADE_STYLE } from '@/lib/map/facade-shader'
import { DETAIL_COLORS } from './detail-layers'

export const SEA_PATTERN = 'chart-sea'
export const WOOD_PATTERN = 'chart-wood'
export const CHART_PATTERNS = [SEA_PATTERN, WOOD_PATTERN]

const INK: Record<FlavorId, { coast: string; sea: string; wood: string }> = {
  light: { coast: 'hsl(203, 40%, 26%)', sea: 'hsl(200, 36%, 32%)', wood: 'hsl(80, 34%, 24%)' },
  dark: { coast: 'hsl(190, 22%, 50%)', sea: 'hsl(190, 20%, 46%)', wood: 'hsl(78, 22%, 52%)' },
}

/**
 * Lines inside the coast, nearest first. Offsets stay under the tiles' 8 px
 * buffer: past it the rings drawn along a tile's clipped edge come into view.
 */
const LINING = [
  { offset: 2.4, opacity: 0.4 },
  { offset: 4.8, opacity: 0.24 },
  { offset: 7.2, opacity: 0.12 },
]

export const patternId = (name: string, flavor: FlavorId) => `${name}-${flavor}`

function seaLayers(flavor: FlavorId): any[] {
  const ink = INK[flavor]
  const WATER = { source: SOURCE, 'source-layer': 'water', filter: ['!=', 'intermittent', 1] }
  return [
    {
      id: 'Chart sea engraving',
      type: 'fill',
      ...WATER,
      minzoom: 5,
      paint: { 'fill-pattern': patternId(SEA_PATTERN, flavor), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 7, 0.8] },
    },
    ...LINING.map(({ offset, opacity }, i) => ({
      id: `Chart sea lining ${i + 1}`,
      type: 'line',
      ...WATER,
      minzoom: 3,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ink.sea, 'line-width': 0.7, 'line-offset': offset, 'line-opacity': opacity },
    })),
    {
      id: 'Chart coastline',
      type: 'line',
      ...WATER,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ink.coast,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 10, 1.1, 16, 1.6],
        'line-opacity': 0.75,
      },
    },
  ]
}

function woodLayer(flavor: FlavorId): any {
  return {
    id: 'Chart wood tufts',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landcover',
    filter: ['==', 'class', 'wood'],
    minzoom: 8,
    maxzoom: 16,
    paint: {
      'fill-pattern': patternId(WOOD_PATTERN, flavor),
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 10, 0.85, 15, 0.85, 16, 0],
    },
  }
}

/** The street-zoom details in the chart's inks: paving, courts and panels in sepia and slate rather than blue-grey. */
const DETAILS: Record<FlavorId, Partial<Record<keyof (typeof DETAIL_COLORS)['light'], string>>> = {
  light: {
    parking: 'hsl(36, 22%, 78%)',
    parkingCasing: 'hsl(32, 22%, 66%)',
    furniture: 'hsl(28, 20%, 42%)',
    coaster: 'hsl(28, 18%, 45%)',
    courtHard: 'hsl(188, 18%, 66%)',
    courtAsphalt: 'hsl(34, 12%, 70%)',
    field: 'hsl(66, 28%, 68%)',
    solar: 'hsl(40, 20%, 78%)',
    solarPanel: 'hsl(205, 22%, 38%)',
    golfRough: 'hsl(66, 26%, 68%)',
    golfFairway: 'hsl(64, 34%, 76%)',
    golfGreen: 'hsl(62, 38%, 80%)',
  },
  dark: {
    parking: 'hsl(32, 16%, 21%)',
    parkingCasing: 'hsl(30, 18%, 15%)',
    furniture: 'hsl(36, 14%, 40%)',
    coaster: 'hsl(36, 14%, 52%)',
    courtHard: 'hsl(195, 16%, 24%)',
    courtAsphalt: 'hsl(32, 10%, 24%)',
    field: 'hsl(75, 18%, 22%)',
    solar: 'hsl(32, 14%, 18%)',
    solarPanel: 'hsl(205, 20%, 28%)',
  },
}

/** Every use of a detail colour, wherever it sits in a paint expression, in the chart's ink for it. */
function inChartInks(layer: any, swaps: Map<string, string>): any {
  if (!layer.paint) return layer
  const swap = (value: any): any =>
    typeof value === 'string' ? swaps.get(value) ?? value : Array.isArray(value) ? value.map(swap) : value
  return { ...layer, paint: Object.fromEntries(Object.entries(layer.paint).map(([key, value]) => [key, swap(value)])) }
}

/**
 * The layers spliced in: the sea's marks over the water, tufts over the woods, and buildings in plain walls, as a model of the town
 * rather than its glass.
 */
export function withChartEngraving(layers: any[], flavor: FlavorId): any[] {
  const base = DETAIL_COLORS[flavor] as Record<string, string>
  const swaps = new Map(Object.entries(DETAILS[flavor]).map(([name, ink]) => [base[name], ink as string]))
  return layers.map(layer => inChartInks(layer, swaps)).flatMap(layer =>
    layer.id === 'Water' ? [layer, ...seaLayers(flavor)]
      : layer.id === 'Wood' ? [layer, woodLayer(flavor)]
      : layer.type === 'fill-extrusion' && layer.paint?.['fill-extrusion-facade-style'] !== undefined
        ? [{ ...layer, paint: { ...layer.paint, 'fill-extrusion-facade-style': FACADE_STYLE.plain } }]
      : [layer])
}

/** A layer only the engraved chart draws; its presence marks the style as one. */
export const CHART_MARKER_LAYER = 'Chart coastline'

/** One of the chart's pattern tiles, by its id in the style, drawn at the device's pixel ratio. */
export function chartPattern(id: string, ratio: number) {
  const [name, flavor] = [id.slice(0, id.lastIndexOf('-')), id.slice(id.lastIndexOf('-') + 1) as FlavorId]
  const draw = name === SEA_PATTERN ? drawSea : name === WOOD_PATTERN ? drawWood : null
  if (!draw || !INK[flavor]) return null
  const size = Math.round((name === SEA_PATTERN ? 48 : 28) * ratio)
  const ctx = new OffscreenCanvas(size, size).getContext('2d')!
  ctx.scale(ratio, ratio)
  draw(ctx, size / ratio, INK[flavor])
  return { image: ctx.getImageData(0, 0, size, size), options: { pixelRatio: ratio } }
}

/** Short ripples, staggered row to row, in fine ink. */
function drawSea(ctx: OffscreenCanvasRenderingContext2D, size: number, ink: { sea: string }) {
  ctx.strokeStyle = ink.sea
  ctx.globalAlpha = 0.28
  ctx.lineWidth = 0.6
  ctx.lineCap = 'round'
  const rows = 4
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * (size / rows)
    const x = r % 2 ? size / 2 : 0
    for (const dx of [0, size]) ripple(ctx, x + dx - size / 4, y, size / 3.2)
  }
}

function ripple(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, length: number) {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.bezierCurveTo(x + length / 3, y - 1.4, x + (2 * length) / 3, y + 1.4, x + length, y)
  ctx.stroke()
}

/** A tree tuft — a crown over a short trunk — at two staggered spots per tile. */
function drawWood(ctx: OffscreenCanvasRenderingContext2D, size: number, ink: { wood: string }) {
  ctx.strokeStyle = ink.wood
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 0.8
  ctx.lineCap = 'round'
  for (const [x, y] of [[size * 0.25, size * 0.3], [size * 0.75, size * 0.8]]) {
    ctx.beginPath()
    ctx.arc(x, y, 2.6, Math.PI * 0.95, Math.PI * 2.05)
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + 3.4)
    ctx.stroke()
  }
}

const GRAIN_SIZE = 256

/**
 * A tile of paper: mottle, horizontal fibre and the odd fleck, as sepia where
 * the sheet is darker and white where it is lighter. Translucent rather than
 * blended, so the overlay costs the compositor no more than any other layer.
 */
export function paperGrain(seed = 7): OffscreenCanvas {
  const canvas = new OffscreenCanvas(GRAIN_SIZE, GRAIN_SIZE)
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(GRAIN_SIZE, GRAIN_SIZE)
  const mottle = valueNoise(seed, 16)
  const fibre = valueNoise(seed + 1, 32)
  let state = seed
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let y = 0; y < GRAIN_SIZE; y++) {
    for (let x = 0; x < GRAIN_SIZE; x++) {
      const fleck = random() < 0.0012 ? -0.6 : 0
      const tone = 0.2 * (mottle(x, y) - 0.5) + 0.45 * (fibre(x, y * 4) - 0.5) + 0.35 * (random() - 0.5) + fleck
      const i = (y * GRAIN_SIZE + x) * 4
      const [r, g, b] = tone < 0 ? [92, 60, 28] : [255, 252, 240]
      image.data[i] = r
      image.data[i + 1] = g
      image.data[i + 2] = b
      image.data[i + 3] = Math.min(255, Math.round(Math.abs(tone) * (tone < 0 ? 75 : 50)))
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** Smooth noise that tiles across `GRAIN_SIZE`, on a lattice of `cells` per side. */
function valueNoise(seed: number, cells: number) {
  let state = seed * 9973
  const lattice = Array.from({ length: cells * cells }, () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32))
  const cell = GRAIN_SIZE / cells
  const at = (i: number, j: number) => lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]
  const ease = (t: number) => t * t * (3 - 2 * t)
  return (x: number, y: number) => {
    const fx = x / cell
    const fy = y / cell
    const [i, j] = [Math.floor(fx), Math.floor(fy)]
    const [u, v] = [ease(fx - i), ease(fy - j)]
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * u
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u
    return top + (bottom - top) * v
  }
}
