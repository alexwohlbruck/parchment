import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fixtureInstance } from './fixtures'
import { FIXTURE_HEIGHTS } from './fixture-sizes.mjs'
import { parseGlb } from './glb.mjs'
import { headingToBearing } from './furniture'
import models from './models.json'

const at = (properties: Record<string, unknown>) => fixtureInstance({ properties }, -80.85, 35.21)

describe('fixtureInstance', () => {
  test('faces the traffic it controls, back along its bearing', () => {
    expect(headingToBearing(at({ glyph: 'signal-2', direction: 0 })!.heading)).toBeCloseTo(180)
    expect(headingToBearing(at({ glyph: 'crossbuck', direction: 250 })!.heading)).toBeCloseTo(70)
  })

  test('stands each model at its own height', () => {
    expect(at({ glyph: 'crossing-gate-3', direction: 90 })).toMatchObject({ model: 'crossing-gate-3', height: FIXTURE_HEIGHTS['crossing-gate-3'] })
  })

  test('leaves paint glyphs and unreadable directions to others', () => {
    expect(at({ glyph: 'road-arrow-left', direction: 0 })).toBeNull()
    expect(at({ glyph: 'signal-1' })).toBeNull()
  })

  test('leaves a glyph whose direction did not come through as a number', () => {
    expect(at({ glyph: 'signal-1', direction: null })).toBeNull()
  })

  test('has a model for every glyph, built a unit tall so its height scales it back', () => {
    for (const name of Object.keys(FIXTURE_HEIGHTS)) {
      expect(models, name).toHaveProperty(name)
      const bytes = readFileSync(resolve(__dirname, '../../../public/models', `${name}.glb`))
      const { max } = parseGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      expect(max[1], name).toBeCloseTo(1, 2)
    }
  })
})
