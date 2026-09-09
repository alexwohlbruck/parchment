import { Layer, LayerGroup, LayerType, MapEngine } from '../schema/layers.schema'

export interface CreateLayerParams {
  name: string
  type?: LayerType
  engine?: MapEngine[]
  showInLayerSelector?: boolean
  visible?: boolean
  fadeBasemap?: boolean
  icon?: string | null
  order: number
  groupId?: string | null
  configuration: any
  isSubLayer?: boolean
  enabled?: boolean
  integrationId?: string | null
  userId: string
}

export interface CreateLayerGroupParams {
  name: string
  showInLayerSelector?: boolean
  visible?: boolean
  fadeBasemap?: boolean
  icon?: string | null
  order: number
  parentGroupId?: string | null
  integrationId?: string | null
  userId: string
}

export interface ReorderParams {
  items: {
    id: string
    order: number
    groupId?: string | null
  }[]
}

/**
 * Fields shared by every default template. Templates are read-only: a user
 * can add one to their library, remove it, reorder it and toggle it, but the
 * definition itself only ever changes here.
 */
interface DefaultTemplateBase {
  /** One-liner shown in the layer store. Only needed on store-item roots. */
  description?: string
  /**
   * Whether a fresh library includes this template. Defaults to true; set it
   * false for bundles that live in the store until the user adds them.
   * Only meaningful on a store-item root (a top-level group or an ungrouped
   * layer) — members follow whatever their group does.
   */
  installedByDefault?: boolean
}

// Default layer template (for the server-side registry).
// `type` MUST be one of the `LayerType` enum values — several client features
// (street view control, transit basemap fade, etc.) branch on it.
export interface DefaultLayerTemplate extends DefaultTemplateBase {
  templateId: string
  name: string
  type: LayerType
  engine?: MapEngine[]
  showInLayerSelector: boolean
  visible: boolean
  fadeBasemap?: boolean
  icon?: string | null
  order: number
  groupId: string | null
  configuration: any
  isSubLayer: boolean
  integrationId?: string | null
}

export interface DefaultLayerGroupTemplate extends DefaultTemplateBase {
  templateId: string
  name: string
  showInLayerSelector: boolean
  visible: boolean
  fadeBasemap?: boolean
  icon?: string | null
  order: number
  parentGroupId?: string | null
  integrationId?: string | null
}
