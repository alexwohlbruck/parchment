import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cacheImageSize, clearImageSizeCache, getCachedImageSize, measureImage } from './imageSize'

/** Stands in for the browser's Image, so a test can decide when a load lands. */
class FakeImage {
  static instances: FakeImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  #src = ''

  constructor() {
    FakeImage.instances.push(this)
  }

  get src() {
    return this.#src
  }

  set src(value: string) {
    this.#src = value
  }

  succeed(width: number, height: number) {
    this.naturalWidth = width
    this.naturalHeight = height
    this.onload?.()
  }

  fail() {
    this.onerror?.()
  }
}

describe('imageSize', () => {
  beforeEach(() => {
    clearImageSizeCache()
    FakeImage.instances = []
    vi.stubGlobal('Image', FakeImage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('measures an image once and serves the rest from cache', async () => {
    const first = measureImage('/a.jpg')
    FakeImage.instances[0].succeed(1200, 800)
    expect(await first).toEqual({ width: 1200, height: 800 })

    expect(getCachedImageSize('/a.jpg')).toEqual({ width: 1200, height: 800 })
    expect(await measureImage('/a.jpg')).toEqual({ width: 1200, height: 800 })
    expect(FakeImage.instances).toHaveLength(1)
  })

  it('shares one decode between concurrent callers', async () => {
    const a = measureImage('/b.jpg')
    const b = measureImage('/b.jpg')
    expect(FakeImage.instances).toHaveLength(1)

    FakeImage.instances[0].succeed(640, 640)
    expect(await a).toEqual({ width: 640, height: 640 })
    expect(await b).toEqual({ width: 640, height: 640 })
  })

  it('resolves null on error rather than hanging, and retries later', async () => {
    const failed = measureImage('/gone.jpg')
    FakeImage.instances[0].fail()
    expect(await failed).toBeNull()
    expect(getCachedImageSize('/gone.jpg')).toBeUndefined()

    // A failure is not cached, so a later attempt can still succeed.
    const retry = measureImage('/gone.jpg')
    expect(FakeImage.instances).toHaveLength(2)
    FakeImage.instances[1].succeed(100, 50)
    expect(await retry).toEqual({ width: 100, height: 50 })
  })

  it('rejects degenerate sizes from both entry points', async () => {
    cacheImageSize('/zero.jpg', { width: 0, height: 100 })
    expect(getCachedImageSize('/zero.jpg')).toBeUndefined()

    const measured = measureImage('/empty.jpg')
    FakeImage.instances[0].succeed(0, 0)
    expect(await measured).toBeNull()
  })

  it('keeps the first size recorded for a URL', () => {
    cacheImageSize('/c.jpg', { width: 800, height: 600 })
    cacheImageSize('/c.jpg', { width: 10, height: 10 })
    expect(getCachedImageSize('/c.jpg')).toEqual({ width: 800, height: 600 })
  })
})
