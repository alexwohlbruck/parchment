import { describe, expect, test } from 'vitest'
import { siteName } from './site-name'

describe('siteName', () => {
  test('drops the scheme, path and www', () => {
    expect(siteName('https://www.grownyc.org/greenmarket/union-square')).toBe('grownyc.org')
  })

  test('keeps other subdomains', () => {
    expect(siteName('https://en.wikipedia.org/wiki/Union_Square')).toBe('en.wikipedia.org')
  })

  test('falls back to the text when it is not a url', () => {
    expect(siteName('not a url')).toBe('not a url')
  })
})
