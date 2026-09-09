/**
 * Icon resolution for OSM presets.
 *
 * The failure this guards against is silent and everywhere: the client draws a
 * map pin for any Maki name the sheet does not carry, so an icon that fails to
 * resolve looks like a deliberate "no icon" rather than a bug. Two thirds of
 * the iD schema used to land there — it draws on temaki, Font Awesome and
 * roentgen, none of which we ship, and the resolver handed their names on with
 * only the pack prefix removed.
 *
 * So the assertions here are about coverage, not about individual glyphs: every
 * preset in the schema must resolve to something that exists, and the ordinary
 * places a person searches for must resolve to something better than a pin.
 */

import { describe, test, expect } from 'bun:test'
import makiIconNames from '@mapbox/maki/layouts/all.json'
import presets from '@openstreetmap/id-tagging-schema/dist/presets.min.json'
import { resolvePresetIcon, resolveIconName, categoryPalette } from './place-categories'

const MAKI = new Set<string>(makiIconNames as string[])
const PRESET_IDS = Object.keys(presets as Record<string, unknown>)

/** Maki's own name for the fallback pin — the one answer we want to be rare. */
const PIN = 'marker'

const drawable = (resolved: { icon: string; iconPack: string }) =>
  resolved.iconPack !== 'maki' || MAKI.has(resolved.icon)

describe('resolveIconName', () => {
  test('accepts a maki name the sheet carries, and rejects one it does not', () => {
    expect(resolveIconName('maki-restaurant')).toEqual({
      icon: 'restaurant',
      iconPack: 'maki',
    })
    expect(resolveIconName('maki-not-a-real-icon')).toBeNull()
  })

  test('bridges the hyphen Maki spells where OSM underscores', () => {
    // `temaki-town_hall` is not in the hand-written map; Maki has `town-hall`.
    expect(resolveIconName('temaki-town_hall')).toEqual({
      icon: 'town-hall',
      iconPack: 'maki',
    })
  })

  test('refuses a pack name Maki has no counterpart for, rather than guessing', () => {
    // What used to become the Maki name `pepper-hot`, which draws a pin.
    expect(resolveIconName('fas-pepper-hot')).toBeNull()
  })
})

describe('resolvePresetIcon', () => {
  test('a cuisine inherits the restaurant it is a kind of', () => {
    // `amenity/restaurant/mexican` names `fas-pepper-hot`, which we cannot
    // draw. A plate of food is a far better answer than a pin.
    expect(resolvePresetIcon('amenity/restaurant/mexican', 'fas-pepper-hot')).toEqual({
      icon: 'restaurant',
      iconPack: 'maki',
    })
  })

  test("falls back on the preset's own tag value, which is Maki's vocabulary too", () => {
    // Nothing in the `amenity/police` tree names a drawable icon, but the tag
    // value is the glyph's name.
    expect(resolvePresetIcon('amenity/police', 'temaki-police_officer')).toEqual({
      icon: 'police',
      iconPack: 'maki',
    })
  })

  test('every preset in the schema resolves to a glyph that exists', () => {
    const missing = PRESET_IDS.filter(id => {
      const icon = (presets as Record<string, { icon?: string }>)[id]?.icon
      return !drawable(resolvePresetIcon(id, icon))
    })
    expect(missing).toEqual([])
  })

  test('the ordinary places people search for get a glyph of their own', () => {
    const everyday = [
      'amenity/restaurant',
      'amenity/restaurant/mexican',
      'amenity/restaurant/pizza',
      'amenity/cafe',
      'amenity/bar',
      'amenity/pub',
      'amenity/fast_food',
      'amenity/pharmacy',
      'amenity/bank',
      'amenity/police',
      'amenity/library',
      'amenity/fuel',
      'amenity/hospital',
      'amenity/school',
      'shop/supermarket',
      'shop/bakery',
      'shop/hairdresser',
      'shop/clothes',
      'shop/convenience',
      'leisure/park',
      'leisure/fitness_centre',
      'tourism/hotel',
      'tourism/museum',
    ]
    const pinned = everyday.filter(id => {
      const icon = (presets as Record<string, { icon?: string }>)[id]?.icon
      return resolvePresetIcon(id, icon).icon === PIN
    })
    expect(pinned).toEqual([])
  })

  /**
   * A budget rather than a target.
   *
   * Nothing forces the iD schema to name a glyph we can draw, and some presets
   * genuinely have no business having one — `boundary`, `point`, a craft
   * workshop. So the bar is not zero. It is that a pin has to be the exception:
   * before the fallback chain existed, 953 of these 1709 presets drew one, and
   * a regression that puts it back there should not pass quietly.
   */
  test('a pin is the exception rather than half the schema', () => {
    const pinned = PRESET_IDS.filter(id => {
      const icon = (presets as Record<string, { icon?: string }>)[id]?.icon
      return resolvePresetIcon(id, icon).icon === PIN
    })
    expect(pinned.length / PRESET_IDS.length).toBeLessThan(0.25)
  })
})

describe('category fallback glyphs', () => {
  test('every category resolves to a glyph Maki carries', () => {
    for (const category of categoryPalette) {
      // No preset by this id and no tag values to read, so resolution runs the
      // whole chain out to the category's own glyph.
      const resolved = resolvePresetIcon('__unknown__', undefined, category.id)
      expect(drawable(resolved), `${category.id} → ${resolved.icon}`).toBe(true)
    }
  })
})
