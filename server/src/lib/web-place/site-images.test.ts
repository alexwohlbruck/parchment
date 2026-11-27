import { describe, expect, test } from 'bun:test'
import { addressImages } from './site-images'

describe('addressImages', () => {
  test('picks the logo and the footer map over photos and icons', () => {
    const html = `
      <img src="/hero.jpg" alt="A latte with oat milk">
      <img src="/cafe-logo.png" alt="Cafe Wands logo">
      <img src="/icons/instagram.svg" alt="Instagram">
      <img src="/pixel.gif" width="1" height="1">
      <footer><img src="/footer-card.png" alt=""></footer>`
    expect(addressImages(html)).toEqual(['/cafe-logo.png', '/footer-card.png'])
  })

  test('reads no more than two', () => {
    const html = ['a', 'b', 'c'].map((name) => `<img src="/${name}-logo.png">`).join('')
    expect(addressImages(html)).toHaveLength(2)
  })

  test('skips a page whose images give no sign of an address', () => {
    expect(addressImages('<img src="/croissant.jpg" alt="Croissants">')).toEqual([])
  })
})
