const AUTH_URL = 'https://openrouter.ai/auth'

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function randomToken(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export function authorizeUrl(options: {
  callbackUrl: string
  challenge: string
  state: string
  keyLabel: string
}): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set('callback_url', options.callbackUrl)
  url.searchParams.set('code_challenge', options.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', options.state)
  url.searchParams.set('key_label', options.keyLabel)
  return url.toString()
}
