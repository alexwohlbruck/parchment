/**
 * Unit tests for the Wikimedia Commons adapter.
 *
 * Commons descriptions and attribution strings arrive as raw HTML with wiki
 * markup embedded, so the cleaners have to strip tags, unwrap `[[links]]` and
 * drop `{{templates}}` — otherwise attribution renders as literal markup in
 * the photo credit.
 *
 * `isImageSuitableForPlace` is the gate that keeps diagrams, logos and coats
 * of arms out of place galleries, and `scoreImageForPlace` ranks what's left.
 */

import { describe, test, expect } from 'bun:test'
import { WikimediaAdapter } from './wikimedia-adapter'
import { SOURCE } from '../../../lib/constants'

const adapter = new WikimediaAdapter()

function imageInfo(over: Partial<any> = {}): any {
  return {
    url: 'https://commons.test/full/Cafe.jpg',
    thumburl: 'https://commons.test/thumb/Cafe.jpg',
    width: 1200,
    height: 800,
    size: 250_000,
    mime: 'image/jpeg',
    ...over,
  }
}

const page = (title = 'File:Cafe.jpg') => ({ pageid: 1, title, imageinfo: [] })

describe('adaptImageData', () => {
  test('prefers the thumbnail URL when present', () => {
    const photo = adapter.adaptImageData(page() as any, imageInfo())

    expect(photo.url).toBe('https://commons.test/thumb/Cafe.jpg')
  })

  test('falls back to the full-size URL', () => {
    const photo = adapter.adaptImageData(
      page() as any,
      imageInfo({ thumburl: undefined }),
    )

    expect(photo.url).toBe('https://commons.test/full/Cafe.jpg')
  })

  test('attributes the photo to Wikimedia and carries dimensions', () => {
    const photo = adapter.adaptImageData(page() as any, imageInfo())

    expect(photo).toMatchObject({
      sourceId: SOURCE.WIKIMEDIA,
      width: 1200,
      height: 800,
      isPrimary: false,
    })
  })

  test('uses the file name as alt text when there is no description', () => {
    const photo = adapter.adaptImageData(page('File:Cafe.jpg') as any, imageInfo())

    expect(photo.alt).toBe('Cafe.jpg')
  })

  test('strips the File: prefix from the fallback alt text', () => {
    const photo = adapter.adaptImageData(
      page('File:East West Blvd.jpg') as any,
      imageInfo(),
    )

    expect(photo.alt).toBe('East West Blvd.jpg')
  })

  test('prefers the image description for alt text', () => {
    const photo = adapter.adaptImageData(
      page() as any,
      imageInfo({
        extmetadata: { ImageDescription: { value: 'A corner cafe at dusk' } },
      }),
    )

    expect(photo.alt).toBe('A corner cafe at dusk')
  })

  test('strips HTML from the description', () => {
    const photo = adapter.adaptImageData(
      page() as any,
      imageInfo({
        extmetadata: {
          ImageDescription: { value: '<p>A <b>corner</b> cafe</p>' },
        },
      }),
    )

    expect(photo.alt).toBe('A corner cafe')
  })

  test('unwraps wiki links in the description', () => {
    const photo = adapter.adaptImageData(
      page() as any,
      imageInfo({
        extmetadata: {
          ImageDescription: { value: 'Near [[Charlotte, NC|Charlotte]]' },
        },
      }),
    )

    expect(photo.alt).toBe('Near Charlotte, NC')
  })

  test('drops wiki templates from the description', () => {
    const photo = adapter.adaptImageData(
      page() as any,
      imageInfo({
        extmetadata: {
          ImageDescription: { value: '{{en|1=A cafe}}A cafe' },
        },
      }),
    )

    expect(photo.alt).toBe('A cafe')
  })
})

describe('metadata extraction', () => {
  const withMeta = (extmetadata: any) =>
    adapter.adaptImageData(page() as any, imageInfo({ extmetadata })).metadata!

  test('is empty when the image carries no extmetadata', () => {
    expect(adapter.adaptImageData(page() as any, imageInfo()).metadata).toEqual({})
  })

  test('lifts licence fields', () => {
    const metadata = withMeta({
      License: { value: 'cc-by-sa-4.0' },
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      UsageTerms: { value: 'Creative Commons' },
    })

    expect(metadata).toMatchObject({
      license: 'cc-by-sa-4.0',
      licenseShort: 'CC BY-SA 4.0',
      usageTerms: 'Creative Commons',
    })
  })

  test('cleans HTML out of the artist attribution', () => {
    // Attribution is rendered in the photo credit; raw markup would show.
    const metadata = withMeta({
      Artist: { value: '<a href="/wiki/User:Bob">Bob</a>' },
    })

    expect(metadata.artist).toBe('Bob')
  })

  test('decodes HTML entities in attribution', () => {
    const metadata = withMeta({ Artist: { value: 'Bob &amp; Alice' } })

    expect(metadata.artist).toBe('Bob & Alice')
  })

  test('carries date, restrictions and categories through', () => {
    const metadata = withMeta({
      DateTime: { value: '2024-06-01' },
      Restrictions: { value: 'trademarked' },
      Categories: { value: 'Cafes in Charlotte' },
      AttributionRequired: { value: 'true' },
    })

    expect(metadata).toMatchObject({
      dateTime: '2024-06-01',
      restrictions: 'trademarked',
      categories: 'Cafes in Charlotte',
      attributionRequired: 'true',
    })
  })
})

describe('isImageSuitableForPlace', () => {
  test('accepts a large JPEG photo', () => {
    expect(adapter.isImageSuitableForPlace(imageInfo())).toBe(true)
  })

  test('rejects an image below the minimum width', () => {
    expect(
      adapter.isImageSuitableForPlace(imageInfo({ width: 299 })),
    ).toBe(false)
  })

  test('rejects an image below the minimum height', () => {
    expect(
      adapter.isImageSuitableForPlace(imageInfo({ height: 199 })),
    ).toBe(false)
  })

  test('rejects a file under 10KB', () => {
    expect(adapter.isImageSuitableForPlace(imageInfo({ size: 9_999 }))).toBe(
      false,
    )
  })

  test('accepts PNG and WebP alongside JPEG', () => {
    for (const mime of ['image/png', 'image/webp']) {
      expect(adapter.isImageSuitableForPlace(imageInfo({ mime }))).toBe(true)
    }
  })

  test('rejects SVG and other non-photo formats', () => {
    for (const mime of ['image/svg+xml', 'image/gif', 'application/pdf']) {
      expect(adapter.isImageSuitableForPlace(imageInfo({ mime }))).toBe(false)
    }
  })

  for (const term of ['diagram', 'logo', 'coat of arms', 'flag', 'map']) {
    test(`rejects an image categorised as a ${term}`, () => {
      // These are technically photos of the right size but read as clip art.
      const info = imageInfo({
        extmetadata: { Categories: { value: `Some ${term} of Charlotte` } },
      })

      expect(adapter.isImageSuitableForPlace(info)).toBe(false)
    })
  }

  test('the category check is case-insensitive', () => {
    const info = imageInfo({
      extmetadata: { Categories: { value: 'LOGO of Charlotte' } },
    })

    expect(adapter.isImageSuitableForPlace(info)).toBe(false)
  })

  test('accepts an image with harmless categories', () => {
    const info = imageInfo({
      extmetadata: { Categories: { value: 'Cafes in Charlotte' } },
    })

    expect(adapter.isImageSuitableForPlace(info)).toBe(true)
  })
})

describe('scoreImageForPlace', () => {
  test('scores a larger image higher', () => {
    const small = adapter.scoreImageForPlace(
      imageInfo({ width: 400, height: 300 }),
      'cafe.jpg',
    )
    const large = adapter.scoreImageForPlace(
      imageInfo({ width: 3000, height: 2000 }),
      'cafe.jpg',
    )

    expect(large).toBeGreaterThan(small)
  })

  test('caps the size contribution', () => {
    const huge = adapter.scoreImageForPlace(
      imageInfo({ width: 20000, height: 20000 }),
      'cafe.jpg',
    )

    // 10 for size + 2 landscape-ish + 2 JPEG at most from these factors.
    expect(huge).toBeLessThanOrEqual(14)
  })

  test('rewards a landscape aspect ratio', () => {
    const landscape = adapter.scoreImageForPlace(
      imageInfo({ width: 1500, height: 1000 }),
      'cafe.jpg',
    )
    const square = adapter.scoreImageForPlace(
      imageInfo({ width: 1225, height: 1225 }),
      'cafe.jpg',
    )

    expect(landscape).toBeGreaterThan(square)
  })

  test('prefers JPEG over PNG', () => {
    const jpeg = adapter.scoreImageForPlace(imageInfo(), 'cafe.jpg')
    const png = adapter.scoreImageForPlace(
      imageInfo({ mime: 'image/png' }),
      'cafe.jpg',
    )

    expect(jpeg - png).toBe(2)
  })

  test('boosts exterior and facade shots most', () => {
    const base = adapter.scoreImageForPlace(imageInfo(), 'cafe.jpg')
    const exterior = adapter.scoreImageForPlace(imageInfo(), 'cafe exterior.jpg')

    expect(exterior - base).toBe(3)
  })

  test('boosts interior shots less than exteriors', () => {
    const interior = adapter.scoreImageForPlace(imageInfo(), 'cafe interior.jpg')
    const exterior = adapter.scoreImageForPlace(imageInfo(), 'cafe exterior.jpg')

    expect(exterior).toBeGreaterThan(interior)
  })

  test('penalizes crops and thumbnails', () => {
    const base = adapter.scoreImageForPlace(imageInfo(), 'cafe.jpg')
    const cropped = adapter.scoreImageForPlace(imageInfo(), 'cafe crop.jpg')

    expect(base - cropped).toBe(2)
  })

  test('matches file-name hints case-insensitively', () => {
    const upper = adapter.scoreImageForPlace(imageInfo(), 'CAFE EXTERIOR.JPG')
    const lower = adapter.scoreImageForPlace(imageInfo(), 'cafe exterior.jpg')

    expect(upper).toBe(lower)
  })
})
