/**
 * The advances the renderer itself will use.
 *
 * A station name's bullet strip hangs below its LAST line, so the strip's
 * offset needs the number of lines the name shapes into — and that is a
 * question only the glyphs can answer. The map does not draw with a font
 * the browser has: it draws with SDF glyphs fetched from the style's
 * glyph endpoint (`mapbox://fonts/…`, `…/{fontstack}/{range}.pbf`), whose
 * advances come from a font file the page never loads. Measuring the same
 * string on a canvas measures a SUBSTITUTE face, and a few per cent of
 * width either way decides the wrap for any name near the limit.
 *
 * Both engines keep those glyphs on the main thread, in the glyph manager
 * that serves the workers, keyed by the joined font stack and carrying
 * each glyph's `metrics.advance` in 24px-em units. It is internal, so it
 * is read defensively and returns null when the shape is not what we
 * expect — the caller keeps its canvas estimate in that case. What it is
 * not is a guess: these are the exact numbers the shaper divides by
 * `text-max-width`.
 */

export type GlyphAdvances = {
  /** Changes when the loaded glyph set does, so a measurement made
   *  against an incomplete range can be redone once the rest arrives. */
  key: string
  of: (code: number) => number | undefined
}

export function glyphAdvances(map: any, font: string[]): GlyphAdvances | null {
  const stack = (font ?? []).join(',')
  if (!stack) return null
  const entry = map?.style?.glyphManager?.entries?.[stack]
  const glyphs = entry?.glyphs
  if (!glyphs || typeof glyphs !== 'object') return null
  const advance = (glyph: any) => {
    const a = glyph?.metrics?.advance
    return typeof a === 'number' ? a : undefined
  }
  // MapLibre 6 caches each glyph on request, keyed by the character under
  // its font variant, rather than whole ranges keyed by code point
  const byChar = glyphs.default
  if (byChar && typeof byChar === 'object') {
    const chars = Object.keys(byChar)
    if (!chars.length) return null
    return {
      key: `${stack}#${chars.length}`,
      of: (code: number) => advance(byChar[String.fromCodePoint(code)]),
    }
  }
  // ranges arrive one 256-codepoint block at a time; an entry that exists
  // with none of them loaded knows nothing yet
  const ranges = Object.keys(entry.ranges ?? {})
  if (!ranges.length) return null
  return {
    key: `${stack}#${ranges.sort().join('.')}`,
    of: (code: number) => advance(glyphs[code]),
  }
}
