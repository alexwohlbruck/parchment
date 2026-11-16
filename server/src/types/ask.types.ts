import type { Place } from './place.types'
import type { IsochroneGeometry } from './isochrone.types'
import type { QueryIntent } from './search.types'
import type { MultimodalTripResponse, Vehicle } from './trip.types'

export interface LatLng {
  lat: number
  lng: number
}

export type AskUnits = 'metric' | 'imperial'

/** A point Ask can name. A saved place reaches the model only by its name, never its coordinates. */
export interface AskEndpoint extends LatLng {
  name?: string
  /** The place a looked-up name resolved to. */
  placeId?: string
  /** The user's own position, which the app shows as its current location. */
  here?: true
}

/** A stop on the way, and how long to stay. */
export interface AskStop extends AskEndpoint {
  minutes?: number
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
  /** The user's vehicles, as Directions sends them. */
  vehicles?: Vehicle[]
}

/** When a trip leaves or must arrive; absent for leaving now. */
export interface AskTripTime {
  mode: 'departAfter' | 'arriveBy'
  /** ISO 8601. */
  at: string
}

export interface AskTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskCitation {
  place: Place
  reason: string
}

/** A web page Ask read to answer. */
export interface AskSource {
  url: string
  title: string
}

export type AskEvent =
  | {
      type: 'step'
      id: string
      /** The tool that ran, for its icon. */
      tool: string
      label: string
      /** What it looked for, e.g. the search text. */
      detail?: string
      status: 'running' | 'done' | 'failed'
      /** How many things it found, once done. */
      found?: number
    }
  | { type: 'reach'; geometry: IsochroneGeometry }
  /** A trip the answer recommends, for the app to open in Directions. */
  | {
      type: 'trip'
      from: AskEndpoint
      to: AskEndpoint
      kind: AskTripKind
      /** Places the trip stops at on the way, in order. */
      stops?: AskStop[]
      time?: AskTripTime
      /** The transit lines the proposed trip rides, in order, for matching it when there is no plan. */
      lines?: string[]
      /** The plan the answer was written from, and which of its trips it proposes. */
      plan?: MultimodalTripResponse
      tripIndex?: number
    }
  | {
      type: 'answer'
      text: string
      places: AskCitation[]
      /** The same question as a classic category search, when it names a category. */
      browse?: QueryIntent
      /** Questions the user might ask next. */
      followUps?: string[]
      /** Web pages the answer drew on. */
      sources?: AskSource[]
    }
  /** A canvas a tool saved to the user's library. */
  | { type: 'canvas'; id: string; name: string }
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
  /** `turned-off`: the user switched Ask off in settings. */
  | { allowed: false; reason: 'not-configured' | 'not-permitted' | 'turned-off' }
  | { allowed: false; reason: 'quota-exceeded'; limit: number; resetsAt: string }
