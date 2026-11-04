import type { StationEntrance } from '../../types/integration.types'
import type { StationEntranceRef } from '../../types/trip.types'

const present = (v: string | null | undefined) => (v ? v : undefined)

/** What to call an entrance on the map: its OSM name or ref, else where it is. */
export function entranceWaypointLabel(e: StationEntrance): string | undefined {
  return present(e.name) ?? present(e.ref) ?? present(e.cornerLabel) ?? present(e.description)
}

/** The entrance as a walk leg reports it, or null when nothing names it. */
export function entranceRef(e: StationEntrance, role: StationEntranceRef['role']): StationEntranceRef | null {
  if (!entranceWaypointLabel(e)) return null
  return {
    role,
    name: present(e.name),
    ref: present(e.ref),
    description: present(e.description),
    cornerLabel: present(e.cornerLabel),
    ...(e.entryAllowed === false && { entryAllowed: false }),
    ...(e.exitAllowed === false && { exitAllowed: false }),
    accessType: e.accessType,
  }
}
