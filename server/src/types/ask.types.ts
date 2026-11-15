import type { Place } from './place.types'
import type { IsochroneGeometry } from './isochrone.types'
import type { QueryIntent } from './search.types'

export interface LatLng {
  lat: number
  lng: number
}

export type AskUnits = 'metric' | 'imperial'

/** A point Ask can name. A saved place reaches the model only by its name, never its coordinates. */
export interface AskEndpoint extends LatLng {
  name?: string
}

export const ASK_TRIP_KINDS = ['bikeshare', 'transit', 'walking', 'biking', 'driving', 'rideshare'] as const
export type AskTripKind = (typeof ASK_TRIP_KINDS)[number]

/** Where the user is and what they call places, sent with each question. */
export interface AskWhere {
  /** The map's centre. */
  lat?: number
  lng?: number
  /** The device's own position, when shared. */
  here?: LatLng
  places?: AskEndpoint[]
  units?: AskUnits
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
  /** A trip the answer recommends, for the app to open in Directions. */
  | { type: 'trip'; from: AskEndpoint; to: AskEndpoint; kind: AskTripKind }
  | {
      type: 'answer'
      text: string
      places: AskCitation[]
      /** The same question as a classic category search, when it names a category. */
      browse?: QueryIntent
    }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type AskKeySource = 'own' | 'system'

/** This month's allowance on the system key. */
export interface AskQuota {
  used: number
  limit: number
  remaining: number
  /** ISO time the allowance refills. */
  resetsAt: string
}

export type AskAccess =
  | { allowed: true; keySource: 'own' }
  /** `quota` is null when the system key has no monthly limit. */
  | { allowed: true; keySource: 'system'; quota: AskQuota | null }
  | { allowed: false; reason: 'not-configured' | 'not-permitted' }
  | { allowed: false; reason: 'quota-exceeded'; limit: number; resetsAt: string }
