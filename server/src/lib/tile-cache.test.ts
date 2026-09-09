/**
 * The cache exists because forwarding every tile ran the map into
 * barrelman's rate limit. What matters is that it holds the right things,
 * forgets them at the right time, and never grows past its budget — a
 * cache that quietly keeps everything is a memory leak with good manners.
 */
import { describe, test, expect } from 'bun:test'
import { TileCache } from './tile-cache'

const body = (n: number) => new ArrayBuffer(n)
const KB = 1024

describe('serving from memory', () => {
  test('a stored answer comes back', () => {
    const c = new TileCache(1024 * KB, 60_000)
    c.set('a/1/2/3.mvt', { status: 200, body: body(100), contentType: 'application/x-protobuf' })
    const hit = c.get('a/1/2/3.mvt')
    expect(hit?.status).toBe(200)
    expect(hit?.body?.byteLength).toBe(100)
    expect(c.stats().hits).toBe(1)
  })

  test('an empty tile is remembered too', () => {
    // the majority of a viewport: the cutter only writes tiles a feature
    // touches, so most answers are 204 and each one cost a round trip
    const c = new TileCache(1024 * KB, 60_000)
    c.set('a/1/2/3.mvt', { status: 204, body: null, contentType: null })
    expect(c.get('a/1/2/3.mvt')?.status).toBe(204)
  })

  test('a miss is a miss, not an empty answer', () => {
    const c = new TileCache(1024 * KB, 60_000)
    expect(c.get('never/seen.mvt')).toBe(null)
    expect(c.stats().misses).toBe(1)
  })
})

describe('forgetting', () => {
  test('an entry stops being served once its time is up', () => {
    let now = 1_000
    const c = new TileCache(1024 * KB, 5_000, () => now)
    c.set('a.mvt', { status: 200, body: body(10), contentType: null })
    now += 4_999
    expect(c.get('a.mvt')).not.toBe(null)
    now += 2
    expect(c.get('a.mvt')).toBe(null)
  })

  test('an expired entry is dropped, not just hidden', () => {
    let now = 0
    const c = new TileCache(1024 * KB, 1_000, () => now)
    c.set('a.mvt', { status: 200, body: body(500), contentType: null })
    expect(c.byteSize).toBeGreaterThan(500)
    now += 2_000
    c.get('a.mvt')
    expect(c.size).toBe(0)
    expect(c.byteSize).toBe(0)
  })
})

describe('staying inside the budget', () => {
  test('bytes, not entries, bound it', () => {
    const c = new TileCache(10 * KB, 60_000)
    for (let i = 0; i < 50; i++) {
      c.set(`t${i}.mvt`, { status: 200, body: body(KB), contentType: null })
    }
    expect(c.byteSize).toBeLessThanOrEqual(10 * KB)
    expect(c.stats().evictions).toBeGreaterThan(0)
  })

  test('the least recently USED goes, not the oldest stored', () => {
    const c = new TileCache(3 * KB + 3 * 256, 60_000)
    c.set('a', { status: 200, body: body(KB), contentType: null })
    c.set('b', { status: 200, body: body(KB), contentType: null })
    c.set('c', { status: 200, body: body(KB), contentType: null })
    c.get('a') // a is now the youngest
    c.set('d', { status: 200, body: body(KB), contentType: null })
    expect(c.get('a')).not.toBe(null)
    expect(c.get('b')).toBe(null) // b was the coldest
  })

  test('re-storing a key replaces it rather than double-counting', () => {
    const c = new TileCache(100 * KB, 60_000)
    c.set('a', { status: 200, body: body(KB), contentType: null })
    const once = c.byteSize
    c.set('a', { status: 200, body: body(KB), contentType: null })
    expect(c.byteSize).toBe(once)
    expect(c.size).toBe(1)
  })

  test('an entry bigger than the whole budget is refused, not obeyed', () => {
    // storing it would evict everything else to hold one tile
    const c = new TileCache(2 * KB, 60_000)
    c.set('small', { status: 200, body: body(100), contentType: null })
    c.set('huge', { status: 200, body: body(10 * KB), contentType: null })
    expect(c.get('huge')).toBe(null)
    expect(c.get('small')).not.toBe(null)
  })

  test('thousands of empty answers are not free', () => {
    // an empty body is 0 bytes; without per-entry overhead the budget
    // would never bind and the map could hold every miss it ever made
    const c = new TileCache(10 * KB, 60_000)
    for (let i = 0; i < 500; i++) {
      c.set(`e${i}.mvt`, { status: 204, body: null, contentType: null })
    }
    expect(c.size).toBeLessThan(500)
    expect(c.byteSize).toBeLessThanOrEqual(10 * KB)
  })
})
