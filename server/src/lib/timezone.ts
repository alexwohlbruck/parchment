// geo-tz ships CJS-only; bun's bundler can't resolve named exports from CJS,
// so we use require() to avoid the "undefined import" warning at build time.
const { find } = require('geo-tz') as typeof import('geo-tz')

export function getTimezone(lat: number, lng: number): string | null {
  const results = find(lat, lng)
  return results[0] ?? null
}
