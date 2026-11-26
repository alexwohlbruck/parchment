import type { AskCitation, AskEvent, AskSkill, AskSource } from '@server/types/ask.types'
import type { IsochroneGeometry } from '@server/types/isochrone.types'
import type { QueryIntent } from '@/types/search.types'
import type { TripsResponse } from '@/types/directions.types'
import type { PlaceDraft } from '@/types/place.types'

export { ASK_SKILLS } from '@server/types/ask.types'

export type {
  AskAccess,
  AskCitation,
  AskEndpoint,
  AskStop,
  AskEvent,
  AskPoint,
  AskSkill,
  AskSource,
  AskTripKind,
  AskTurn,
  AskUnits,
  AskWhere,
} from '@server/types/ask.types'
export type { AskHistoryDays, AskPreferences } from '@server/types/ask-preferences.types'

export type AskStep = Omit<Extract<AskEvent, { type: 'step' }>, 'type'>

export type AskTrip = Omit<Extract<AskEvent, { type: 'trip' }>, 'type'>

/** The proposed trip as Directions planned it, for the card and the map. */
export interface AskTripPlan {
  trips: TripsResponse
  tripId: string
}

export interface AskExchange {
  /** What the user asked, or a skill's subject. */
  question: string
  skill?: AskSkill
  steps: AskStep[]
  text: string
  places: AskCitation[]
  /** Places a lookup is still reading, by lookup, until the answer cites what it found. */
  drafts?: Record<string, PlaceDraft>
  /** The travel-time area a question like "within a 10 min walk" searched. */
  reach?: IsochroneGeometry
  browse?: QueryIntent
  followUps?: string[]
  sources?: AskSource[]
  /** When the question was sent and answered, for "Searched for 6s". */
  startedAt: number
  finishedAt?: number
  /** The trip the answer recommends, to open in Directions. */
  trip?: AskTrip
  /** Undefined while Directions plans it; null when it couldn't. */
  plan?: AskTripPlan | null
  /** A canvas the answer saved to the library. */
  canvas?: { id: string; name: string }
  /** A route the answer saved to the library. */
  route?: { id: string; name: string }
  status: 'running' | 'done' | 'error'
  error?: string
}

/** A conversation as kept in history, end-to-end encrypted on the account. */
export interface AskThread {
  id: string
  /** The first question. */
  title: string
  createdAt: number
  /** Last used; history expires from here. */
  at: number
  exchanges: AskExchange[]
}
