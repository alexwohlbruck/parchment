import { describe, test, expect } from 'bun:test'
import { sniffImageType } from './image-type'

const bytes = (...values: number[]) => new Uint8Array(values)
const ascii = (text: string) => new TextEncoder().encode(text)

describe('sniffImageType', () => {
  test('recognises the raster formats by signature', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png')
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffImageType(ascii('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffImageType(ascii('GIF89a'))).toBe('image/gif')
  })

  test('rejects vector, container and unknown formats', () => {
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImageType(ascii('\0\0\0\x18ftypheic'))).toBeNull()
    expect(sniffImageType(bytes(0x49, 0x49, 0x2a, 0x00))).toBeNull()
    expect(sniffImageType(ascii('RIFF\0\0\0\0WAVE'))).toBeNull()
    expect(sniffImageType(bytes())).toBeNull()
  })
})
