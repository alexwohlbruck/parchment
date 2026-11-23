import { describe, expect, it } from 'vitest'
import { safeHref } from './safe-href'

describe('safeHref', () => {
  it.each([
    'https://example.com/menu',
    'http://example.com',
    'mailto:info@example.com',
    'tel:+15551234567',
  ])('keeps %s', (value) => {
    expect(safeHref(value)).toBe(new URL(value).href)
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'lyft://ridetype',
  ])('rejects %j', (value) => {
    expect(safeHref(value)).toBeUndefined()
  })

  it('rejects values that are not absolute URLs', () => {
    expect(safeHref('example.com')).toBeUndefined()
    expect(safeHref('/settings')).toBeUndefined()
    expect(safeHref('')).toBeUndefined()
    expect(safeHref(undefined)).toBeUndefined()
    expect(safeHref(null)).toBeUndefined()
  })

  it('allows an extra scheme only when the caller names it', () => {
    expect(safeHref('lyft://ridetype?id=lyft', ['lyft:'])).toBe('lyft://ridetype?id=lyft')
    expect(safeHref('javascript:alert(1)', ['lyft:'])).toBeUndefined()
  })
})
