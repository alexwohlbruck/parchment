/**
 * Portolan marker/bullet image baking.
 *
 * Marker dots, bundle pills and route bullets are canvas-drawn the first
 * time a layer asks for them (styleimagemissing), so any feed's colors
 * and labels work with no sprite sheet. Ids are content-addressed —
 * dots-<hex@off;…>, pill-<span>, blt-<hex>-<shape>-<label>,
 * row-<blt|blt|…> — so a repeated request is a cache hit inside MapLibre.
 *
 * Structural port of portolan/web/src/views/MapView.vue:643-836 (images)
 * and :559-580 (estRows). All images render at 2x (pixelRatio 2); sizes
 * are CSS px at full zoom (z14+, where the slot pitch is its full 6 px).
 */

// dot diameter; also the pill height and its corner radius x2
const DOT_D = 7

// Bullet OUTLINES are curation (portolan style docs, `shape:` on a route
// or agency) with circle as the default. Non-circular outlines need a
// wider box to hold the same glyphs — a diamond's inscribed rectangle is
// barely half its width — so each shape declares how much it must grow.
const SHAPE_PAD: Record<string, number> = {
  circle: 1,
  square: 1,
  rounded: 1,
  notch: 1,
  hexagon: 1.18,
  octagon: 1.06,
  diamond: 1.42,
  triangle: 1.6,
}

function shapePath(ctx: CanvasRenderingContext2D, shape: string, w: number, h: number) {
  const cx = w / 2
  const cy = h / 2
  const poly = (pts: [number, number][]) => {
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.closePath()
  }
  switch (shape) {
    case 'square':
      ctx.rect(0, 0, w, h)
      return
    case 'rounded':
      ctx.roundRect(0, 0, w, h, Math.min(4, h / 3))
      return
    case 'notch':
      // three square corners and the TOP-RIGHT rounded — Mexico City's
      // house style. Radii run [tl, tr, br, bl].
      ctx.roundRect(0, 0, w, h, [0, Math.min(6, h / 2), 0, 0])
      return
    case 'diamond':
      poly([[cx, 0], [w, cy], [cx, h], [0, cy]])
      return
    case 'triangle':
      poly([[cx, 0], [w, h], [0, h]])
      return
    case 'hexagon': {
      const i = w * 0.25
      poly([[i, 0], [w - i, 0], [w, cy], [w - i, h], [i, h], [0, cy]])
      return
    }
    case 'octagon': {
      const i = Math.min(w, h) * 0.29
      poly([[i, 0], [w - i, 0], [w, i], [w, h - i], [w - i, h], [i, h], [0, h - i], [0, i]])
      return
    }
    default:
      ctx.arc(cx, cy, Math.min(w, h) / 2, 0, Math.PI * 2)
  }
}

// perceived luminance — yellow bullets (N/Q/R/W) need dark glyphs
const lumaOf = (hex: string) => {
  const n = parseInt(hex, 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
}

/** One bullet as a canvas: MTA-style circle for 1-2 char labels, a
 *  rounded-corner word pill (the Chicago 'Red'/'Brown' shape) for longer. */
function bulletCanvas(id: string): HTMLCanvasElement | null {
  const m = id.match(/^blt-([0-9a-fA-F]{6})-([a-z]*)-(.+)$/)
  if (!m) return null
  const hex = m[1]
  const shape = m[2] || 'circle'
  const label = m[3]
  const h = 14
  const cv = document.createElement('canvas')
  cv.width = 2
  cv.height = 2
  let ctx = cv.getContext('2d')!
  ctx.font = '600 9.5px system-ui, sans-serif'
  const tw = ctx.measureText(label).width
  // 1:1 for one or two glyphs, a pill once it is a word — and whatever
  // the outline needs on top of that
  const compact = label.length <= 2
  const pad = SHAPE_PAD[shape] ?? 1
  const w = Math.ceil((compact ? h : Math.ceil(tw) + 9) * pad)
  const hh = Math.ceil(h * (shape === 'triangle' ? 1.15 : 1))
  cv.width = w * 2
  cv.height = hh * 2
  ctx = cv.getContext('2d')!
  ctx.scale(2, 2)
  ctx.fillStyle = '#' + hex
  ctx.beginPath()
  if (!compact && (shape === 'circle' || !SHAPE_PAD[shape])) ctx.roundRect(0, 0, w, hh, 3.5)
  else shapePath(ctx, shape, w, hh)
  ctx.fill()
  ctx.fillStyle = lumaOf(hex) > 160 ? '#111111' : '#ffffff'
  ctx.font = '600 9.5px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // a triangle's usable area sits low; everything else centres
  ctx.fillText(label, w / 2, hh / 2 + (shape === 'triangle' ? 2.5 : 0.5))
  return cv
}

/** Draw the image for a content-addressed id, or null when the id is not
 *  one of ours (lets other styleimagemissing consumers coexist). */
export function drawPortolanImage(id: string): ImageData | null {
  const cv = document.createElement('canvas')
  const draw = (w: number, h: number) => {
    cv.width = w * 2
    cv.height = h * 2
    const ctx = cv.getContext('2d')!
    ctx.scale(2, 2)
    return ctx
  }
  let m: RegExpMatchArray | null
  if ((m = id.match(/^dots-(.+)$/))) {
    // one dot per stopping line: "hex@off;hex@off…", each circle at its
    // ribbon's slot offset from the marker anchor. The offset is baked
    // into the image so icon-rotate carries it to the correct side of
    // the corridor; icon-size then scales image AND offset together.
    const dots = m[1].split(';').map(s => {
      const [hex, off] = s.split('@')
      return { hex: /^[0-9a-fA-F]{6}$/.test(hex) ? hex : '888888', off: parseFloat(off) || 0 }
    })
    const reach = Math.max(...dots.map(d => Math.abs(d.off)))
    const w = DOT_D + 2 * reach
    const ctx = draw(w, DOT_D)
    for (const d of dots) {
      ctx.fillStyle = '#' + d.hex
      ctx.beginPath()
      ctx.arc(w / 2 + d.off, DOT_D / 2, DOT_D / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    return ctx.getImageData(0, 0, cv.width, cv.height)
  }
  if ((m = id.match(/^pill-([\d.]+)$/))) {
    // lines that fill the whole bundle: a white pill lying ACROSS it
    const span = parseFloat(m[1])
    const w = span + DOT_D + 2
    const h = DOT_D + 2
    const ctx = draw(w, h)
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = 'rgba(10,10,16,0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(1, 1.5, w - 2, DOT_D, DOT_D / 2)
    ctx.fill()
    ctx.stroke()
    return ctx.getImageData(0, 0, cv.width, cv.height)
  }
  if ((m = id.match(/^row-(.+)$/))) {
    // a whole bullet strip composed into one image. Past 8 bullets the
    // strip wraps into balanced centered rows — never truncate a strip;
    // that lies about who stops here. The icon anchors 'top', so extra
    // rows grow downward.
    const parts = m[1].split('|').map(bulletCanvas).filter(Boolean) as HTMLCanvasElement[]
    if (!parts.length) return null
    const gap = 3 * 2
    const nrows = Math.ceil(parts.length / 8)
    const per = Math.ceil(parts.length / nrows)
    const rows: HTMLCanvasElement[][] = []
    for (let i = 0; i < parts.length; i += per) rows.push(parts.slice(i, i + per))
    const rowW = (r: HTMLCanvasElement[]) => r.reduce((a, c) => a + c.width, 0) + gap * (r.length - 1)
    const w = Math.max(...rows.map(rowW))
    const rowH = Math.max(...parts.map(c => c.height))
    const vgap = 2 * 2
    cv.width = w
    cv.height = rowH * rows.length + vgap * (rows.length - 1)
    const ctx = cv.getContext('2d')!
    let y = 0
    for (const r of rows) {
      let x = Math.round((w - rowW(r)) / 2)
      for (const c of r) {
        ctx.drawImage(c, x, y)
        x += c.width + gap
      }
      y += rowH + vgap
    }
    return ctx.getImageData(0, 0, cv.width, cv.height)
  }
  if (id.startsWith('blt-')) {
    const single = bulletCanvas(id)
    return single
      ? single.getContext('2d')!.getImageData(0, 0, single.width, single.height)
      : null
  }
  return null
}

// ── label wrap estimation (MapView.vue:536-580) ────────────────────────
// How many lines a name wraps to: simulate MapLibre's shaping instead of
// counting characters, because BOTH directions of error show — undercount
// and the bullet strip lands ON a wrapped line, overcount and it floats
// in a hole below the name. MapLibre's determineLineBreaks fills lines
// evenly against totalWidth / ceil(totalWidth / maxWidth), so take its
// own line count: ceil(total advance / max width), bounded by how many
// break opportunities the name actually offers.
const BREAKABLE = new Set([
  0x0a, 0x20, 0x26, 0x29, 0x2b, 0x2d, 0x2f, 0xad, 0xb7, 0x200b, 0x2010, 0x2013, 0x2027,
])
const BREAKABLE_BEFORE = new Set([0x28]) // a break may precede "("
const MAX_ROWS = 4 // as far as the bullet-offset table reaches
let measureCtx: CanvasRenderingContext2D | null = null

/**
 * Turn a MapLibre font stack into a CSS font the canvas can measure with.
 * "Roboto Condensed Italic" is a family plus modifiers, not a CSS family,
 * so the modifiers have to come off the end and become weight and style
 * or the measurement runs in the wrong face entirely.
 */
/** What the atlas measured with, kept as the fallback when no basemap
 *  font is available yet. */
const MEASURE_FONT = '500 100px Roboto, system-ui, sans-serif'

export function cssFontFor(stack: string[], sizePx = 100): string {
  const name = stack[0] ?? 'Roboto Medium'
  const words = name.split(/\s+/)
  const WEIGHTS: Record<string, number> = {
    Thin: 100, Light: 300, Regular: 400, Book: 400, Medium: 500,
    SemiBold: 600, Semibold: 600, Bold: 700, Black: 900,
  }
  let style = ''
  let weight = 400
  while (words.length > 1) {
    const last = words[words.length - 1]
    if (last === 'Italic' || last === 'Oblique') {
      style = 'italic'
      words.pop()
    } else if (WEIGHTS[last] !== undefined) {
      weight = WEIGHTS[last]
      words.pop()
    } else break
  }
  const family = words.join(' ')
  return `${style} ${weight} ${sizePx}px "${family}", Roboto, system-ui, sans-serif`.trim()
}

/**
 * How many rows MapLibre will shape this name into.
 *
 * It has to measure the face the map actually draws: predicting rows in
 * a wider font than the one on screen reports a wrap that never happens,
 * and the bullet strip — which hangs below the LAST row — drops a whole
 * line clear of a name that fits on one.
 */
export function estRows(name: string, cssFont = MEASURE_FONT): number {
  const ctx = (measureCtx ||= document.createElement('canvas').getContext('2d')!)
  if (ctx.font !== cssFont) ctx.font = cssFont
  const maxW = 10 * 100 // text-max-width, 10 em, measured at 1 em = 100 px
  const text = name.trim()
  if (!text) return 1
  let breaks = 0
  for (let i = 0; i < text.length - 1; i++) {
    if (BREAKABLE.has(text.charCodeAt(i)) || BREAKABLE_BEFORE.has(text.charCodeAt(i + 1))) breaks++
  }
  // MapLibre sums every glyph's advance, spaces included, then divides
  const rows = Math.ceil(ctx.measureText(text).width / maxW)
  return Math.max(1, Math.min(MAX_ROWS, rows, breaks + 1))
}
