import type { Place } from './place.types'
import type { IsochroneGeometry } from './isochrone.types'
import type { QueryIntent } from './search.types'

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
