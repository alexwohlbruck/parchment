import { Layer, LayerGroup } from '../schema/layers.schema'

export interface CreateLayerParams {
  name: string
  type?: string
  engine?: string[]
  showInLayerSelector?: boolean
  visible?: boolean
  icon?: string | null
  order: number
  groupId?: string | null
  configuration: any
  userId: string
}

export interface CreateLayerGroupParams {
  name: string
  showInLayerSelector?: boolean
  visible?: boolean
  icon?: string | null
  order: number
  userId: string
}

export interface ReorderParams {
  items: {
    id: string
    order: number
    groupId?: string | null
  }[]
}
