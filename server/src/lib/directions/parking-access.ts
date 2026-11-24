/** OSM access values that mean the public can't just park there. */
const NOT_PUBLIC = new Set([
  'private', 'no', 'permit', 'permit_holders', 'residents', 'resident',
  'employees', 'staff', 'military', 'agricultural', 'forestry', 'delivery',
])

export function isPublicParking(tags?: Record<string, string> | null): boolean {
  const access = tags?.access
  return !access || !NOT_PUBLIC.has(access)
}
