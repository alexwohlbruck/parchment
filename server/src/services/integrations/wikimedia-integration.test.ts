/**
 * Unit tests for the Wikimedia Commons integration.
 *
 * Commons has no API key, so the correctness risk is entirely in query
 * assembly and response shape. Categories are one request (a `categorymembers`
 * generator); galleries are TWO — fetch the gallery wikitext, parse `File:`
 * references out of it, then look those files up by title. That second path is
 * where the limit is applied, so a gallery listing 200 files must still only
 * request the first `limit`.
 *
 * MediaWiki keys `query.pages` by page id, so results arrive as an object
 * rather than an array and pages without `imageinfo` have to be dropped —
 * otherwise a redirect or deleted file becomes a null photo in a place.
 *
 * Every method returns an empty list on failure: photos are enrichment, and a
 * Commons outage must not fail the place lookup that triggered it.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { createAxiosMock } from '../../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { WikimediaIntegration } = await import('./wikimedia-integration')

function configured() {
  const integration = new WikimediaIntegration()
  integration.initialize({})
  return integration
}

/** An imageinfo page keyed the way MediaWiki returns it. */
const imagePage = (pageid: number, title: string) => ({
  pageid,
  title,
  imageinfo: [
    {
      url: `https://upload.wikimedia.org/${title}`,
      thumburl: `https://upload.wikimedia.org/thumb/${title}`,
      width: 1600,
      height: 1200,
      mime: 'image/jpeg',
      extmetadata: {
        Artist: { value: 'A photographer' },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
      },
    },
  ],
})

const pagesResponse = (pages: Record<string, unknown>) => ({
  data: { query: { pages } },
})

/** A gallery page whose wikitext lists the given file names. */
const galleryResponse = (wikitext: string) => ({
  data: {
    query: {
      pages: {
        '77': { revisions: [{ slots: { main: { '*': wikitext } } }] },
      },
    },
  },
})

const paramsOf = (index = 0) => http.get.mock.calls[index][1].params

const realLog = console.log

beforeEach(() => {
  http.reset()
  console.log = () => {}
})

afterEach(() => {
  console.log = realLog
})

describe('configuration', () => {
  test('needs no credentials', () => {
    expect(new WikimediaIntegration().validateConfig({})).toBe(true)
  })

  test('declares the Wikimedia source and place-info capability', () => {
    const integration = new WikimediaIntegration()

    expect(integration.capabilityIds).toEqual(['placeInfo'])
    expect(integration.sources).toEqual(['wikimedia'])
  })

  test('refuses to fetch before initialization', async () => {
    await expect(
      new WikimediaIntegration().getImagesByCategory('Charlotte'),
    ).rejects.toThrow('has not been initialized')
    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('testConnection', () => {
  test('probes a well-known category', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    const result = await new WikimediaIntegration().testConnection({})

    expect(result).toEqual({ success: true })
    expect(paramsOf().gcmtitle).toBe('Category:Featured_pictures')
  })

  test('sends the identifying headers the usage policy requires', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    await new WikimediaIntegration().testConnection({})

    expect(http.get.mock.calls[0][1].headers['User-Agent']).toContain('Parchment')
  })

  test('fails on an unexpected response shape', async () => {
    http.get.mockResolvedValueOnce({ data: {} })

    const result = await new WikimediaIntegration().testConnection({})

    expect(result).toEqual({
      success: false,
      message: 'Invalid response format from Wikimedia Commons API',
    })
  })

  test('surfaces a network failure message', async () => {
    http.get.mockRejectedValueOnce(new Error('ETIMEDOUT'))

    expect((await new WikimediaIntegration().testConnection({})).message).toBe(
      'ETIMEDOUT',
    )
  })
})

describe('getImagesByCategory', () => {
  test('adapts every page that carries image info', async () => {
    http.get.mockResolvedValueOnce(
      pagesResponse({
        '1': imagePage(1, 'File:One.jpg'),
        '2': imagePage(2, 'File:Two.jpg'),
      }),
    )

    const images = await configured().getImagesByCategory('Charlotte')

    expect(images).toHaveLength(2)
    expect(images[0].url).toContain('upload.wikimedia.org')
  })

  test('adds the Category: prefix when the caller omits it', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagesByCategory('Charlotte')

    expect(paramsOf().gcmtitle).toBe('Category:Charlotte')
  })

  test('leaves an already-prefixed category alone', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagesByCategory('Category:Charlotte')

    expect(paramsOf().gcmtitle).toBe('Category:Charlotte')
  })

  test('restricts the generator to files', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagesByCategory('Charlotte')

    expect(paramsOf().generator).toBe('categorymembers')
    expect(paramsOf().gcmtype).toBe('file')
  })

  test('defaults the limit to 10 and honours an explicit one', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))
    await configured().getImagesByCategory('Charlotte')
    expect(paramsOf().gcmlimit).toBe(10)

    http.reset()
    http.get.mockResolvedValueOnce(pagesResponse({}))
    await configured().getImagesByCategory('Charlotte', 3)
    expect(paramsOf().gcmlimit).toBe(3)
  })

  test('requests a thumbnail alongside the full-size URL', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagesByCategory('Charlotte')

    expect(paramsOf().iiurlwidth).toBe(800)
    expect(paramsOf().iiprop).toContain('extmetadata')
  })

  test('drops pages with no image info rather than emitting nulls', async () => {
    // Redirects and deleted files come back without imageinfo.
    http.get.mockResolvedValueOnce(
      pagesResponse({
        '1': imagePage(1, 'File:One.jpg'),
        '2': { pageid: 2, title: 'File:Deleted.jpg' },
      }),
    )

    const images = await configured().getImagesByCategory('Charlotte')

    expect(images).toHaveLength(1)
    expect(images.every(Boolean)).toBe(true)
  })

  test('returns an empty list for a category with no pages', async () => {
    http.get.mockResolvedValueOnce({ data: { query: {} } })

    expect(await configured().getImagesByCategory('Empty')).toEqual([])
  })

  test('returns an empty list rather than throwing on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ETIMEDOUT'))

    expect(await configured().getImagesByCategory('Charlotte')).toEqual([])
  })
})

describe('getImagesByGallery', () => {
  const wikitext = '<gallery>\nFile:One.jpg|A caption\nFile:Two.jpg\n</gallery>'

  test('parses the gallery wikitext then looks the files up', async () => {
    http.get
      .mockResolvedValueOnce(galleryResponse(wikitext))
      .mockResolvedValueOnce(
        pagesResponse({
          '1': imagePage(1, 'File:One.jpg'),
          '2': imagePage(2, 'File:Two.jpg'),
        }),
      )

    const images = await configured().getImagesByGallery('Charlotte')

    expect(images).toHaveLength(2)
    expect(paramsOf(1).titles).toBe('File:One.jpg|File:Two.jpg')
  })

  test('fetches the gallery wikitext from the main slot', async () => {
    http.get
      .mockResolvedValueOnce(galleryResponse(wikitext))
      .mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagesByGallery('Charlotte')

    expect(paramsOf(0)).toMatchObject({
      prop: 'revisions',
      titles: 'Charlotte',
      rvslots: 'main',
    })
  })

  test('accepts the legacy Image: prefix as well as File:', async () => {
    http.get
      .mockResolvedValueOnce(galleryResponse('Image:Old.jpg|caption'))
      .mockResolvedValueOnce(pagesResponse({ '1': imagePage(1, 'File:Old.jpg') }))

    await configured().getImagesByGallery('Charlotte')

    expect(paramsOf(1).titles).toBe('File:Old.jpg')
  })

  test('de-duplicates repeated file references', async () => {
    http.get
      .mockResolvedValueOnce(
        galleryResponse('File:One.jpg|a\nFile:One.jpg|b\nFile:Two.jpg'),
      )
      .mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagesByGallery('Charlotte')

    expect(paramsOf(1).titles).toBe('File:One.jpg|File:Two.jpg')
  })

  test('applies the limit to the file lookup, not just the response', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `File:P${i}.jpg`).join('\n')
    http.get
      .mockResolvedValueOnce(galleryResponse(many))
      .mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagesByGallery('Charlotte', 2)

    expect(paramsOf(1).titles).toBe('File:P0.jpg|File:P1.jpg')
  })

  test('stops after the first request when the gallery page is missing', async () => {
    http.get.mockResolvedValueOnce({ data: { query: {} } })

    expect(await configured().getImagesByGallery('Nope')).toEqual([])
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  test('stops when the gallery page has no revision content', async () => {
    http.get.mockResolvedValueOnce({ data: { query: { pages: { '77': {} } } } })

    expect(await configured().getImagesByGallery('Charlotte')).toEqual([])
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  test('stops when the wikitext references no files', async () => {
    http.get.mockResolvedValueOnce(galleryResponse('Just prose, no files.'))

    expect(await configured().getImagesByGallery('Charlotte')).toEqual([])
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  test('returns an empty list when the file lookup fails', async () => {
    http.get
      .mockResolvedValueOnce(galleryResponse(wikitext))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))

    expect(await configured().getImagesByGallery('Charlotte')).toEqual([])
  })
})

describe('getImagesByTypeAndName', () => {
  test('routes a category to the category endpoint', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagesByTypeAndName('category', 'Charlotte')

    expect(paramsOf().generator).toBe('categorymembers')
  })

  test('routes a gallery to the revisions endpoint', async () => {
    http.get.mockResolvedValueOnce({ data: { query: {} } })

    await configured().getImagesByTypeAndName('gallery', 'Charlotte')

    expect(paramsOf().prop).toBe('revisions')
  })

  test('returns nothing for an unrecognized type', async () => {
    expect(
      await configured().getImagesByTypeAndName('atlas' as any, 'Charlotte'),
    ).toEqual([])
    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('getImagery', () => {
  test('prefers a category when one is supplied', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagery(35.2, -80.8, { category: 'Charlotte' })

    expect(paramsOf().gcmtitle).toBe('Category:Charlotte')
  })

  test('falls back to a gallery', async () => {
    http.get.mockResolvedValueOnce({ data: { query: {} } })

    await configured().getImagery(35.2, -80.8, { gallery: 'Charlotte' })

    expect(paramsOf().prop).toBe('revisions')
  })

  test('returns nothing when given only coordinates', async () => {
    // Geographic search is not implemented; it must not silently guess.
    expect(await configured().getImagery(35.2, -80.8)).toEqual([])
    expect(http.get).not.toHaveBeenCalled()
  })

  test('passes the limit through to the category lookup', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    await configured().getImagery(35.2, -80.8, { category: 'Charlotte', limit: 4 })

    expect(paramsOf().gcmlimit).toBe(4)
  })
})

describe('searchImages', () => {
  test('searches the file namespace for bitmaps', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({ '1': imagePage(1, 'File:One.jpg') }))

    const images = await configured().searchImages('Charlotte skyline')

    expect(images).toHaveLength(1)
    expect(paramsOf()).toMatchObject({
      generator: 'search',
      gsrsearch: 'filetype:bitmap Charlotte skyline',
      gsrnamespace: 6,
    })
  })

  test('honours the limit', async () => {
    http.get.mockResolvedValueOnce(pagesResponse({}))

    await configured().searchImages('skyline', 5)

    expect(paramsOf().gsrlimit).toBe(5)
  })

  test('returns an empty list when nothing matches', async () => {
    http.get.mockResolvedValueOnce({ data: { query: {} } })

    expect(await configured().searchImages('zzzz')).toEqual([])
  })

  test('returns an empty list on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ETIMEDOUT'))

    expect(await configured().searchImages('skyline')).toEqual([])
  })
})

describe('getPlaceInfo', () => {
  const info = (integration: any) => integration.capabilities.placeInfo.getPlaceInfo

  test('builds a photo-only place from a category id', async () => {
    http.get.mockResolvedValueOnce(
      pagesResponse({ '1': imagePage(1, 'File:One.jpg') }),
    )

    const place = await info(configured())('category:Charlotte')

    expect(place.id).toBe('wikimedia/category:Charlotte')
    expect(place.name.value).toBe('Charlotte')
    expect(place.photos).toHaveLength(1)
    expect(paramsOf().gcmtitle).toBe('Category:Charlotte')
  })

  test('marks the first photo as primary', async () => {
    http.get.mockResolvedValueOnce(
      pagesResponse({
        '1': imagePage(1, 'File:One.jpg'),
        '2': imagePage(2, 'File:Two.jpg'),
      }),
    )

    const place = await info(configured())('category:Charlotte')

    expect(place.photos[0].value.isPrimary).toBe(true)
    expect(place.photos[1].value.isPrimary).toBe(false)
  })

  test('resolves a gallery id through the gallery path', async () => {
    http.get
      .mockResolvedValueOnce(galleryResponse('File:One.jpg'))
      .mockResolvedValueOnce(pagesResponse({ '1': imagePage(1, 'File:One.jpg') }))

    const place = await info(configured())('gallery:Charlotte')

    expect(place.name.value).toBe('Charlotte')
    expect(place.sources[0].url).toContain('/wiki/gallery:Charlotte')
  })

  test('strips the wikimedia/ provider prefix', async () => {
    http.get.mockResolvedValueOnce(
      pagesResponse({ '1': imagePage(1, 'File:One.jpg') }),
    )

    const place = await info(configured())('wikimedia/category:Charlotte')

    expect(place.name.value).toBe('Charlotte')
  })

  test('keeps colons inside the name', async () => {
    // Commons titles legitimately contain colons.
    http.get.mockResolvedValueOnce(
      pagesResponse({ '1': imagePage(1, 'File:One.jpg') }),
    )

    const place = await info(configured())('category:Charlotte: The Queen City')

    expect(place.name.value).toBe('Charlotte: The Queen City')
  })

  test('percent-encodes the name in the source URL', async () => {
    http.get.mockResolvedValueOnce(
      pagesResponse({ '1': imagePage(1, 'File:One.jpg') }),
    )

    const place = await info(configured())('category:Bank of America Stadium')

    expect(place.sources[0].url).toBe(
      'https://commons.wikimedia.org/wiki/category:Bank%20of%20America%20Stadium',
    )
  })

  test('returns null for an id with no recognized type', async () => {
    expect(await info(configured())('Charlotte')).toBeNull()
    expect(http.get).not.toHaveBeenCalled()
  })

  test('returns null when the category holds no images', async () => {
    // A place with no photos is not worth returning.
    http.get.mockResolvedValueOnce(pagesResponse({}))

    expect(await info(configured())('category:Empty')).toBeNull()
  })

  test('claims no coordinates of its own', async () => {
    // Commons has no geometry; the merge pipeline gets it from another source.
    http.get.mockResolvedValueOnce(
      pagesResponse({ '1': imagePage(1, 'File:One.jpg') }),
    )

    const place = await info(configured())('category:Charlotte')

    expect(place.geometry.value.center).toEqual({ lat: 0, lng: 0 })
    expect(place.address).toBeNull()
  })
})
