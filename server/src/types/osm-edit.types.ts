/**
 * The shapes quick edit exchanges with the client.
 *
 * These live apart from `osm-edit.service` because the web app imports them:
 * reaching into the service would pull the whole integrations graph into the
 * frontend's typecheck, and with it every type error in code the browser never
 * runs. A leaf module keeps that graph the size of the types themselves.
 */

export type OsmElementType = 'node' | 'way' | 'relation'

export interface OsmLiveElement {
  type: OsmElementType
  id: number
  version: number
  lat?: number
  lon?: number
  tags: Record<string, string>
  /** Node refs for ways — echoed back verbatim on modify. */
  nodeRefs?: number[]
  /** Members for relations — echoed back verbatim on modify. */
  members?: Array<{ type: OsmElementType; ref: number; role: string }>
}

export interface SubmitEditInput {
  comment: string
  action: 'create' | 'modify'
  element: {
    type: OsmElementType
    id?: number
    /** Version the client prefilled from — a mismatch at submit time is a conflict. */
    version?: number
    lat?: number
    lon?: number
    tags: Record<string, string>
  }
}

export interface SubmitEditResult {
  changesetId: number
  osmType: OsmElementType
  osmId: number
  version: number
}
