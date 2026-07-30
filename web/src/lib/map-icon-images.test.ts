/**
 * The rasterizer's job is to get a glyph onto the map exactly once, from
 * whichever spelling of the icon name happens to be stored.
 *
 * Name normalization is the load-bearing part: the icon picker writes lucide
 * names in PascalCase (`MapPin`) while the `bookmarks.icon` column defaults to
 * kebab (`map-pin`), and both must resolve to the same `map-pin.svg`.
 *
 * The rasterization itself isn't exercised — jsdom has no 2D canvas context,
 * so nothing would register either way. These cover the lookup, recoloring,
 * de-duplication and failure paths around it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mapIconImageId,
  ensureIconImage,
  ensureIconImages,
  resolveIconSvg,
} from './map-icon-images'

function fakeMap(existing: string[] = []) {
  const images = new Set(existing)
  return {
    images,
    hasImage: vi.fn((id: string) => images.has(id)),
    addImage: vi.fn((id: string) => images.add(id)),
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('mapIconImageId', () => {
  it('namespaces by pack so the two sets can share a name', () => {
    expect(mapIconImageId('maki', 'cafe')).toBe('bm-maki-cafe')
    expect(mapIconImageId('lucide', 'cafe')).toBe('bm-lucide-cafe')
  })
})

describe('ensureIconImage', () => {
  it('does nothing when the image is already registered', async () => {
    const map = fakeMap(['bm-maki-cafe'])

    await ensureIconImage(map, 'maki', 'cafe')

    expect(map.addImage).not.toHaveBeenCalled()
  })

  it('tolerates a map that cannot hold images', async () => {
    await expect(ensureIconImage(null, 'maki', 'cafe')).resolves.toBeUndefined()
    await expect(ensureIconImage({}, 'maki', 'cafe')).resolves.toBeUndefined()
  })

  it('warns and gives up on an unknown icon rather than failing the batch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const map = fakeMap()

    await ensureIconImage(map, 'maki', 'definitely-not-an-icon')

    expect(map.addImage).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('definitely-not-an-icon'),
    )
  })

})

describe('resolveIconSvg', () => {
  it('resolves both spellings of a lucide name to the same file', async () => {
    // `MapPin` is what the icon picker stores; `map-pin` is the column
    // default. Both must land on map-pin.svg.
    const pascal = await resolveIconSvg('lucide', 'MapPin')
    const kebab = await resolveIconSvg('lucide', 'map-pin')

    expect(pascal).not.toBeNull()
    expect(pascal).toBe(kebab)
  })

  it('resolves names whose digits are split in the filename', async () => {
    // `Volume2` → volume-2.svg, `Axis3d` → axis-3d.svg. A hand-rolled
    // PascalCase→kebab converter is exactly where these break.
    expect(await resolveIconSvg('lucide', 'Volume2')).not.toBeNull()
    expect(await resolveIconSvg('lucide', 'Axis3d')).not.toBeNull()
    expect(await resolveIconSvg('lucide', 'ArrowDown01')).not.toBeNull()
  })

  it('resolves maki names', async () => {
    expect(await resolveIconSvg('maki', 'cafe')).not.toBeNull()
  })

  it('follows a renamed lucide icon to the file that still exists', async () => {
    // lucide renamed Home → House and only ships house.svg, but keeps `Home`
    // as an alias export — so Vue components render it while a filename lookup
    // finds nothing. Home is the Home frequent's icon, so this regressing
    // means Home markers draw as empty circles.
    const home = await resolveIconSvg('lucide', 'Home')
    const house = await resolveIconSvg('lucide', 'House')

    expect(home).not.toBeNull()
    expect(home).toBe(house)
  })

  it('returns null for an icon neither pack has', async () => {
    expect(await resolveIconSvg('lucide', 'not-an-icon')).toBeNull()
    expect(await resolveIconSvg('maki', 'not-an-icon')).toBeNull()
  })

  it('forces the glyph white in both packs', async () => {
    // Maki paths carry no fill and would inherit black; lucide strokes resolve
    // `currentColor`, which has nothing to inherit from inside an <img>.
    const maki = await resolveIconSvg('maki', 'cafe')
    const lucide = await resolveIconSvg('lucide', 'coffee')

    expect(maki).toContain('fill="#ffffff"')
    expect(lucide).toContain('#ffffff')
    expect(lucide).not.toContain('currentColor')
  })
})

describe('ensureIconImages', () => {
  it('de-duplicates a batch so a shared icon is only looked up once', async () => {
    const map = fakeMap()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await ensureIconImages(map, [
      { pack: 'maki', name: 'nope-a' },
      { pack: 'maki', name: 'nope-a' },
      { pack: 'maki', name: 'nope-b' },
    ])

    // One warning per distinct unknown icon, not one per occurrence.
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('never rejects, so one bad glyph cannot break a render', async () => {
    const map = fakeMap()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      ensureIconImages(map, [
        { pack: 'lucide', name: 'MapPin' },
        { pack: 'maki', name: 'not-real' },
      ]),
    ).resolves.toBeUndefined()
  })
})
