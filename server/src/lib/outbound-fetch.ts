import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/** Upper bound on a response body read from a host a user or peer named. */
export const OUTBOUND_MAX_BYTES = 2 * 1024 * 1024

const blockedV4 = new BlockList()
const blockedV6 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6')
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1'])

export class OutboundAddressError extends Error {
  constructor(host: string) {
    super(`Refusing to reach non-public host ${host}`)
    this.name = 'OutboundAddressError'
  }
}

/** True for any address that is not routable on the public internet. */
export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return blockedV4.check(address, 'ipv4')
  if (family !== 6) return true
  const mapped = mappedIPv4(address)
  if (mapped) return blockedV4.check(mapped, 'ipv4')
  return blockedV6.check(address, 'ipv6')
}

/** The IPv4 address inside an IPv4-mapped IPv6 address (::ffff:a.b.c.d). */
function mappedIPv4(address: string): string | null {
  const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1)
  const match = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!match) return null
  const [high, low] = [parseInt(match[1], 16), parseInt(match[2], 16)]
  return [high >> 8, high & 255, low >> 8, low & 255].join('.')
}

function allowsNonPublic(hostname: string): boolean {
  if (process.env.OUTBOUND_ALLOW_PRIVATE === 'true') return true
  return process.env.NODE_ENV !== 'production' && LOOPBACK_NAMES.has(hostname)
}

async function resolvePublicAddresses(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const family = isIP(host)
  const entries = family
    ? [{ address: host, family }]
    : await lookup(host, { all: true })
  if (allowsNonPublic(host)) return entries
  if (entries.length === 0 || entries.some((e) => isNonPublicAddress(e.address))) {
    throw new OutboundAddressError(host)
  }
  return entries
}

/**
 * Resolve the URL's host and throw unless every address it resolves to is
 * public. Set OUTBOUND_ALLOW_PRIVATE=true to reach private networks (local
 * federation, a self-hosted service on the LAN).
 */
export async function assertPublicUrl(url: string | URL): Promise<void> {
  const { hostname } = new URL(url)
  if (allowsNonPublic(hostname.replace(/^\[|\]$/g, '').toLowerCase())) return
  await resolvePublicAddresses(hostname)
}

/**
 * Axios options for a request to a host someone else chose. `lookup` re-checks
 * the address axios actually connects to, so a DNS answer that changes after
 * assertPublicUrl (rebinding) cannot reach a private network.
 */
export const outboundRequestConfig = {
  maxRedirects: 0,
  maxContentLength: OUTBOUND_MAX_BYTES,
  maxBodyLength: OUTBOUND_MAX_BYTES,
  lookup: resolvePublicAddresses,
} as const
