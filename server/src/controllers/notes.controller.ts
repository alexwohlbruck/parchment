import { Elysia, t } from 'elysia'
import axios from 'axios'
import { requireAuth } from '../middleware/auth.middleware'
import { getConfiguredIntegrations } from '../services/integration.service'
import {
  IntegrationId,
  OsmNote,
  OsmNoteComment,
} from '../types/integration.types'

const OSM_API_BASE = 'https://api.openstreetmap.org/api/0.6'

/**
 * Look up the user's OSM access token from their configured integrations.
 */
async function getOsmAccessToken(userId: string): Promise<string | null> {
  const integrations = await getConfiguredIntegrations(userId)
  const osm = integrations.find(i => i.integrationId === IntegrationId.OPENSTREETMAP)
  return (osm?.config as any)?.accessToken ?? null
}

/**
 * Adapt the raw OSM note properties into our OsmNote shape.
 */
function adaptNote(props: any): OsmNote {
  return {
    id: props.id,
    lat: props.lat ?? props.geometry?.coordinates?.[1],
    lng: props.lon ?? props.geometry?.coordinates?.[0],
    status: props.status,
    comments: (props.comments || []).map(
      (c: any): OsmNoteComment => ({
        date: c.date,
        uid: c.uid,
        user: c.user,
        action: c.action,
        text: c.text,
      }),
    ),
    createdAt: props.date_created,
    closedAt: props.closed_at,
  }
}

const app = new Elysia({ prefix: '/notes' })

/**
 * GET /notes — Fetch notes in a bounding box (public, no auth required).
 */
app.get(
  '/',
  async ({ query, status }) => {
    try {
      const { bbox, limit = 100, closed = 7 } = query
      const response = await axios.get(`${OSM_API_BASE}/notes.json`, {
        params: { bbox, limit, closed },
        headers: { Accept: 'application/json' },
      })
      // OSM returns GeoJSON FeatureCollection, adapt each feature to OsmNote
      const features = response.data?.features || []
      return features.map((feature: any) => adaptNote({
        ...feature.properties,
        lat: feature.geometry?.coordinates?.[1],
        lon: feature.geometry?.coordinates?.[0],
      }))
    } catch (error: any) {
      const errorStatus = error.response?.status ?? 500
      return status(errorStatus, {
        message: error.response?.data || error.message || 'Failed to fetch notes',
      })
    }
  },
  {
    query: t.Object({
      bbox: t.String(),
      limit: t.Optional(t.Number({ default: 100 })),
      closed: t.Optional(t.Number({ default: 7 })),
    }),
    detail: {
      tags: ['Notes'],
      summary: 'Fetch OSM notes in a bounding box',
    },
  },
)

/**
 * GET /notes/:id — Fetch a single note by ID (public, no auth required).
 */
app.get(
  '/:id',
  async ({ params, status }) => {
    try {
      const response = await axios.get(
        `${OSM_API_BASE}/notes/${params.id}.json`,
        { headers: { Accept: 'application/json' } },
      )
      return adaptNote(response.data.properties)
    } catch (error: any) {
      const errorStatus = error.response?.status ?? 500
      return status(errorStatus, {
        message: error.response?.data || error.message || 'Failed to fetch note',
      })
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    detail: {
      tags: ['Notes'],
      summary: 'Fetch a single OSM note by ID',
    },
  },
)

/**
 * POST /notes/:id/comment — Add a comment to a note (requires auth).
 */
app.use(requireAuth).post(
  '/:id/comment',
  async ({ params, body, user, status }) => {
    const accessToken = await getOsmAccessToken(user.id)
    if (!accessToken) {
      return status(403, { message: 'No OSM integration configured. Connect your OSM account first.' })
    }

    try {
      const response = await axios.post(
        `${OSM_API_BASE}/notes/${params.id}/comment.json`,
        null,
        {
          params: { text: body.text },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      )
      return adaptNote(response.data.properties)
    } catch (error: any) {
      const errorStatus = error.response?.status ?? 500
      return status(errorStatus, {
        message: error.response?.data || error.message || 'Failed to comment on note',
      })
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      text: t.String(),
    }),
    detail: {
      tags: ['Notes'],
      summary: 'Add a comment to an OSM note',
    },
  },
)

/**
 * POST /notes/:id/close — Close/resolve a note (requires auth).
 */
app.use(requireAuth).post(
  '/:id/close',
  async ({ params, body, user, status }) => {
    const accessToken = await getOsmAccessToken(user.id)
    if (!accessToken) {
      return status(403, { message: 'No OSM integration configured. Connect your OSM account first.' })
    }

    try {
      const response = await axios.post(
        `${OSM_API_BASE}/notes/${params.id}/close.json`,
        null,
        {
          params: body.text ? { text: body.text } : undefined,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      )
      return adaptNote(response.data.properties)
    } catch (error: any) {
      const errorStatus = error.response?.status ?? 500
      return status(errorStatus, {
        message: error.response?.data || error.message || 'Failed to close note',
      })
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      text: t.Optional(t.String()),
    }),
    detail: {
      tags: ['Notes'],
      summary: 'Close/resolve an OSM note',
    },
  },
)

/**
 * POST /notes/:id/reopen — Reopen a note (requires auth).
 */
app.use(requireAuth).post(
  '/:id/reopen',
  async ({ params, body, user, status }) => {
    const accessToken = await getOsmAccessToken(user.id)
    if (!accessToken) {
      return status(403, { message: 'No OSM integration configured. Connect your OSM account first.' })
    }

    try {
      const response = await axios.post(
        `${OSM_API_BASE}/notes/${params.id}/reopen.json`,
        null,
        {
          params: body.text ? { text: body.text } : undefined,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      )
      return adaptNote(response.data.properties)
    } catch (error: any) {
      const errorStatus = error.response?.status ?? 500
      return status(errorStatus, {
        message: error.response?.data || error.message || 'Failed to reopen note',
      })
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      text: t.Optional(t.String()),
    }),
    detail: {
      tags: ['Notes'],
      summary: 'Reopen an OSM note',
    },
  },
)

/**
 * POST /notes — Create a new note (requires auth).
 */
app.use(requireAuth).post(
  '/',
  async ({ body, user, status }) => {
    const accessToken = await getOsmAccessToken(user.id)
    if (!accessToken) {
      return status(403, { message: 'No OSM integration configured. Connect your OSM account first.' })
    }

    try {
      const response = await axios.post(
        `${OSM_API_BASE}/notes.json`,
        null,
        {
          params: { lat: body.lat, lon: body.lng, text: body.text },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      )
      return adaptNote(response.data.properties)
    } catch (error: any) {
      const errorStatus = error.response?.status ?? 500
      return status(errorStatus, {
        message: error.response?.data || error.message || 'Failed to create note',
      })
    }
  },
  {
    body: t.Object({
      lat: t.Number(),
      lng: t.Number(),
      text: t.String(),
    }),
    detail: {
      tags: ['Notes'],
      summary: 'Create a new OSM note',
    },
  },
)

export default app
