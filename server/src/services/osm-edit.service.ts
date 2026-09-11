import axios from 'axios'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { db } from '../db'
import { osmEdits, type OsmEdit } from '../schema/osm-edits.schema'
import { getOsmConfig } from '../config/osm.config'
import { getConfiguredIntegrations } from './integration.service'
import { IntegrationId } from '../types/integration.types'
import { clientOrigin } from '../config/origins.config'
import { generateId } from '../util'
import { logError } from '../lib/logger'
import { version as appVersion } from '../../package.json'
import { APP_USER_AGENT } from '../lib/constants'

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

export class OsmEditError extends Error {
  constructor(
    public code: 'not_connected' | 'conflict' | 'gone' | 'invalid' | 'upstream',
    message: string,
    public live?: OsmLiveElement,
  ) {
    super(message)
  }
}

async function getOsmAccessToken(userId: string): Promise<string> {
  const integrations = await getConfiguredIntegrations(userId)
  const osm = integrations.find(
    (i) => i.integrationId === IntegrationId.OPENSTREETMAP_ACCOUNT,
  )
  const token = (osm?.config as any)?.accessToken
  if (!token) {
    throw new OsmEditError(
      'not_connected',
      'OpenStreetMap account is not connected',
    )
  }
  return token
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function tagsXml(tags: Record<string, string>): string {
  return Object.entries(tags)
    .filter(([k, v]) => k.trim() && v.trim())
    .map(([k, v]) => `<tag k="${escapeXml(k.trim())}" v="${escapeXml(v.trim())}"/>`)
    .join('')
}

/** Fetch the current version of an element straight from the OSM API. */
export async function getLiveElement(
  type: OsmElementType,
  id: number,
): Promise<OsmLiveElement> {
  try {
    const response = await axios.get(
      `${getOsmConfig().apiBase}/${type}/${id}.json`,
      { headers: { 'User-Agent': APP_USER_AGENT } },
    )
    const el = response.data?.elements?.[0]
    if (!el) throw new OsmEditError('upstream', 'Element not found in OSM response')
    return {
      type,
      id: el.id,
      version: el.version,
      lat: el.lat,
      lon: el.lon,
      tags: el.tags || {},
      nodeRefs: el.nodes,
      members: el.members?.map((m: any) => ({
        type: m.type,
        ref: m.ref,
        role: m.role ?? '',
      })),
    }
  } catch (error: any) {
    if (error instanceof OsmEditError) throw error
    const status = error.response?.status
    if (status === 404 || status === 410) {
      throw new OsmEditError('gone', `The ${type} no longer exists on OpenStreetMap`)
    }
    throw new OsmEditError('upstream', 'Failed to fetch element from OpenStreetMap')
  }
}

function buildElementXml(
  input: SubmitEditInput['element'],
  live: OsmLiveElement | null,
  changesetId: number,
): string {
  const tags = tagsXml(input.tags)

  if (input.type === 'node') {
    const id = live?.id ?? -1
    const version = live ? ` version="${live.version}"` : ''
    const lat = input.lat ?? live?.lat
    const lon = input.lon ?? live?.lon
    return `<node id="${id}"${version} changeset="${changesetId}" lat="${lat}" lon="${lon}">${tags}</node>`
  }

  if (!live) throw new OsmEditError('invalid', 'Only nodes can be created')

  if (input.type === 'way') {
    const refs = (live.nodeRefs || []).map((r) => `<nd ref="${r}"/>`).join('')
    return `<way id="${live.id}" version="${live.version}" changeset="${changesetId}">${refs}${tags}</way>`
  }

  const members = (live.members || [])
    .map((m) => `<member type="${m.type}" ref="${m.ref}" role="${escapeXml(m.role)}"/>`)
    .join('')
  return `<relation id="${live.id}" version="${live.version}" changeset="${changesetId}">${members}${tags}</relation>`
}

/**
 * Submit a quick edit as a complete changeset (create → upload → close).
 *
 * Modifies re-fetch the live element first: the current version is required
 * by the API, ways/relations must echo their geometry members verbatim, and
 * a version newer than the one the client prefilled from is a conflict.
 */
export async function submitEdit(
  userId: string,
  input: SubmitEditInput,
): Promise<SubmitEditResult> {
  const token = await getOsmAccessToken(userId)
  const config = getOsmConfig()
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': APP_USER_AGENT }
  // Accept must pin XML: with axios's default Accept the API answers the
  // upload with a JSON diffResult, which the regex parse below can't read.
  const xmlHeaders = { ...headers, 'Content-Type': 'text/xml', Accept: 'application/xml' }

  let live: OsmLiveElement | null = null
  if (input.action === 'modify') {
    if (!input.element.id) {
      throw new OsmEditError('invalid', 'Element id is required to modify')
    }
    live = await getLiveElement(input.element.type, input.element.id)
    if (
      input.element.version !== undefined &&
      live.version !== input.element.version
    ) {
      throw new OsmEditError(
        'conflict',
        'This element was changed on OpenStreetMap while you were editing',
        live,
      )
    }
  } else if (input.element.type !== 'node') {
    throw new OsmEditError('invalid', 'Only nodes can be created')
  } else if (input.element.lat === undefined || input.element.lon === undefined) {
    throw new OsmEditError('invalid', 'A location is required to create a node')
  }

  const changesetTags = tagsXml({
    created_by: `Parchment ${appVersion}`,
    comment: input.comment,
    host: clientOrigin ?? '',
  })

  const changesetResponse = await axios.put(
    `${config.apiBase}/changeset/create`,
    `<osm><changeset>${changesetTags}</changeset></osm>`,
    { headers: xmlHeaders },
  )
  const changesetId = parseInt(changesetResponse.data, 10)

  try {
    const elementXml = buildElementXml(input.element, live, changesetId)
    const action = input.action === 'create' ? 'create' : 'modify'
    const osmChange = `<osmChange version="0.6" generator="Parchment ${appVersion}"><${action}>${elementXml}</${action}></osmChange>`

    const uploadResponse = await axios.post(
      `${config.apiBase}/changeset/${changesetId}/upload`,
      osmChange,
      { headers: xmlHeaders },
    )

    // diffResult carries the assigned id/version, e.g.
    // <node old_id="-1" new_id="123" new_version="1"/>
    const diff = String(uploadResponse.data)
    const newId = diff.match(/new_id="(\d+)"/)?.[1]
    const newVersion = diff.match(/new_version="(\d+)"/)?.[1]

    const osmId = newId ? parseInt(newId, 10) : input.element.id!
    const resultVersion = newVersion
      ? parseInt(newVersion, 10)
      : (live?.version ?? 0) + 1

    await db.insert(osmEdits).values({
      id: generateId(),
      userId,
      action: input.action,
      osmType: input.element.type,
      osmId: String(osmId),
      version: resultVersion,
      changesetId: String(changesetId),
      tags: input.element.tags,
      lat: input.element.lat ?? live?.lat,
      lng: input.element.lon ?? live?.lon,
      comment: input.comment,
    })

    return {
      changesetId,
      osmType: input.element.type,
      osmId,
      version: resultVersion,
    }
  } catch (error: any) {
    if (error instanceof OsmEditError) throw error
    if (error.response?.status === 409) {
      throw new OsmEditError(
        'conflict',
        'This element was changed on OpenStreetMap while you were editing',
        live ?? undefined,
      )
    }
    logError('OSM changeset upload failed', error)
    throw new OsmEditError(
      'upstream',
      typeof error.response?.data === 'string'
        ? error.response.data
        : 'Failed to upload changes to OpenStreetMap',
    )
  } finally {
    // Close regardless of upload outcome — open changesets linger for hours
    // upstream otherwise. Best-effort: an already-closed set is fine.
    axios
      .put(`${config.apiBase}/changeset/${changesetId}/close`, null, { headers })
      .catch(() => {})
  }
}

/** The user's edits that have not yet surfaced in the imported map data. */
export async function getPendingEdits(
  userId: string,
  element?: { type: string; id: string },
): Promise<OsmEdit[]> {
  const conditions = [eq(osmEdits.userId, userId), isNull(osmEdits.resolvedAt)]
  if (element) {
    conditions.push(
      eq(osmEdits.osmType, element.type),
      eq(osmEdits.osmId, element.id),
    )
  }
  return db
    .select()
    .from(osmEdits)
    .where(and(...conditions))
    .orderBy(desc(osmEdits.createdAt))
    .limit(50)
}
