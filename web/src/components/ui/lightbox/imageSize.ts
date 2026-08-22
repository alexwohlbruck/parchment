/**
 * PhotoSwipe needs the pixel dimensions of every image before it can lay a
 * slide out, but our photos come from several providers and only some of them
 * report a size (Wikidata, for instance, reports none). Rather than block on
 * that metadata we measure the image itself: the browser has usually already
 * downloaded it for the thumbnail strip, so `naturalWidth` is free.
 */
export interface ImageSize {
  width: number
  height: number
}

/** Shared across every lightbox on the page — a URL's size never changes. */
const cache = new Map<string, ImageSize>()
const pending = new Map<string, Promise<ImageSize | null>>()

export function getCachedImageSize(url: string): ImageSize | undefined {
  return cache.get(url)
}

/** Record a size measured elsewhere, e.g. from a thumbnail's load event. */
export function cacheImageSize(url: string, size: ImageSize) {
  if (!url || size.width <= 0 || size.height <= 0) return
  if (!cache.has(url)) cache.set(url, size)
}

/**
 * Resolve an image's dimensions, decoding it if we have not seen it before.
 * Resolves to null when the image fails to load, so callers can fall back
 * rather than hang.
 */
export function measureImage(url: string): Promise<ImageSize | null> {
  const cached = cache.get(url)
  if (cached) return Promise.resolve(cached)

  const inFlight = pending.get(url)
  if (inFlight) return inFlight

  const promise = new Promise<ImageSize | null>(resolve => {
    const img = new Image()
    img.onload = () => {
      const size = { width: img.naturalWidth, height: img.naturalHeight }
      if (size.width > 0 && size.height > 0) {
        cache.set(url, size)
        resolve(size)
      } else {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  }).finally(() => {
    pending.delete(url)
  }) as Promise<ImageSize | null>

  pending.set(url, promise)
  return promise
}

/** Only used in tests, where a fresh module registry is not guaranteed. */
export function clearImageSizeCache() {
  cache.clear()
  pending.clear()
}
