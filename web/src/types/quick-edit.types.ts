// Import the types from the server
import type {
  OsmElementType,
  OsmLiveElement,
  SubmitEditInput,
  SubmitEditResult,
} from '@server/services/osm-edit.service'
import type {
  FieldDefinition,
  GeometryType,
  PresetSearchResult,
} from '@server/lib/osm-presets'
import type { OsmEdit } from '@server/schema/osm-edits.schema'
import type { NsiBrand } from '@server/lib/nsi'

export type {
  NsiBrand,
  OsmElementType,
  OsmLiveElement,
  SubmitEditInput,
  SubmitEditResult,
  FieldDefinition,
  GeometryType,
  PresetSearchResult,
  OsmEdit,
}

/** A preset with its editable field definitions, as served by GET /osm/presets/:id. */
export interface EditablePreset {
  id: string
  name: string
  icon: string
  geometry: GeometryType[]
  tags: Record<string, string>
  addTags?: Record<string, string>
  fields: FieldDefinition[]
}

/** A chain a feature's name matches, with the tags it would add or correct. */
export interface BrandSuggestion {
  brand: NsiBrand
  diff: Array<{ key: string; from: string | null; to: string }>
}

export interface DuplicateCandidate {
  osm: string
  name: string | null
  placeType: string | null
  lat: number
  lng: number
  distanceM: number
}
