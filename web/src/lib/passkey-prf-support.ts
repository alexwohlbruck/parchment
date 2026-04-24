/**
 * Browser-side PRF support detection and response parsing.
 *
 * Static detection of WebAuthn PRF support is NOT reliable — the
 * authenticator is what ultimately supports PRF, and the only certain
 * signal is `clientExtensionResults.prf.results.first` (or `.enabled`)
 * coming back from an actual ceremony. We therefore:
 *   1. `isProbablyPrfSupported()` — a cheap pre-check used to hide or
 *      gray-out the passkey-recovery UI on browsers that obviously can't
 *      do WebAuthn at all.
 *   2. `extractPrfOutputFromRegistration()` / `extractPrfOutputFromAssertion()`
 *      — pull the raw 32-byte PRF output from a simplewebauthn ceremony
 *      response. Returns null if the extension didn't fire (caller then
 *      knows to prompt a second ceremony or fall back to recovery key).
 *
 * Note: `@simplewebauthn/browser` exposes `clientExtensionResults` on the
 * `RegistrationResponseJSON` / `AuthenticationResponseJSON` as
 * base64url strings rather than raw ArrayBuffers (matching the JSON wire
 * shape). We decode them here.
 */

export function isProbablyPrfSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.PublicKeyCredential === 'undefined') return false
  if (!('credentials' in navigator)) return false
  return true
}

export function base64urlToBytes(input: string): Uint8Array {
  // Tolerate both base64 and base64url inputs — simplewebauthn normalizes
  // but we stay permissive in case a future version shifts.
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * `@simplewebauthn/browser` v10 converts the known JSON-string fields
 * (challenge, allowCredentials[].id, user.id) to ArrayBuffers before
 * handing options to `navigator.credentials.*`, but it does NOT recurse
 * into `extensions`. For the `prf` extension that means `eval.first`
 * stays a base64url string, which the browser then rejects because it
 * expects a `BufferSource` there.
 *
 * Mutate the options in place so PRF eval inputs become Uint8Array
 * before the ceremony is dispatched. Safe to call on options that don't
 * carry a PRF extension.
 */
export function hydratePrfExtensionInPlace(options: {
  extensions?: {
    prf?: {
      eval?: { first?: unknown; second?: unknown }
      evalByCredential?: Record<
        string,
        { first?: unknown; second?: unknown }
      >
    }
  }
}): void {
  const prf = options.extensions?.prf
  if (!prf) return
  if (prf.eval) {
    if (typeof prf.eval.first === 'string') {
      prf.eval.first = base64urlToBytes(prf.eval.first)
    }
    if (typeof prf.eval.second === 'string') {
      prf.eval.second = base64urlToBytes(prf.eval.second)
    }
  }
  if (prf.evalByCredential) {
    for (const credId of Object.keys(prf.evalByCredential)) {
      const entry = prf.evalByCredential[credId]
      if (typeof entry.first === 'string') {
        entry.first = base64urlToBytes(entry.first)
      }
      if (typeof entry.second === 'string') {
        entry.second = base64urlToBytes(entry.second)
      }
    }
  }
}

interface PrfResults {
  // The shape depends on WHO handed us the response:
  //   - Raw WebAuthn (navigator.credentials.*.getClientExtensionResults())
  //     returns an ArrayBuffer.
  //   - simplewebauthn-browser v10 passes `clientExtensionResults` through
  //     unchanged on AuthenticationResponseJSON / RegistrationResponseJSON
  //     (i.e. still an ArrayBuffer — it does NOT stringify extensions).
  //   - Some servers encode to base64url if they round-trip extensions.
  // We accept all three and normalise to Uint8Array.
  first?: ArrayBuffer | ArrayBufferView | string
  second?: ArrayBuffer | ArrayBufferView | string
}

interface PrfExtensionResult {
  enabled?: boolean
  results?: PrfResults
}

type ResponseWithExtensions = {
  clientExtensionResults?: {
    prf?: PrfExtensionResult
  }
}

function coercePrfFirstToBytes(
  first: ArrayBuffer | ArrayBufferView | string | undefined | null,
): Uint8Array | null {
  if (first == null) return null
  if (typeof first === 'string') {
    if (first.length === 0) return null
    try {
      return base64urlToBytes(first)
    } catch {
      return null
    }
  }
  if (first instanceof ArrayBuffer) {
    return new Uint8Array(first.slice(0))
  }
  if (ArrayBuffer.isView(first)) {
    // TypedArray / DataView — copy to a clean Uint8Array so callers can't
    // mutate the shared buffer the authenticator handed us.
    return new Uint8Array(
      first.buffer.slice(
        first.byteOffset,
        first.byteOffset + first.byteLength,
      ),
    )
  }
  return null
}

/**
 * If the registration response carried a PRF output (some authenticators
 * evaluate in-band when `prf.eval.first` is passed at create time), return
 * it as bytes. Otherwise null — caller should do a follow-up assertion.
 */
export function extractPrfOutputFromRegistration(
  response: ResponseWithExtensions,
): Uint8Array | null {
  return coercePrfFirstToBytes(
    response.clientExtensionResults?.prf?.results?.first,
  )
}

/**
 * Check whether the newly-registered credential at least advertises PRF
 * support (`prf.enabled === true`). If false, the authenticator doesn't
 * support PRF at all — we must not build a slot for it.
 */
export function registrationHasPrfEnabled(
  response: ResponseWithExtensions,
): boolean {
  return response.clientExtensionResults?.prf?.enabled === true
}

/**
 * PRF output from an authentication assertion. Same shape as registration
 * but without the `enabled` flag.
 */
export function extractPrfOutputFromAssertion(
  response: ResponseWithExtensions,
): Uint8Array | null {
  return coercePrfFirstToBytes(
    response.clientExtensionResults?.prf?.results?.first,
  )
}
