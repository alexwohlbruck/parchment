/**
 * The bullet strip hangs below the LAST line of a station name, so the
 * number of lines IS the strip's position. Get it wrong by one and the
 * strip either draws across the name or floats a line clear of it — the
 * overlap and the gap are the same bug, in the two directions.
 *
 * The count cannot be guessed from a canvas, because the map does not
 * draw with a font the browser has: it draws with SDF glyphs from the
 * style's glyph endpoint. These tests cover the exact path — the
 * advances the engine itself loaded — and the arithmetic MapLibre's
 * shaper does with them.
 */
import { describe, test, expect } from 'vitest'
import { ONE_EM, estRowsFromAdvances } from './portolan-images'
import { glyphAdvances } from './portolan-glyphs'

/** every character the same width, in 24px-em units */
const uniform = (advance: number) => () => advance
const MAX = 10 * ONE_EM // text-max-width, 10 em

describe('rows from the renderer’s own advances', () => {
  test('a name that fits the max width is one row', () => {
    // 25 chars × 8 units = 200 < 240
    expect(estRowsFromAdvances('Coney Island-Stillwell Av', uniform(8))).toBe(1)
  })

  test('the same name in a wider face is two', () => {
    // 25 × 12 = 300 > 240 — the few per cent a substituted font differs
    // by is exactly this threshold
    expect(estRowsFromAdvances('Coney Island-Stillwell Av', uniform(12))).toBe(2)
  })

  test('a name with nowhere to break stays on one row however wide', () => {
    // MapLibre overruns the max width rather than splitting mid-word
    expect(estRowsFromAdvances('Llanfairpwllgwyngyllgogerychwyrn', uniform(20))).toBe(1)
  })

  test('breaks bound the count, not just the width', () => {
    // 3 words, wide enough for 4 rows: only 2 break opportunities
    expect(estRowsFromAdvances('AAAAAAAAAA BBBBBBBBBB CCCCCCCCCC', uniform(30))).toBe(3)
  })

  test('the count is capped where the offset table ends', () => {
    const name = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')
    expect(estRowsFromAdvances(name, uniform(ONE_EM))).toBe(4)
  })

  test('an empty name is one row, not zero', () => {
    expect(estRowsFromAdvances('   ', uniform(10))).toBe(1)
  })

  test('a name whose glyphs are not loaded yet has no answer', () => {
    // half-measured is worse than honestly estimated: the caller keeps
    // its canvas count until the range arrives
    const partial = (code: number) => (code < 0x100 ? 10 : undefined)
    expect(estRowsFromAdvances('Ueno', partial)).toBe(1)
    expect(estRowsFromAdvances('上野', partial)).toBe(null)
  })

  test('the threshold is MapLibre’s: total advance over 10 em', () => {
    // the space counts too — MapLibre sums every glyph's advance,
    // whitespace included, before dividing
    const chars = MAX / 10 // 24 characters at advance 10 is exactly 10 em
    expect(estRowsFromAdvances('x'.repeat(chars - 2) + ' y', uniform(10))).toBe(1)
    expect(estRowsFromAdvances('x'.repeat(chars - 1) + ' y', uniform(10))).toBe(2)
  })
})

describe('reading the advances off the engine', () => {
  const mapWith = (entries: any) => ({ style: { glyphManager: { entries } } })
  const entry = {
    ranges: { 0: true },
    glyphs: { 65: { metrics: { advance: 17 } }, 66: { metrics: { advance: 11 } } },
  }

  test('finds the stack under its joined name', () => {
    const map = mapWith({ 'Roboto Regular,Noto Sans Regular': entry })
    const adv = glyphAdvances(map, ['Roboto Regular', 'Noto Sans Regular'])!
    expect(adv.of(65)).toBe(17)
    expect(adv.of(66)).toBe(11)
  })

  test('a glyph outside the loaded ranges reports nothing', () => {
    const adv = glyphAdvances(mapWith({ Roboto: entry }), ['Roboto'])!
    expect(adv.of(0x4e00)).toBe(undefined)
  })

  test('an entry with no range loaded is not an answer', () => {
    const empty = { ranges: {}, glyphs: {} }
    expect(glyphAdvances(mapWith({ Roboto: empty }), ['Roboto'])).toBe(null)
  })

  test('the key changes as more ranges arrive, so a count can be redone', () => {
    const before = glyphAdvances(mapWith({ Roboto: entry }), ['Roboto'])!.key
    const after = glyphAdvances(
      mapWith({ Roboto: { ...entry, ranges: { 0: true, 1: true } } }),
      ['Roboto'],
    )!.key
    expect(after).not.toBe(before)
  })

  test('an engine that keeps its glyphs elsewhere is survived, not thrown on', () => {
    expect(glyphAdvances({}, ['Roboto'])).toBe(null)
    expect(glyphAdvances(null, ['Roboto'])).toBe(null)
    expect(glyphAdvances({ style: {} }, [])).toBe(null)
  })
})
