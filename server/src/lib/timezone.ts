// geo-tz ships CJS-only; bun's bundler can't resolve named exports from CJS,
// so we use require() to avoid the "undefined import" warning at build time.
let find: typeof import('geo-tz').find | undefined

export function getTimezone(lat: number, lng: number): string | null {
  // Resolved on first use: geo-tz carries a sizeable dataset, and importing
  // this module shouldn't cost a server that never asks for a timezone.
  find ??= (require('geo-tz') as typeof import('geo-tz')).find
  return find(lat, lng)[0] ?? null
}
