import { describe, expect, test } from 'bun:test'
import { contactLinks, facebookPage, isListingSite, pageText, sameName, siteNames, typedName } from './site-page'

describe('isListingSite', () => {
  test.each([
    ['https://www.yelp.com/biz/joes-pizza', true],
    ['https://m.facebook.com/joespizza', false],
    ['https://www.tripadvisor.co.uk/Restaurant', true],
    ['https://x.com/joespizza', true],
    ['https://maps.app.goo.gl/abc', true],
    ['not a url', true],
    ['https://joespizzanyc.com/', false],
    ['https://www.thegooglyeyes.com/', false],
    ['https://www.facebook.com/ElCerrito2024/', false],
    ['https://www.facebook.com/search/top?q=cerrito', true],
  ])('%s', (url, listing) => {
    expect(isListingSite(url)).toBe(listing)
  })
})

describe('facebookPage', () => {
  test.each<[string, string | undefined]>([
    ['https://m.facebook.com/ElCerrito2024?ref=bookmarks', 'https://www.facebook.com/ElCerrito2024'],
    ['https://www.facebook.com/p/El-Cerrito-100063/photos', 'https://www.facebook.com/p/El-Cerrito-100063'],
    ['https://www.facebook.com/profile.php?id=123&sk=about', 'https://www.facebook.com/profile.php?id=123'],
    ['https://www.facebook.com/groups/brooklynfood', undefined],
    ['https://www.facebook.com/', undefined],
    ['https://elcerrito.example/', undefined],
  ])('%s', (url, page) => {
    expect<string | undefined>(facebookPage(url)).toBe(page)
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
    ["Joe's Pizza", 'joes pizza', true],
    ["Joe's Pizza", "Joe's Pizza Brooklyn", true],
    ['The Crêpe Shop', 'Crepe Shop', true],
    ['Bread & Butter', 'Bread and Butter Café', true],
    ['Pizza', 'Pizzeria Uno', false],
    ['', 'Anything', false],
  ])('%s / %s', (a, b, same) => {
    expect(sameName(a, b)).toBe(same)
  })
})

describe('typedName', () => {
  test.each([
    ['bookie lab bakery', 'Boogie Lab Bakery & Bistro', true],
    ['boogie lab', 'Boogie Lab Bakery & Bistro', true],
    ['pianolnad', 'Pianoland', true],
    ['bookie lob bakery', 'Boogie Lab Bakery & Bistro', false],
    ['cafe 12', 'Cafe 13', false],
    ['joes pizza', 'Moes Pizza', false],
    ['sushi palace', 'Pizza Palace', false],
    ["Ruby's cafe", "Ruby's", true],
    ['rolos restaurant', "Rolo's", true],
    ['moss bakery', 'Moss Café', true],
    ['moss bakery', 'Kate Moss Studio', false],
  ])('%s / %s', (typed, name, same) => {
    expect(typedName(typed, name)).toBe(same)
  })
})

describe('siteNames', () => {
  test('drops a country or company form from the name', () => {
    expect(siteNames('<meta property="og:site_name" content="La Cabra USA"><title>La Cabra</title>')).toEqual(['La Cabra'])
    expect(siteNames("<title>Joe's Pizza LLC</title>")).toEqual(["Joe's Pizza"])
    expect(siteNames('<title>Clinton St. Baking Co.</title>')).toEqual(['Clinton St. Baking Co.'])
    expect(siteNames('<title>Five Elephant.</title>')).toEqual(['Five Elephant'])
  })

  test('reads only the name out of a logo’s alt text', () => {
    expect(siteNames('<img src="a" alt="Cafe Wands logo (ornament-stacked)">')).toEqual(['Cafe Wands'])
    expect(siteNames('<img class="logo" src="a" alt="Logo of Moss Café">')).toEqual(['Moss Café'])
    expect(siteNames('<img class="logo" src="a" alt="Du Pain et des Idées logotype">')).toEqual(['Du Pain et des Idées'])
  })

  test('drops a logo linking home, generated alt text and titles that describe rather than name', () => {
    const html = `<title>Home | Smør Bakery in New York, NY</title>
      <img class="logo" src="a" alt="Fairfax Home"><img class="logo" src="b" alt="graphical user interface, text">`
    expect(siteNames(html)).toEqual(['Fairfax'])
  })

  test('leads with the name its JSON-LD declares', () => {
    const html = `<title>Dallas - now open!</title>
      <script type="application/ld+json">{"@type":"Organization","name":"Ruby's","legalName":"Ruby's Cafe LLC"}</script>`
    expect(siteNames(html)).toEqual(["Ruby's", "Ruby's Cafe", 'Dallas', 'now open!'])
  })

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
      'Piano Land',
    ])
  })

  test('reads entities and ignores look-alike attributes', () => {
    const html = `<meta property="og:site_name" data-content="Wrong" content="Bread &amp; Salt">`
    expect(siteNames(html)).toEqual(['Bread & Salt'])
  })
})
