import sharp, { type ResizeOptions } from 'sharp'

const MAX_INPUT_PIXELS = 50_000_000
const DECODABLE_FORMATS = new Set(['jpeg', 'png', 'webp'])

export class UnreadableImageError extends Error {
  constructor() {
    super('Unreadable or unsupported image')
    this.name = 'UnreadableImageError'
  }
}

/** Re-encodes a JPEG, PNG or WebP as webp, upright and without its metadata. */
export async function toWebp(image: Uint8Array, resize: ResizeOptions) {
  const input = sharp(image, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
  try {
    const { format } = await input.metadata()
    if (!format || !DECODABLE_FORMATS.has(format)) throw new UnreadableImageError()
    return await input.rotate().resize(resize).webp({ quality: 85 }).toBuffer()
  } catch (error) {
    throw error instanceof UnreadableImageError ? error : new UnreadableImageError()
  }
}
