import type { Place } from './place.types'
import type { IsochroneGeometry } from './isochrone.types'

export interface LatLng {
  lat: number
  lng: number
}

export interface AskTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskCitation {
  place: Place
  reason: string
}

export type AskEvent =
  | { type: 'step'; id: string; label: string; status: 'running' | 'done' | 'failed' }
  | { type: 'reach'; geometry: IsochroneGeometry }
  | { type: 'answer'; text: string; places: AskCitation[] }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type AskAccess =
  | { allowed: true; keySource: 'own' | 'system' }
  | { allowed: false; reason: 'not-configured' | 'not-permitted' }
