import { declaredNames } from './schema-org'

/** Sites that list other people's businesses. Their data is copyrighted, so it never seeds an OSM edit. */
const LISTING_SITES = new Set([
  'agoda', 'airbnb', 'allmenus', 'angi', 'apple', 'bbb', 'beyondmenu', 'bing', 'birdeye',
  'booking', 'booksy', 'chamberofcommerce', 'chownow', 'doordash', 'eater', 'expedia',
  'exploretock', 'facebook', 'fb', 'foursquare', 'fresha', 'google', 'groupon', 'grubhub',
  'healthgrades', 'homeadvisor', 'houzz', 'instagram', 'kayak', 'linkedin', 'manta',
  'mapquest', 'menufy', 'menupix', 'mindbody', 'nextdoor', 'opentable', 'postmates',
  'restaurantguru', 'resy', 'seamless', 'sevenrooms', 'sirved', 'styleseat', 'thumbtack',
  'tiktok', 'timeout', 'toasttab', 'tock', 'tripadvisor', 'trivago', 'twitter', 'ubereats',
  'vagaro', 'wanderlog', 'waze', 'wikipedia', 'yahoo', 'yellowpages', 'yelp', 'zocdoc',
  'zomato',
])
const LISTING_HOSTS = new Set(['x.com', 'hotels.com', 'goo.gl', 'maps.app.goo.gl'])

/** True when the url belongs to a directory, review, booking, delivery or social site. */
export function isListingSite(url: string): boolean {
  const host = hostOf(url)
  if (!host) return true
  if (socialPage(url)) return false
  if (LISTING_HOSTS.has(host)) return true
  return host.split('.').slice(0, -1).some((label) => LISTING_SITES.has(label))
}

const NOT_A_PAGE = /^(?:groups|events|marketplace|search|watch|places|login|share|sharer|hashtag|reel|story|photo|people|help|policies|business)$/i

/**
 * A business's own Facebook page, as its canonical url: what the business says of itself,
 * which is all a business without a website publishes. Facebook's directories and searches aren't pages.
 */
export function facebookPage(url: string): string | undefined {
  try {
    const { hostname, pathname, searchParams } = new URL(url)
    if (!/^(?:(?:www|m|web)\.)?facebook\.com$/i.test(hostname)) return undefined
    const parts = pathname.split('/').filter(Boolean)
    if (parts[0] === 'profile.php') {
      const id = searchParams.get('id')
      return id && /^\d+$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : undefined
    }
    const page = parts[0] === 'p' || parts[0] === 'pages' ? parts.slice(0, parts[0] === 'p' ? 2 : 3) : parts.slice(0, 1)
    if (!page.length || page.length < (parts[0] === 'p' ? 2 : parts[0] === 'pages' ? 3 : 1) || NOT_A_PAGE.test(page[0])) return undefined
    return `https://www.facebook.com/${page.join('/')}`
  } catch {
    return undefined
  }
}

const NOT_A_PROFILE = /^(?:p|reel|reels|explore|stories|accounts|direct|tv|about|legal)$/i

/** A business's own Instagram profile, as its canonical url. Posts, reels and explore pages aren't profiles. */
export function instagramProfile(url: string): string | undefined {
  try {
    const { hostname, pathname } = new URL(url)
    if (!/^(?:www\.)?instagram\.com$/i.test(hostname)) return undefined
    const handle = pathname.split('/').filter(Boolean)[0]
    if (!handle || !/^[\w.]+$/.test(handle) || NOT_A_PROFILE.test(handle)) return undefined
    return `https://www.instagram.com/${handle}`
  } catch {
    return undefined
  }
}

/** The business's own Facebook page or Instagram profile. */
export function socialPage(url: string): string | undefined {
  return facebookPage(url) ?? instagramProfile(url)
}

export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

const MAX_TEXT = 12_000

/** The words a reader sees on the page, plus its description, without markup, scripts or styles. */
export function pageText(html: string): string {
  const description = metaDescription(html)
  const body = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|p|div|li|h[1-6]|tr|section|footer|header)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  return [description, body].filter(Boolean).join('\n').slice(0, MAX_TEXT)
}

/** Script-rendered sites often state their address only here; Instagram puts the bio in the plain one. */
function metaDescription(html: string): string | undefined {
  const texts = [metaContent(html, /^description$/i), metaContent(html, /^og:description$/i)]
  return [...new Set(texts.filter(Boolean))].join('\n') || undefined
}

function metaContent(html: string, key: RegExp): string | undefined {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const named = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!named || !key.test(named)) continue
    const text = decodeEntities(attribute(tag, 'content') ?? '').trim()
    if (text) return text
  }
  return undefined
}

export function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match ? (match[1] ?? match[2]) : undefined
}

const TAGLINE = /\s+[|–—·•:]\s+|\s+-\s+/
/** "Bakery in New York, NY": a title describing the place rather than naming it. */
const WHERE = /\s+in\s+[^,]+,\s*[A-Z]{2}$/
const NOT_A_NAME = /^(?:home|homepage|welcome|logo|menu|main|facebook|instagram(?: photos and videos)?|log in)$/i
/** A social handle after the name: "Homestretch Bar (@homestretchbar)". */
const HANDLE = /\(@[\w.]+\)/g
/** A country or company form a site appends to its name, "La Cabra USA" or "Joe's Pizza LLC", that the place itself isn't called. */
const ENTITY_SUFFIX = /,?\s+(?:USA|US|UK|NYC|Inc\.?|LLC|L\.L\.C\.|Ltd\.?|Corp\.?|GmbH|ApS|AB|AS|BV|SA|S\.A\.|Pty)$/

/**
 * What the site calls itself, most deliberate first: its declared site name, its logo's
 * alt text, then the title. Taglines after a separator come apart into their own candidates.
 */
export function siteNames(html: string): string[] {
  const logos = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => /logo/i.test(tag))
    .map((tag) => logoName(decodeEntities(attribute(tag, 'alt') ?? '')))
    // Alt text a site generated rather than wrote: "graphical user interface, text".
    .filter((alt) => /\p{Lu}/u.test(alt))
  const sources = [
    ...declaredNames(html),
    metaContent(html, /^og:site_name$/i),
    ...logos,
    metaContent(html, /^application-name$/i),
    pageTitle(html),
    metaContent(html, /^og:title$/i),
  ]
  const names = sources
    .flatMap((text) => text?.split(TAGLINE) ?? [])
    .map((name) => name.replace(HANDLE, ' ').replace(/\s+/g, ' ').trim().replace(ENTITY_SUFFIX, '').replace(/[,;:]+$|(?<=\p{L}{5})\.$/u, ''))
    .filter((name) => name && name.length <= 60 && !NOT_A_NAME.test(name) && !WHERE.test(name))
  return [...new Set(names)]
}

/** "Cafe Wands logo (ornament-stacked)" and "Logo of Cafe Wands" as "Cafe Wands". */
function logoName(alt: string): string {
  return alt
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(?:the\s+)?logo\s+(?:of|for)\s+/i, '')
    .replace(/\s+(?:brand\s+)?logo(?:type)?\b.*$/i, '')
    // A logo linking home: "Fairfax Home".
    .replace(/\s+home(?:page)?$/i, '')
    .trim()
}

export function pageTitle(html: string): string | undefined {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return title ? decodeEntities(title).replace(/\s+/g, ' ').trim() || undefined : undefined
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…',
  }
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity
    const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : entity
  })
}

const CONTACT = /contact|location|visit|find-?us|hours|directions|about/i
/** Pages that list addresses, ahead of an about page that may only tell a story. */
const ADDRESS_PAGE = /location|visit|find-?us|hours|directions|contact/i

/** Same-site pages likely to carry the address and hours, best first. */
export function contactLinks(html: string, base: string): string[] {
  const host = hostOf(base)
  const links = new Map<string, number>()
  for (const [, href, label] of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const words = `${href} ${label.replace(/<[^>]+>/g, '')}`
    if (!CONTACT.test(words)) continue
    try {
      const url = new URL(href, base)
      if (/^https?:$/.test(url.protocol) && sameSite(hostOf(url.href), host)) {
        url.hash = ''
        if (url.href !== new URL(base).href) {
          links.set(url.href, Math.min(links.get(url.href) ?? 1, ADDRESS_PAGE.test(words) ? 0 : 1))
        }
      }
    } catch {}
  }
  return [...links].sort((a, b) => a[1] - b[1]).map(([url]) => url)
}

function plainText(html: string): string {
  return decodeEntities(html).replace(/\s+/g, ' ').trim()
}

/** One host, or one a subdomain of the other: "locations.princestreetpizza.com" and "princestreetpizza.com". */
function sameSite(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`))
}

/** Every same-site link with its visible text, for picking one location's own page. */
export function siteLinks(html: string, base: string): { url: string; label: string }[] {
  const host = hostOf(base)
  const links = new Map<string, string>()
  for (const [tag, href, inner] of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decodeEntities(href).replace(/[&?]+$/, ''), base)
      url.hash = ''
      if (!/^https?:$/.test(url.protocol) || !sameSite(hostOf(url.href), host) || links.get(url.href)) continue
      const label = plainText(inner.replace(/<[^>]+>/g, ' ')) || plainText(attribute(tag, 'aria-label') ?? '')
      links.set(url.href, label || links.get(url.href) || '')
    } catch {}
  }
  return [...links].map(([url, label]) => ({ url, label }))
}

/** Lower case, accents and punctuation gone, "&" read as "and". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[øœ]/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim()
}

/** True when one name contains the other once normalised: "Joe's Pizza" and "Joe's Pizza Brooklyn". */
export function sameName(a: string, b: string): boolean {
  const [x, y] = [normalizeName(a), normalizeName(b)]
  if (!x || !y) return false
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)
}

/**
 * True when the typed name is the site's name, allowing one misspelled word:
 * "bookie lab bakery" for "Boogie Lab Bakery & Bistro".
 */
export function typedName(typed: string, name: string): boolean {
  if (spelledAs(typed, name)) return true
  const bare = squashedName(typed)
  return !!bare && bare === squashedName(name)
}

/** The name without its kind or spaces: "Homestretch Bar & Grill" and "The Home Stretch" both give "homestretch". */
function squashedName(name: string): string {
  return normalizeName(name.replace(KIND_WORDS, '')).replace(/ /g, '')
}

/** What kind of place it is, typed after its name: "Ruby's cafe" for a site that says "Ruby's". */
const KIND_WORDS =
  /(?:\s+(?:&\s*|and\s+)?(?:cafe|café|coffee|restaurant|bakery|bar|grill|kitchen|tavern|lounge|eatery|pub|bistro|diner|deli|pizzeria|shop|store))+$/i

function spelledAs(typed: string, name: string): boolean {
  if (sameName(typed, name)) return true
  const [want, have] = [normalizeName(typed).split(' '), normalizeName(name).split(' ')]
  if (!want[0] || !have[0]) return false
  for (let start = 0; start + want.length <= have.length; start++) {
    const typos = want.flatMap((word, index) => (word === have[start + index] ? [] : [[word, have[start + index]]]))
    if (typos.length === 1 && closeSpelling(typos[0][0], typos[0][1])) return true
  }
  return false
}

function closeSpelling(a: string, b: string): boolean {
  return Math.min(a.length, b.length) >= 5 && !/\d/.test(a + b) && editDistance(a, b) === 1
}

/** Edits between two words, a swapped pair of letters counting as one. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}
