import { describe, expect, test } from 'bun:test'
import { contactLinks, isListingSite, pageText, sameName, siteNames } from './site-page'

describe('isListingSite', () => {
  test.each([
    ['https://www.yelp.com/biz/joes-pizza', true],
    ['https://m.facebook.com/joespizza', true],
    ['https://www.tripadvisor.co.uk/Restaurant', true],
    ['https://x.com/joespizza', true],
    ['https://maps.app.goo.gl/abc', true],
    ['not a url', true],
    ['https://joespizzanyc.com/', false],
    ['https://www.thegooglyeyes.com/', false],
  ])('%s', (url, listing) => {
    expect(isListingSite(url)).toBe(listing)
  })
})

describe('pageText', () => {
  test('keeps what a reader sees and drops scripts, styles and tags', () => {
    const html = `<html><head><style>p{}</style><script>var a = 1</script></head>
      <body><h1>Joe&rsquo;s &amp; Co</h1><p>12 Main St<br>Open daily&nbsp;9&ndash;5</p><!-- hidden --></body></html>`
    expect(pageText(html)).toBe('Joe’s & Co\n12 Main St\nOpen daily 9–5')
  })

  test('leads with the meta description, where script-rendered sites put their address', () => {
    const html = `<head><meta name="description" content="Lady Delilah, New York. 353 W 14th St." /></head><body><div id="root"></div></body>`
    expect(pageText(html)).toBe('Lady Delilah, New York. 353 W 14th St.')
  })
})

describe('contactLinks', () => {
  test('returns same-site contact and location pages only', () => {
    const html = `
      <a href="/menu">Menu</a>
      <a href="/contact-us">Say hi</a>
      <a href="https://joes.example/visit#map">Visit</a>
      <a href="https://www.instagram.com/joes">Find us</a>
      <a href="/about"><span>About</span></a>`
    expect(contactLinks(html, 'https://joes.example/')).toEqual([
      'https://joes.example/contact-us',
      'https://joes.example/visit',
      'https://joes.example/about',
    ])
  })
})

describe('sameName', () => {
  test.each([
    ["Joe's Pizza", 'joes pizza', false],
    ["Joe's Pizza", "Joe's Pizza Brooklyn", true],
    ['The Crêpe Shop', 'Crepe Shop', true],
    ['Bread & Butter', 'Bread and Butter Café', true],
    ['Pizza', 'Pizzeria Uno', false],
    ['', 'Anything', false],
  ])('%s / %s', (a, b, same) => {
    expect(sameName(a, b)).toBe(same)
  })
})

describe('siteNames', () => {
  test('puts the declared site name and logo before the title, splitting off taglines', () => {
    const html = `<title>Used Pianos for Sale | IDEAL CONDITION! | Piano Land NYC</title>
      <meta property="og:site_name" content="Pianoland | Since 1989" />
      <a href="/"><img src="/images/pianoland-logo.svg" alt="Pianoland logo" /></a>
      <img src="/hero.jpg" alt="A grand piano" />`
    expect(siteNames(html)).toEqual([
      'Pianoland',
      'Since 1989',
      'Used Pianos for Sale',
      'IDEAL CONDITION!',
      'Piano Land NYC',
    ])
  })

  test('reads entities and ignores look-alike attributes', () => {
    const html = `<meta property="og:site_name" data-content="Wrong" content="Bread &amp; Salt">`
    expect(siteNames(html)).toEqual(['Bread & Salt'])
  })
})
