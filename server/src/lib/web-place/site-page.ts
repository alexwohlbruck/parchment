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
  if (LISTING_HOSTS.has(host)) return true
  return host.split('.').slice(0, -1).some((label) => LISTING_SITES.has(label))
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

/** Script-rendered sites often state their address only here. */
function metaDescription(html: string): string | undefined {
  return metaContent(html, /^(?:og:)?description$/i)
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

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match ? (match[1] ?? match[2]) : undefined
}

const TAGLINE = /\s+[|–—·:]\s+|\s+-\s+/

/**
 * What the site calls itself, most deliberate first: its declared site name, its logo's
 * alt text, then the title. Taglines after a separator come apart into their own candidates.
 */
export function siteNames(html: string): string[] {
  const logos = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => /logo/i.test(tag))
    .map((tag) => decodeEntities(attribute(tag, 'alt') ?? '').replace(/\s+logo$/i, ''))
  const sources = [
    metaContent(html, /^og:site_name$/i),
    ...logos,
    metaContent(html, /^application-name$/i),
    pageTitle(html),
    metaContent(html, /^og:title$/i),
  ]
  const names = sources
    .flatMap((text) => text?.split(TAGLINE) ?? [])
    .map((name) => name.replace(/\s+/g, ' ').trim())
    .filter((name) => name && name.length <= 60)
  return [...new Set(names)]
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

/** Same-site pages likely to carry the address and hours, best first. */
export function contactLinks(html: string, base: string): string[] {
  const host = hostOf(base)
  const links = new Set<string>()
  for (const [, href, label] of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!CONTACT.test(href) && !CONTACT.test(label.replace(/<[^>]+>/g, ''))) continue
    try {
      const url = new URL(href, base)
      if (/^https?:$/.test(url.protocol) && hostOf(url.href) === host) {
        url.hash = ''
        if (url.href !== new URL(base).href) links.add(url.href)
      }
    } catch {}
  }
  return [...links]
}

/** Lower case, accents and punctuation gone, "&" read as "and". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
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
