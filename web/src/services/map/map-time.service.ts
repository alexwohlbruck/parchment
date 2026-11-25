type MapTimeListener = (fixed: Date | null) => void

let fixed: Date | null = null
const listeners = new Set<MapTimeListener>()

/** The instant temporal layers draw: the chosen time, or the clock while none is chosen. */
export function mapTime(): Date {
  return fixed ? new Date(fixed) : new Date()
}

export function isMapTimeLive(): boolean {
  return fixed === null
}

/** Pins every temporal layer to `date`; null follows the clock again. */
export function setMapTime(date: Date | null) {
  const next = date && !Number.isNaN(date.getTime()) ? new Date(date) : null
  if (next?.getTime() === fixed?.getTime()) return
  fixed = next
  for (const listener of [...listeners]) listener(fixed)
}

export function onMapTimeChange(listener: MapTimeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
