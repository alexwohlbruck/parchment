import { attribute } from './site-page'

/** Words in an image's alt text, file name, class or id that say it may carry the address. */
const ADDRESS_HINT = /logo|address|location|visit|contact|find[-_ ]?us|directions|map|hours|sign|storefront|brand/i
/** Images that are something else entirely. */
const NOT_ADDRESS = /icon|avatar|sprite|pixel|badge|payment|instagram|facebook|twitter|tiktok|yelp|google|apple|arrow|chevron|spinner|loading/i
const MIN_SIDE_PX = 80
const MAX_IMAGES = 2

/**
 * The few images on a page most likely to show its address, best first: ones named
 * as a logo, a sign or a location, with those in the header or footer ahead.
 */
export function addressImages(html: string): string[] {
  const edges = [...html.matchAll(/<(header|footer)\b[\s\S]*?<\/\1>/gi)].map((match) => [
    match.index!,
    match.index! + match[0].length,
  ])
  const scored = [...html.matchAll(/<img\b[^>]*>/gi)].flatMap((match) => {
    const tag = match[0]
    const src = attribute(tag, 'src')
    if (!src || src.startsWith('data:')) return []
    const words = ['alt', 'class', 'id', 'title'].map((name) => attribute(tag, name) ?? '').join(' ') + ` ${src}`
    const sides = ['width', 'height'].map((name) => Number(attribute(tag, name)))
    if (NOT_ADDRESS.test(words) || sides.some((side) => side > 0 && side < MIN_SIDE_PX)) return []
    const inEdge = edges.some(([start, end]) => match.index! > start && match.index! < end)
    const score = (ADDRESS_HINT.test(words) ? 2 : 0) + (inEdge ? 1 : 0)
    return score ? [{ src, score }] : []
  })
  return [...new Set(scored.sort((a, b) => b.score - a.score).map(({ src }) => src))].slice(0, MAX_IMAGES)
}
