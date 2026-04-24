import { describe, test, expect } from 'bun:test'
import { passkeyNameFromAAGUID } from './passkey-aaguid'

// Real-world UA strings for the fallback path.
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
const WIN_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0'

describe('passkeyNameFromAAGUID', () => {
  test('uses AAGUID map when the GUID is known (iCloud Keychain)', () => {
    expect(
      passkeyNameFromAAGUID('fbfc3007-154e-4ecc-8c0b-6e020557d7bd', MAC_CHROME),
    ).toBe('iCloud Keychain')
  })

  test('case-insensitive AAGUID lookup', () => {
    expect(
      passkeyNameFromAAGUID('FBFC3007-154E-4ECC-8C0B-6E020557D7BD', MAC_CHROME),
    ).toBe('iCloud Keychain')
  })

  test('falls back to OS + browser when AAGUID is all zeros', () => {
    expect(
      passkeyNameFromAAGUID(
        '00000000-0000-0000-0000-000000000000',
        MAC_CHROME,
      ),
    ).toContain('Chrome')
  })

  test('falls back to OS + browser when AAGUID is unknown', () => {
    expect(
      passkeyNameFromAAGUID(
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        WIN_EDGE,
      ),
    ).toMatch(/Edge|Edg/)
  })

  test('returns "Passkey" when both AAGUID and UA are unusable', () => {
    expect(passkeyNameFromAAGUID(undefined, undefined)).toBe('Passkey')
    expect(passkeyNameFromAAGUID('', '')).toBe('Passkey')
  })

  test('returns a recognizable label with only a UA (no AAGUID)', () => {
    const name = passkeyNameFromAAGUID(undefined, MAC_CHROME)
    expect(name).toContain('Chrome')
  })
})
