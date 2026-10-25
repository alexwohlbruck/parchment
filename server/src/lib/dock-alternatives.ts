// Which nearby bike share stations can stand in for one that is filling up or running dry.

export type DockNeed = 'dock' | 'bike'

export interface NearbyStation {
  type?: string
  stationId: string
  name: string
  lat: number
  lon: number
  numBikesAvailable: number
  numEbikesAvailable?: number
  numDocksAvailable: number
  isRenting: boolean
  isReturning: boolean
}

export interface DockAlternative {
  stationId: string
  name: string
  location: { lat: number; lng: number }
  available: number
  /** Metres from the station being replaced. */
  fromOriginal: number
  /** Metres to where the traveller is ultimately going, when given. */
  toTarget: number | null
}

const SAME_STATION_METERS = 15

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const cos = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.hypot((b.lng - a.lng) * cos, b.lat - a.lat) * 111_320
}

export function availableFor(station: NearbyStation, need: DockNeed): number {
  return need === 'dock' ? station.numDocksAvailable : station.numBikesAvailable + (station.numEbikesAvailable ?? 0)
}

/** Stations with at least `min` of what is needed, nearest the target first (else the original). */
export function rankAlternatives(
  stations: NearbyStation[],
  original: { lat: number; lng: number },
  need: DockNeed,
  min: number,
  target: { lat: number; lng: number } | null,
): DockAlternative[] {
  return stations
    .filter(s => (s.type ?? 'station') === 'station')
    .filter(s => (need === 'dock' ? s.isReturning : s.isRenting) && availableFor(s, need) >= min)
    .map(s => {
      const location = { lat: s.lat, lng: s.lon }
      return {
        stationId: s.stationId,
        name: s.name,
        location,
        available: availableFor(s, need),
        fromOriginal: metres(original, location),
        toTarget: target ? metres(location, target) : null,
      }
    })
    .filter(a => a.fromOriginal > SAME_STATION_METERS)
    .sort((a, b) => (a.toTarget ?? a.fromOriginal) - (b.toTarget ?? b.fromOriginal))
}
