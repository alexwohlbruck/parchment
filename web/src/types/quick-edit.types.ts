// Import the types from the server
import type {
  OsmElementType,
  OsmLiveElement,
  SubmitEditInput,
  SubmitEditResult,
} from '@server/services/osm-edit.service'
import type { FieldDefinition, GeometryType } from '@server/lib/osm-presets'
import type { OsmEdit } from '@server/schema/osm-edits.schema'
import type { NsiBrand } from '@server/lib/nsi'
import type { TagSuggestion } from '@server/lib/osm-taginfo'

export type {
  NsiBrand,
  TagSuggestion,
  OsmElementType,
  OsmLiveElement,
  SubmitEditInput,
  SubmitEditResult,
  FieldDefinition,
  GeometryType,
  OsmEdit,
}

/** A preset in the picker, carrying the app's resolved POI icon. */
export interface PresetSummary {
  id: string
  name: string
  iconName: string
  iconPack: 'lucide' | 'maki'
  iconCategory: string
  geometry: GeometryType[]
  tags: Record<string, string>
  addTags?: Record<string, string>
}

/** A preset with its editable field definitions, as served by GET /osm/presets/:id. */
export interface EditablePreset extends PresetSummary {
  fields: FieldDefinition[]
}

/** A chain offered in the place-type search, with the type it belongs to. */
export interface BrandChoice {
  brand: NsiBrand
  preset: PresetSummary
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
