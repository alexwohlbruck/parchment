/**
 * Unit tests for wiki photo deduplication.
 *
 * The same Commons image reaches us through several URL forms (direct upload,
 * Special:FilePath, File: page), so plain URL equality isn't enough — the same
 * photo would otherwise appear two or three times in a place gallery. When a
 * duplicate is found the higher-priority source wins, and exactly one photo is
 * left flagged primary.
 */

import { describe, test, expect } from 'bun:test'
import { dedupeWikiPhotos } from './wiki-utils'
import { SOURCE } from '../../lib/constants'

function photo(url: string, sourceId: string, isPrimary = false) {
  return { value: { url, isPrimary }, sourceId }
}

/** Minimal Place carrying just a photo list. */
function place(photos: any[]): any {
  return { photos }
}

describe('dedupeWikiPhotos', () => {
  test('keeps distinct photos', () => {
    const subject = place([
      photo('https://a.test/1.jpg', SOURCE.WIKIMEDIA),
      photo('https://a.test/2.jpg', SOURCE.WIKIMEDIA),
    ])

    dedupeWikiPhotos(subject)

    expect(subject.photos).toHaveLength(2)
  })

  test('drops an exact URL duplicate', () => {
    const subject = place([
      photo('https://a.test/1.jpg', SOURCE.WIKIMEDIA),
      photo('https://a.test/1.jpg', SOURCE.WIKIDATA),
    ])

    dedupeWikiPhotos(subject)

    expect(subject.photos).toHaveLength(1)
  })

  test('collapses the same Commons file across URL forms', () => {
    // Direct upload vs File: page — same image, different URLs.
    const subject = place([
      photo(
        'https://upload.wikimedia.org/wikipedia/commons/e/ec/EastWest_Blvd.jpg',
        SOURCE.WIKIMEDIA,
      ),
      photo(
        'https://commons.wikimedia.org/wiki/File:EastWest_Blvd.jpg',
        SOURCE.WIKIDATA,
      ),
    ])

    dedupeWikiPhotos(subject)

    expect(subject.photos).toHaveLength(1)
  })

  test('collapses a Special:FilePath form too', () => {
    const subject = place([
      photo(
        'https://commons.wikimedia.org/wiki/Special:FilePath/EastWest%20Blvd.jpg',
        SOURCE.WIKIMEDIA,
      ),
      photo(
        'https://commons.wikimedia.org/wiki/File:EastWest_Blvd.jpg',
        SOURCE.WIKIDATA,
      ),
    ])

    dedupeWikiPhotos(subject)

    expect(subject.photos).toHaveLength(1)
  })

  test('the higher-priority source wins a duplicate', () => {
    const subject = place([
      photo('https://a.test/1.jpg', SOURCE.WIKIDATA),
      photo('https://a.test/1.jpg', SOURCE.WIKIPEDIA),
    ])

    dedupeWikiPhotos(subject)

    // Wikipedia (78) outranks Wikidata (65).
    expect(subject.photos[0].sourceId).toBe(SOURCE.WIKIPEDIA)
  })

  test('a lower-priority duplicate does not displace the incumbent', () => {
    const subject = place([
      photo('https://a.test/1.jpg', SOURCE.WIKIPEDIA),
      photo('https://a.test/1.jpg', SOURCE.WIKIDATA),
    ])

    dedupeWikiPhotos(subject)

    expect(subject.photos[0].sourceId).toBe(SOURCE.WIKIPEDIA)
  })

  test('skips photos with no URL', () => {
    const subject = place([
      photo('', SOURCE.WIKIMEDIA),
      photo('https://a.test/1.jpg', SOURCE.WIKIMEDIA),
    ])

    dedupeWikiPhotos(subject)

    expect(subject.photos).toHaveLength(1)
  })

  test('flags exactly one primary photo', () => {
    const subject = place([
      photo('https://a.test/1.jpg', SOURCE.WIKIDATA),
      photo('https://a.test/2.jpg', SOURCE.WIKIPEDIA),
      photo('https://a.test/3.jpg', SOURCE.WIKIMEDIA),
    ])

    dedupeWikiPhotos(subject)

    const primaries = subject.photos.filter((p: any) => p.value.isPrimary)
    expect(primaries).toHaveLength(1)
  })

  test('the primary is the highest-priority source', () => {
    const subject = place([
      photo('https://a.test/1.jpg', SOURCE.WIKIDATA),
      photo('https://a.test/2.jpg', SOURCE.WIKIPEDIA),
    ])

    dedupeWikiPhotos(subject)

    const primary = subject.photos.find((p: any) => p.value.isPrimary)
    expect(primary.sourceId).toBe(SOURCE.WIKIPEDIA)
  })

  test('clears a stale primary flag from a lower-priority photo', () => {
    const subject = place([
      photo('https://a.test/1.jpg', SOURCE.WIKIDATA, true),
      photo('https://a.test/2.jpg', SOURCE.WIKIPEDIA),
    ])

    dedupeWikiPhotos(subject)

    expect(subject.photos[0].value.isPrimary).toBe(false)
    expect(subject.photos[1].value.isPrimary).toBe(true)
  })

  test('handles an empty photo list', () => {
    const subject = place([])

    dedupeWikiPhotos(subject)

    expect(subject.photos).toEqual([])
  })

  test('preserves the order of surviving photos', () => {
    const subject = place([
      photo('https://a.test/1.jpg', SOURCE.WIKIMEDIA),
      photo('https://a.test/2.jpg', SOURCE.WIKIMEDIA),
      photo('https://a.test/1.jpg', SOURCE.WIKIMEDIA),
    ])

    dedupeWikiPhotos(subject)

    expect(subject.photos.map((p: any) => p.value.url)).toEqual([
      'https://a.test/1.jpg',
      'https://a.test/2.jpg',
    ])
  })
})
