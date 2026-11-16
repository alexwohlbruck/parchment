/** "grownyc.org" for a page on www.grownyc.org; the url itself when it won't parse. */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
