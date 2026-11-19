export function otpTokenHeader(code: string, websiteOrigin: string | undefined): string | undefined {
  if (!/^\d{8}$/.test(code) || !websiteOrigin) return undefined

  try {
    const url = new URL(websiteOrigin)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return undefined
    return `"${code}"; origin="${url.origin}"`
  } catch {
    return undefined
  }
}
