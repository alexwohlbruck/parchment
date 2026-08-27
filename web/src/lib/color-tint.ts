/**
 * Tinting an arbitrary colour into a background/foreground pair.
 *
 * Extracted from `utils.ts` so the map style can use it too: a POI badge on the
 * map and the icon tile in a place's header are the same mark for the same
 * place, and they now come out of the same function rather than out of two
 * copies of the same idea. `utils.ts` re-exports it for the UI, which is where
 * every existing caller reaches it.
 *
 * Deliberately free of Vue and of the DOM — `map-style/build.ts` is also loaded
 * by the Node-side style generator.
 */

export type Hsl = { h: number; s: number; l: number }

/**
 * Parse the colour forms the palette is authored in: `hsl()`, `hsla()`, and
 * three- or six-digit hex.
 */
export function parseColorToHsl(input: string): Hsl | null {
  const hslMatch = input.match(
    /^hsla?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%?\s*,\s*(\d+(?:\.\d+)?)%?/i,
  )
  if (hslMatch) {
    const h = ((parseFloat(hslMatch[1]) % 360) + 360) % 360
    return { h, s: parseFloat(hslMatch[2]), l: parseFloat(hslMatch[3]) }
  }
  let hex = input.trim().replace(/^#/, '')
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  if (hex.length !== 6) return null
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  if ([r, g, b].some(Number.isNaN)) return null
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: s * 100, l: l * 100 }
}

export function hslToHex(h: number, s: number, l: number): string {
  h /= 360
  s /= 100
  l /= 100
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let r: number, g: number, b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Where a tinted pair lands on the lightness ramp.
 *
 * Solid mirrors `bg-{c}-200 text-{c}-800` (and its dark-mode inverse); ghost
 * mirrors `text-{c}-700` / `dark:text-{c}-300`. Saturation is damped towards
 * the ends of the ramp because the theme ramps lose chroma there too — holding
 * the source saturation at L 88 would give neon pastels rather than tints.
 *
 * Absolute targets, not deltas: category colours arrive anywhere from L 28 to
 * L 75, so nudging by a fixed amount would produce wildly uneven results.
 *
 * The foreground lightnesses are set so the least contrasty category in the
 * palette (park, then sport & leisure) still clears WCAG's 3:1 floor for
 * non-text graphics with room to spare — 4.1:1 light, 4.8:1 dark.
 */
const COLOR_TINTS = {
  solid: {
    light: { bg: { l: 88, s: 0.7 }, fg: { l: 30, s: 0.95 } },
    dark: { bg: { l: 30, s: 0.75 }, fg: { l: 88, s: 0.8 } },
  },
  ghost: {
    light: { bg: null, fg: { l: 42, s: 1 } },
    dark: { bg: null, fg: { l: 80, s: 0.85 } },
  },
} as const

export type ColorTint = { background: string | null; foreground: string }

/**
 * Background and foreground for an icon tile tinted from an arbitrary colour,
 * matching how a themed (bookmark) tile looks. Returns `null` when the colour
 * can't be parsed, so callers can fall back.
 *
 * `ghost` leaves the background to the caller — those tiles sit on varying
 * surfaces, so a translucent wash reads better than an opaque tint.
 */
export function getCustomColorTint(
  color: string,
  variant: 'solid' | 'ghost',
  isDark: boolean,
): ColorTint | null {
  const hsl = parseColorToHsl(color)
  if (!hsl) return null

  const target = COLOR_TINTS[variant][isDark ? 'dark' : 'light']
  const shade = (t: { l: number; s: number }) =>
    hslToHex(hsl.h, Math.min(100, hsl.s * t.s), t.l)

  return {
    background: target.bg ? shade(target.bg) : null,
    foreground: shade(target.fg),
  }
}
