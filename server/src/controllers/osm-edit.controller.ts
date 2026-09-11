import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import type { Language } from '../lib/i18n'
import {
  searchPresets,
  getPresetById,
  getPresetName,
  getPresetIcon,
  getPresetFields,
  matchTags,
  type GeometryType,
} from '../lib/osm-presets'
import {
  getLiveElement,
  submitEdit,
  getPendingEdits,
  OsmEditError,
  type OsmElementType,
} from '../services/osm-edit.service'
import { integrationManager } from '../services/integrations'
import { IntegrationId } from '../types/integration.enums'
import type { OverpassIntegration } from '../services/integrations/overpass-integration'
import { getOsmConfig } from '../config/osm.config'
import { logError } from '../lib/logger'
import { haversineMeters } from '../util/geometry-conversion'

const OSM_PRIMARY_KEYS = new Set([
  'amenity', 'shop', 'tourism', 'leisure', 'craft', 'office', 'emergency',
  'healthcare', 'man_made', 'natural', 'barrier', 'highway', 'railway',
  'public_transport', 'aeroway', 'historic', 'landuse', 'military', 'power',
  'club', 'advertising',
])

const OSM_ELEMENT_TYPE = t.Union([
  t.Literal('node'),
  t.Literal('way'),
  t.Literal('relation'),
])

function editErrorStatus(error: OsmEditError): number {
  switch (error.code) {
    case 'not_connected': return 403
    case 'conflict': return 409
    case 'gone': return 410
    case 'invalid': return 400
    default: return 502
  }
}

function presetPayload(presetId: string, language: Language) {
  const preset = getPresetById(presetId)
  if (!preset) return null
  return {
    id: preset.id,
    name: getPresetName(preset, language),
    icon: getPresetIcon(preset),
    geometry: preset.geometry,
    tags: preset.tags,
    addTags: preset.addTags,
    fields: getPresetFields(preset, language),
  }
}

/**
 * Public read routes live on their own instance: `.use(requireAuth)` guards
 * every route on an instance no matter where it is declared (see
 * osm-oauth.controller.ts), so the authed routes get a separate one and the
 * two are merged at the bottom.
 */
const publicApi = new Elysia({ prefix: '/osm' }).use(i18nPlugin)

/**
 * GET /osm/presets/search — Search tagging presets by name for the picker.
 */
publicApi.get(
  '/presets/search',
  ({ query, language }) => {
    const geometry = query.geometry as GeometryType | undefined
    return {
      results: searchPresets(query.q, language, geometry),
    }
  },
  {
    query: t.Object({
      q: t.String(),
      geometry: t.Optional(
        t.Union([t.Literal('point'), t.Literal('area'), t.Literal('line'), t.Literal('vertex')]),
      ),
    }),
    detail: {
      tags: ['OSM'],
      summary: 'Search OSM tagging presets',
      description:
        'Search the iD tagging schema presets by localized name, terms and aliases.',
    },
  },
)

/**
 * GET /osm/presets/:id — A preset with its editable field definitions.
 * Wildcard route: preset ids contain slashes (e.g. "amenity/cafe").
 */
publicApi.get(
  '/presets/*',
  ({ params, status, language }) => {
    const payload = presetPayload(params['*'], language)
    if (!payload) return status(404, { message: 'Preset not found' })
    return payload
  },
  {
    detail: {
      tags: ['OSM'],
      summary: 'Get a tagging preset with field definitions',
    },
  },
)

/**
 * GET /osm/element/:type/:id — Live element from the OSM API, with the
 * matched preset and field definitions for prefilling the edit form.
 */
publicApi.get(
  '/element/:type/:id',
  async ({ params, status, language }) => {
    try {
      const element = await getLiveElement(
        params.type as OsmElementType,
        params.id,
      )
      const geometryHint = element.type === 'node' ? 'point' : 'area'
      const match = matchTags(element.tags, geometryHint)
      const preset = match ? presetPayload(match.preset.id, language) : null
      return { element, preset }
    } catch (error: any) {
      if (error instanceof OsmEditError) {
        return status(editErrorStatus(error), { message: error.message })
      }
      logError('Failed to fetch OSM element', error)
      return status(502, { message: 'Failed to fetch element from OpenStreetMap' })
    }
  },
  {
    params: t.Object({
      type: OSM_ELEMENT_TYPE,
      id: t.Numeric(),
    }),
    detail: {
      tags: ['OSM'],
      summary: 'Fetch a live OSM element for editing',
    },
  },
)

/**
 * GET /osm/duplicates — Nearby elements matching a preset's primary tags,
 * so a new POI isn't added on top of an existing one.
 */
publicApi.get(
  '/duplicates',
  async ({ query, status }) => {
    const preset = getPresetById(query.presetId)
    if (!preset) return status(404, { message: 'Preset not found' })

    // Match on the primary feature tag only: a sub-preset like
    // amenity/cafe/coffee_shop should surface every nearby cafe, not just
    // ones sharing its cuisine.
    const primary = Object.entries(preset.tags).find(([k]) =>
      OSM_PRIMARY_KEYS.has(k),
    )
    const fallback = Object.entries(preset.tags)[0]
    const [key, value] = primary ?? fallback ?? []
    if (!key) return { results: [] }

    const selector = value === '*' ? `["${key}"]` : `["${key}"="${value}"]`
    const radius = query.radius ?? 100
    const overpassQuery = `[out:json][timeout:10];(node${selector}(around:${radius},${query.lat},${query.lng});way${selector}(around:${radius},${query.lat},${query.lng}););out tags center 10;`

    const configured = integrationManager
      .getConfiguredIntegrations()
      .find((i) => i.integrationId === IntegrationId.OVERPASS)
    const instance = configured
      ? integrationManager.getCachedIntegrationInstance(configured)
      : null
    if (!instance) return { results: [] }

    try {
      const places = await (instance as OverpassIntegration).executeRawQuery(
        overpassQuery,
        10,
      )
      return {
        results: places.flatMap((place) => {
          const center = place.geometry?.value?.center
          if (!center) return []
          return [{
            osm: place.externalIds.osm,
            name: place.name?.value ?? null,
            placeType: place.placeType?.value ?? null,
            lat: center.lat,
            lng: center.lng,
            distanceM: Math.round(
              haversineMeters(query.lat, query.lng, center.lat, center.lng),
            ),
          }]
        }),
      }
    } catch (error) {
      // A duplicate check should never block adding a POI.
      logError('OSM duplicate check failed', error)
      return { results: [] }
    }
  },
  {
    query: t.Object({
      lat: t.Numeric(),
      lng: t.Numeric(),
      presetId: t.String(),
      radius: t.Optional(t.Numeric({ minimum: 10, maximum: 500 })),
    }),
    detail: {
      tags: ['OSM'],
      summary: 'Find nearby elements matching a preset',
      description:
        'Checks Overpass for existing elements with the same primary tags near a point, to avoid duplicate POIs.',
    },
  },
)

/**
 * GET /osm/config — Which OSM server edits will be written to.
 */
publicApi.get(
  '/config',
  ({ status }) => {
    try {
      const config = getOsmConfig()
      return { server: config.server, serverUrl: config.serverUrl }
    } catch {
      return status(503, { message: 'OpenStreetMap integration is not configured' })
    }
  },
  {
    detail: {
      tags: ['OSM'],
      summary: 'Get the configured OSM server',
    },
  },
)

const authedApi = new Elysia({ prefix: '/osm' }).use(i18nPlugin).use(requireAuth)

/**
 * POST /osm/edits — Submit a quick edit as a complete changeset.
 */
authedApi.post(
  '/edits',
  async ({ user, body, status }) => {
    try {
      return await submitEdit(user.id, body)
    } catch (error: any) {
      if (error instanceof OsmEditError) {
        return status(editErrorStatus(error), {
          message: error.message,
          code: error.code,
          live: error.live,
        })
      }
      logError('OSM edit submission failed', error)
      return status(502, { message: 'Failed to submit edit to OpenStreetMap' })
    }
  },
  {
    body: t.Object({
      comment: t.String({ minLength: 1, maxLength: 255 }),
      action: t.Union([t.Literal('create'), t.Literal('modify')]),
      element: t.Object({
        type: OSM_ELEMENT_TYPE,
        id: t.Optional(t.Number()),
        version: t.Optional(t.Number()),
        lat: t.Optional(t.Number({ minimum: -90, maximum: 90 })),
        lon: t.Optional(t.Number({ minimum: -180, maximum: 180 })),
        tags: t.Record(t.String(), t.String()),
      }),
    }),
    detail: {
      tags: ['OSM'],
      summary: 'Submit a quick edit to OpenStreetMap',
      description:
        "Creates a changeset, uploads the change, and closes the changeset using the user's connected OSM account.",
    },
  },
)

/**
 * GET /osm/edits — The user's pending quick edits, optionally for one element.
 */
authedApi.get(
  '/edits',
  async ({ user, query }) => {
    const element =
      query.osmType && query.osmId
        ? { type: query.osmType, id: query.osmId }
        : undefined
    return { edits: await getPendingEdits(user.id, element) }
  },
  {
    query: t.Object({
      osmType: t.Optional(t.String()),
      osmId: t.Optional(t.String()),
    }),
    detail: {
      tags: ['OSM'],
      summary: "List the user's pending quick edits",
    },
  },
)

export default new Elysia().use(publicApi).use(authedApi)
