import { find } from 'geo-tz'

export function getTimezone(lat: number, lng: number): string | null {
  const results = find(lat, lng)
  return results[0] ?? null
}
