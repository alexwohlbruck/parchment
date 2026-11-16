import { describe, expect, test } from 'bun:test'
import { otpTokenHeader } from './otp-token'

describe('otpTokenHeader', () => {
  test('preserves leading zeros and binds to the canonical website origin', () => {
    expect(otpTokenHeader('00123456', 'https://APP.Example.com:443/login')).toBe(
      '"00123456"; origin="https://app.example.com"',
    )
  })

  test('allows local development origins with their port', () => {
    expect(otpTokenHeader('12345678', 'http://localhost:5173')).toBe(
      '"12345678"; origin="http://localhost:5173"',
    )
  })

  test('omits metadata for invalid codes or untrusted origins', () => {
    for (const origin of [undefined, 'invalid', 'http://example.com', 'data:text/plain,code']) {
      expect(otpTokenHeader('12345678', origin)).toBeUndefined()
    }
    for (const code of ['1234567', '123456789', '1234 5678', '12345678\r\nX-Test: injected']) {
      expect(otpTokenHeader(code, 'https://example.com')).toBeUndefined()
    }
  })
})
