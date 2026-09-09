/**
 * Route bullets, ordered and shaped the way portolan does it.
 *
 * The map and the panel draw the same station, so they must agree about
 * what order its lines read in and what each bullet looks like. Portolan
 * decides both — once, in `sortBullets` (internal/pipeline/stations.go)
 * and in the bullet baker — and the tiles carry the result. Everything
 * parchment renders from its OWN transit data (the place header, the
 * departure board) went its own way: Columbus Circle listed 1 2 A B C D
 * where the map beside it read A C · D · 1 2.
 *
 * This is the port of those rules. Structural, not approximate: the
 * comparators below are the Go ones line for line, because "close enough"
 * shows up as two different orders on one screen.
 *
 * See docs/STOP-LABELS.md, "Bullet ordering", for why each policy exists.
 */

/** Portolan's `bullet_order` style knob. */
export type BulletOrder = 'color' | 'feed' | 'natural'

/** The outlines portolan's curation can put a bullet in (`shape:` on a
 *  route or an agency). Circle is the default everywhere. */
export type BulletShape =
  | 'circle'
  | 'square'
  | 'rounded'
  | 'notch'
  | 'diamond'
  | 'triangle'
  | 'hexagon'
  | 'octagon'

export const BULLET_SHAPES: BulletShape[] = [
  'circle', 'square', 'rounded', 'notch', 'diamond', 'triangle', 'hexagon', 'octagon',
]

export function isBulletShape(v: unknown): v is BulletShape {
  return typeof v === 'string' && (BULLET_SHAPES as string[]).includes(v)
}

/** What ordering needs to know about a route. */
export interface BulletRoute {
  /** The glyphs on the bullet — a short name, or whatever stands in. */
  label: string
  /** GTFS/curated hex, with or without '#'. Absent reads as portolan's
   *  own fallback grey, so uncoloured routes form one group. */
  color?: string | null
  /** GTFS `route_sort_order`; only the `feed` policy reads it. */
  sortOrder?: number | null
  /** Stable last resort, so two identical bullets never swap. */
  id?: string | null
}

/** Portolan's fallback when nothing gives a route a colour. */
const NO_COLOR = '888888'

/** The colour a bullet groups by: hex without '#', case-folded so
 *  "#00933C" and "00933c" are one group and not two. */
export function bulletHex(color?: string | null): string {
  const hex = String(color ?? '').replace('#', '').trim()
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : NO_COLOR
}

/** A whole-string integer, or null — Go's strconv.Atoi, which is what
 *  decides "is this a number group?" upstream. Not parseInt: "7X" is a
 *  letter-ish label, and parseInt would call it 7. */
function asInt(s: string): number | null {
  return /^[+-]?\d+$/.test(s.trim()) ? Number(s.trim()) : null
}

/**
 * Order route labels the way a rider reads them: "2" before "10",
 * numbers before letters, otherwise plain string order.
 */
export function naturalCmp(a: string, b: string): number {
  const na = asInt(a)
  const nb = asInt(b)
  if (na !== null && nb !== null) return na < nb ? -1 : na > nb ? 1 : 0
  if (na !== null) return -1
  if (nb !== null) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Rank colour GROUPS: numeric labels sort numerically, but letter groups
 * come before number groups — the MTA's service listing runs A,C,E …
 * N,Q,R,W then 1,2,3 … 7, and Columbus Circle reads A·C B·D 1·2.
 */
export function lettersFirstCmp(a: string, b: string): number {
  const na = asInt(a)
  const nb = asInt(b)
  if (na !== null && nb !== null) return naturalCmp(a, b)
  if (na !== null) return 1 // a is a number → after letters
  if (nb !== null) return -1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Order a station's routes under one of portolan's policies.
 *
 * `color` (the default, and what every pyramid currently ships): group by
 * resolved bullet colour, natural order within a group, letter groups
 * before number groups. Where every line has its own colour — London,
 * Paris, Chicago, CDMX — this degrades to exactly the natural order those
 * systems expect, which is why it can be the default everywhere.
 *
 * `feed`: obey `route_sort_order`, absentees last, natural fallback. When
 * an operator says what order its routes read in, believe them.
 *
 * `natural`: plain numeric-aware sort (1 2 10 A B).
 *
 * Returns a new array; the input is not touched.
 */
export function orderBullets<T>(
  items: readonly T[],
  read: (item: T) => BulletRoute,
  policy: BulletOrder = 'color',
): T[] {
  const meta = new Map<T, BulletRoute & { hex: string }>()
  for (const item of items) {
    const r = read(item)
    meta.set(item, { ...r, label: r.label ?? '', hex: bulletHex(r.color) })
  }
  const at = (item: T) => meta.get(item)!
  // the id is the last word, so a redraw cannot shuffle two bullets that
  // are otherwise indistinguishable
  const byId = (a: T, b: T) => {
    const ia = String(at(a).id ?? '')
    const ib = String(at(b).id ?? '')
    return ia < ib ? -1 : ia > ib ? 1 : 0
  }
  const out = [...items]

  if (policy === 'feed') {
    // absent or negative sort_order goes last, exactly as the Go clamps it
    const order = (item: T) => {
      const s = at(item).sortOrder
      return s === null || s === undefined || s < 0 ? Number.MAX_SAFE_INTEGER : s
    }
    return out.sort(
      (a, b) =>
        order(a) - order(b) ||
        naturalCmp(at(a).label, at(b).label) ||
        byId(a, b),
    )
  }

  if (policy === 'natural') {
    return out.sort((a, b) => naturalCmp(at(a).label, at(b).label) || byId(a, b))
  }

  // color: each group is ranked by its first member's label — the NATURAL
  // first, so "7,7X" is represented by "7" and stays a number group
  const rep = new Map<string, string>()
  for (const item of items) {
    const { hex, label } = at(item)
    const cur = rep.get(hex)
    if (cur === undefined || naturalCmp(label, cur) < 0) rep.set(hex, label)
  }
  return out.sort((a, b) => {
    const ha = at(a).hex
    const hb = at(b).hex
    if (ha !== hb) {
      return (
        lettersFirstCmp(rep.get(ha)!, rep.get(hb)!) ||
        (ha < hb ? -1 : ha > hb ? 1 : 0)
      )
    }
    return naturalCmp(at(a).label, at(b).label) || byId(a, b)
  })
}

// ── stylization ────────────────────────────────────────────────────────

/** Perceived luminance, 0-255, of a 6-digit hex — the same weights the
 *  bullet baker uses to decide dark or light glyphs. */
export function bulletLuma(color?: string | null): number {
  const n = parseInt(bulletHex(color), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
}

/**
 * The glyph colour for a bullet, when curation has not named one.
 *
 * Yellow bullets (the MTA's N/Q/R/W) need dark glyphs, and a flat white
 * default put grey-on-yellow in the panel while the map drew black. The
 * threshold is the baker's, 160 of 255.
 */
export function bulletTextColor(color?: string | null, curated?: string | null): string {
  const own = String(curated ?? '').replace('#', '').trim()
  if (/^[0-9a-fA-F]{6}$/.test(own)) return `#${own}`
  return bulletLuma(color) > 160 ? '#111111' : '#ffffff'
}

/**
 * How much wider than tall a bullet's box must be for its outline to hold
 * the same glyphs: a diamond's inscribed rectangle is barely half its
 * width. Portolan's SHAPE_PAD, unchanged.
 */
export const SHAPE_PAD: Record<BulletShape, number> = {
  circle: 1,
  square: 1,
  rounded: 1,
  notch: 1,
  hexagon: 1.18,
  octagon: 1.06,
  diamond: 1.42,
  triangle: 1.6,
}

/**
 * The CSS that puts a bullet in one of portolan's outlines, at a given
 * box height. Ratios come from the baker's 14px box, so a 22px chip in
 * the panel is the same shape as the one baked into the tile.
 *
 * Rounded rectangles use border-radius (crisper, and they can carry a
 * border); everything angular is a clip-path polygon with the same
 * vertices `shapePath` draws.
 */
export function bulletGeometry(
  shape: BulletShape,
  opts: { compact: boolean; height: number },
): { borderRadius: string; clipPath?: string; minWidth: string; height: string; textShift: string } {
  const h = opts.height
  const pad = SHAPE_PAD[shape] ?? 1
  // the baker's box: 1:1 for one or two glyphs, a word pill beyond that
  const boxH = shape === 'triangle' ? h * 1.15 : h
  const minWidth = `${Math.round(h * pad)}px`
  const R = (r: number) => `${Math.round((r / 14) * h * 10) / 10}px`

  const base = {
    minWidth,
    height: `${Math.round(boxH)}px`,
    textShift: shape === 'triangle' ? `${Math.round((2.5 / 14) * h * 10) / 10}px` : '0px',
  }

  switch (shape) {
    case 'square':
      return { ...base, borderRadius: '0' }
    case 'rounded':
      return { ...base, borderRadius: R(Math.min(4, 14 / 3)) }
    case 'notch':
      // three square corners, the TOP-RIGHT rounded — Mexico City's house style
      return { ...base, borderRadius: `0 ${R(Math.min(6, 7))} 0 0` }
    case 'diamond':
      return { ...base, borderRadius: '0', clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' }
    case 'triangle':
      return { ...base, borderRadius: '0', clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }
    case 'hexagon':
      return { ...base, borderRadius: '0', clipPath: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)' }
    case 'octagon':
      return { ...base, borderRadius: '0', clipPath: 'polygon(29% 0, 71% 0, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0 71%, 0 29%)' }
    default:
      // a circle for one or two glyphs; the Chicago 'Red'/'Brown' word
      // pill (roundRect r=3.5 on the baker's 14px box) beyond that
      return { ...base, borderRadius: opts.compact ? '9999px' : R(3.5) }
  }
}
