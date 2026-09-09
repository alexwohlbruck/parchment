/**
 * Friendly-name lookup for passkey authenticators.
 *
 * Every WebAuthn credential carries an AAGUID — a 16-byte UUID that
 * identifies the make/model of the authenticator (iCloud Keychain,
 * Windows Hello, a specific YubiKey series, 1Password, etc.). The
 * FIDO Alliance + passkey-dev community maintain a public mapping
 * between AAGUIDs and human names:
 *
 *   https://github.com/passkeydeveloper/passkey-authenticator-aaguids
 *
 * We embed a curated subset here (the mainstream password managers +
 * OS credential stores most users will actually register from) so we
 * can auto-name new passkeys like "iCloud Keychain" or "1Password"
 * without the user having to type anything.
 *
 * When the AAGUID is unknown or the all-zero sentinel that some hybrid
 * / browser passkeys use, fall back to parsing the User-Agent string
 * into a "macOS · Chrome" style label — whatever the browser exposes,
 * which is good enough for a sign-in Settings UI.
 */

import { UAParser } from 'ua-parser-js'

// Normalized to lowercase so the lookup doesn't depend on what
// formatting simplewebauthn happens to emit.
const AAGUID_NAMES: Record<string, string> = {
  // Apple
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain (managed)',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  'b84e4048-15dc-4dd0-8640-f4f60813c8af': 'NordPass',
  'de1e552d-db1d-4423-a619-566b625cdc84': 'Enpass',
  'f3809540-7f14-49c1-a8b3-8f813b225541': 'Enpass',
  'e77e3c64-05e3-428b-8824-0cbeb04b829d': 'Samsung Pass',
  // Google
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  // Microsoft
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  // Common hardware keys
  'cb69481e-8ff7-4039-93ec-0a2729a154a8': 'YubiKey 5 Series',
  'fa2b99dc-9e39-4257-8f92-4a30d23c4118': 'YubiKey 5 NFC',
  'c1f9a0bc-1dd2-404a-b27f-8e29047a43fd': 'YubiKey 5 FIPS',
  'b93fd961-f2e6-462f-b122-82002247de78': 'Android (platform)',
}

const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000'

/**
 * Build a friendly display name for a newly-registered passkey.
 *
 *   - If the AAGUID is in our map, use that directly.
 *   - If it's the zero AAGUID (browser hybrid / unknown authenticator),
 *     fall back to "{OS} · {Browser}" from the User-Agent.
 *   - If the UA can't be parsed either, fall back to "Passkey".
 *
 * The UA-derived label is deliberately coarse: "macOS · Chrome", not
 * "macOS 15.0.1 · Chrome 147.0.0.0". Users don't care about the minor
 * version, and Apple spoofs the macOS version on the web anyway.
 */
export function passkeyNameFromAAGUID(
  aaguid: string | undefined,
  userAgent: string | undefined,
): string {
  if (aaguid) {
    const normalized = aaguid.toLowerCase()
    const mapped = AAGUID_NAMES[normalized]
    if (mapped) return mapped
    if (normalized !== ZERO_AAGUID) {
      // Unknown-but-present AAGUID: prefer the UA hint over "Passkey"
      // since the UA at least tells the user where it was registered.
    }
  }

  if (userAgent) {
    const parsed = new UAParser(userAgent)
    const osName = parsed.getOS().name
    const browserName = parsed.getBrowser().name
    const parts = [osName, browserName].filter(Boolean)
    if (parts.length > 0) return parts.join(' · ')
  }

  return 'Passkey'
}
