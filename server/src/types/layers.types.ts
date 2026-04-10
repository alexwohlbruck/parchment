import { Layer, LayerGroup } from '../schema/layers.schema'

export interface CreateLayerParams {
  name: string
  type?: string
  engine?: string[]
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
  clonedFromTemplateId?: string | null
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
  clonedFromTemplateId?: string | null
  userId: string
}

export interface ReorderParams {
  items: {
    id: string
    order: number
    groupId?: string | null
  }[]
}

// Default layer template (for the server-side registry)
export interface DefaultLayerTemplate {
  templateId: string
  name: string
  type?: string
  engine?: string[]
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

export interface DefaultLayerGroupTemplate {
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
