import { describe, test, expect, afterEach } from 'bun:test'
import {
  assertPublicUrl,
  isNonPublicAddress,
  OutboundAddressError,
  outboundRequestConfig,
} from './outbound-fetch'

describe('isNonPublicAddress', () => {
  test.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd00:ec2::254',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isNonPublicAddress(address)).toBe(true)
  })

  test.each(['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111'])(
    'allows %s',
    (address) => {
      expect(isNonPublicAddress(address)).toBe(false)
    },
  )
})

describe('assertPublicUrl', () => {
  const previous = { ...process.env }
  afterEach(() => {
    process.env.OUTBOUND_ALLOW_PRIVATE = previous.OUTBOUND_ALLOW_PRIVATE
    process.env.NODE_ENV = previous.NODE_ENV
  })

  test('rejects a literal private address', async () => {
    process.env.OUTBOUND_ALLOW_PRIVATE = 'false'
    await expect(assertPublicUrl('http://169.254.169.254/latest')).rejects.toThrow(
      OutboundAddressError,
    )
    await expect(assertPublicUrl('http://[fd00::1]:8080/')).rejects.toThrow(OutboundAddressError)
  })

  test('rejects localhost in production', async () => {
    process.env.OUTBOUND_ALLOW_PRIVATE = 'false'
    process.env.NODE_ENV = 'production'
    await expect(assertPublicUrl('http://localhost:5000/')).rejects.toThrow(OutboundAddressError)
  })

  test('allows localhost outside production for local federation', async () => {
    process.env.OUTBOUND_ALLOW_PRIVATE = 'false'
    process.env.NODE_ENV = 'development'
    await expect(assertPublicUrl('http://localhost:5001/')).resolves.toBeUndefined()
  })

  test('the override allows private networks', async () => {
    process.env.OUTBOUND_ALLOW_PRIVATE = 'true'
    await expect(assertPublicUrl('http://10.0.0.5/')).resolves.toBeUndefined()
  })

  test('allows a public literal address', async () => {
    process.env.OUTBOUND_ALLOW_PRIVATE = 'false'
    await expect(assertPublicUrl('https://1.1.1.1/')).resolves.toBeUndefined()
  })
})

describe('outboundRequestConfig.lookup', () => {
  const previous = { ...process.env }
  afterEach(() => {
    process.env.OUTBOUND_ALLOW_PRIVATE = previous.OUTBOUND_ALLOW_PRIVATE
    process.env.NODE_ENV = previous.NODE_ENV
  })

  test('refuses a private address at connect time', async () => {
    process.env.OUTBOUND_ALLOW_PRIVATE = 'false'
    process.env.NODE_ENV = 'production'
    await expect(outboundRequestConfig.lookup('localhost')).rejects.toThrow(
      OutboundAddressError,
    )
  })

  test('returns the addresses it validated', async () => {
    process.env.OUTBOUND_ALLOW_PRIVATE = 'false'
    await expect(outboundRequestConfig.lookup('1.1.1.1')).resolves.toEqual([
      { address: '1.1.1.1', family: 4 },
    ])
  })
})
