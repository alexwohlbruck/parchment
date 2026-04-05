import { Elysia, t } from 'elysia'
import * as arctic from 'arctic'
import axios from 'axios'
import { getSession, requireAuth } from '../middleware/auth.middleware'
import { serverOrigin, clientOrigin } from '../config/origins.config'
import {
  createIntegration,
  deleteIntegration,
  updateIntegration,
  getConfiguredIntegrations,
} from '../services/integration.service'
import { createServerToken, validateServerToken } from '../services/token.service'
import { IntegrationId, IntegrationScope } from '../types/integration.types'
import { integrationManager } from '../services/integrations'

import { osmConfig } from '../config/osm.config'

const OSM_AUTH_ENDPOINT = osmConfig.authEndpoint
const OSM_TOKEN_ENDPOINT = osmConfig.tokenEndpoint
const OSM_API_BASE = osmConfig.apiBase
const OSM_SCOPES = ['read_prefs', 'write_notes', 'write_api'] // read_prefs needed to fetch display name during OAuth callback

function getOsmClient() {
  const systemIntegrations = integrationManager.getConfiguredIntegrations()
  const osmSystem = systemIntegrations.find(
    (i) => i.integrationId === IntegrationId.OPENSTREETMAP,
  )

  if (!osmSystem) {
    throw new Error(
      'OSM system integration not configured. An admin must configure OpenStreetMap OAuth application credentials.',
    )
  }

  const { clientId, clientSecret } = osmSystem.config as any
  if (!clientId || !clientSecret) {
    throw new Error(
      'OSM OAuth2 credentials incomplete in system integration config.',
    )
  }

  return new arctic.OAuth2Client(
    clientId,
    clientSecret,
    `${serverOrigin}/integrations/osm/callback`,
  )
}

const app = new Elysia({ prefix: '/integrations/osm' })

/**
 * Initiate OSM OAuth2 authorization flow.
 * Returns the authorization URL to redirect the user to.
 */
app.use(requireAuth).get(
  '/authorize',
  async ({ user, status }) => {
    try {
      const client = getOsmClient()
      const state = arctic.generateState()

      // Store state → userId mapping using existing token service
      await createServerToken('token', user.id, state, false)

      const url = client.createAuthorizationURL(
        OSM_AUTH_ENDPOINT,
        state,
        OSM_SCOPES,
      )

      return { url: url.toString() }
    } catch (error: any) {
      return status(500, {
        message: error.message || 'Failed to initiate OAuth2 flow',
      })
    }
  },
  {
    detail: {
      tags: ['Integrations', 'OAuth'],
      summary: 'Get OSM OAuth2 authorization URL',
    },
  },
)

/**
 * OAuth2 callback from OpenStreetMap.
 * This is a browser redirect — no API auth, authenticates via state token.
 */
app.get(
  '/callback',
  async ({ query, set }) => {
    const { code, state } = query
    const redirectBase = `${clientOrigin}/settings/integrations`

    if (!code || !state) {
      set.redirect = `${redirectBase}?osm=error&message=${encodeURIComponent('Missing authorization code or state')}`
      return
    }

    try {
      // Look up the state token to find the associated user
      // The token service stores tokens per-user, so we need to find which user owns this state
      const { db } = await import('../db')
      const { tokens } = await import('../schema/tokens.schema')
      const { eq, and } = await import('drizzle-orm')

      const matchingTokens = await db
        .select()
        .from(tokens)
        .where(and(eq(tokens.type, 'token'), eq(tokens.value, state)))

      if (matchingTokens.length === 0) {
        set.redirect = `${redirectBase}?osm=error&message=${encodeURIComponent('Invalid or expired state parameter')}`
        return
      }

      const stateToken = matchingTokens[0]
      const userId = stateToken.userId

      // Check expiry
      if (stateToken.expires && new Date(stateToken.expires) < new Date()) {
        await db.delete(tokens).where(eq(tokens.id, stateToken.id))
        set.redirect = `${redirectBase}?osm=error&message=${encodeURIComponent('Authorization request expired')}`
        return
      }

      // Clean up the state token
      await db.delete(tokens).where(eq(tokens.id, stateToken.id))

      // Exchange authorization code for tokens
      const client = getOsmClient()
      const oauthTokens = await client.validateAuthorizationCode(
        OSM_TOKEN_ENDPOINT,
        code,
        null,
      )

      const accessToken = oauthTokens.accessToken()

      // Fetch OSM user details
      const userResponse = await axios.get(`${OSM_API_BASE}/user/details.json`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      const osmUser = userResponse.data?.user
      if (!osmUser) {
        set.redirect = `${redirectBase}?osm=error&message=${encodeURIComponent('Failed to fetch OSM user details')}`
        return
      }

      // Check if user already has an OSM integration and remove it
      const existingIntegrations = await getConfiguredIntegrations(userId)
      const existingOsm = existingIntegrations.find(
        (i) => i.integrationId === IntegrationId.OPENSTREETMAP_ACCOUNT,
      )
      if (existingOsm) {
        await deleteIntegration(existingOsm.id, userId)
      }

      // Create the integration record
      const config = {
        accessToken,
        osmUserId: osmUser.id,
        osmDisplayName: osmUser.display_name,
        osmProfileImageUrl: osmUser.img?.href,
        osmAccountCreated: osmUser.account_created,
        osmChangesetCount: osmUser.changesets?.count ?? 0,
        osmTraceCount: osmUser.traces?.count ?? 0,
      }

      await createIntegration(userId, IntegrationId.OPENSTREETMAP_ACCOUNT, config)

      set.redirect = `${redirectBase}?osm=connected`
    } catch (error: any) {
      console.error('OSM OAuth2 callback error:', error)
      const message =
        error instanceof arctic.OAuth2RequestError
          ? `OAuth2 error: ${error.code}`
          : error.message || 'OAuth2 callback failed'
      set.redirect = `${redirectBase}?osm=error&message=${encodeURIComponent(message)}`
    }
  },
  {
    query: t.Object({
      code: t.Optional(t.String()),
      state: t.Optional(t.String()),
    }),
    detail: {
      tags: ['Integrations', 'OAuth'],
      summary: 'OSM OAuth2 callback',
    },
  },
)

/**
 * Fetch fresh OSM profile data and update the stored config.
 */
app.use(requireAuth).get(
  '/profile',
  async ({ user, status }) => {
    try {
      const userIntegrations = await getConfiguredIntegrations(user.id)
      const osmIntegration = userIntegrations.find(
        (i) => i.integrationId === IntegrationId.OPENSTREETMAP_ACCOUNT,
      )

      if (!osmIntegration) {
        return status(404, { message: 'No OSM integration found' })
      }

      const accessToken = (osmIntegration.config as any)?.accessToken
      if (!accessToken) {
        return status(400, { message: 'No access token found' })
      }

      const userResponse = await axios.get(`${OSM_API_BASE}/user/details.json`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      const osmUser = userResponse.data?.user
      if (!osmUser) {
        return status(502, { message: 'Failed to fetch OSM user details' })
      }

      // Update stored config with fresh profile data
      const updatedConfig = {
        ...(osmIntegration.config as any),
        osmDisplayName: osmUser.display_name,
        osmProfileImageUrl: osmUser.img?.href,
        osmAccountCreated: osmUser.account_created,
        osmChangesetCount: osmUser.changesets?.count ?? 0,
        osmTraceCount: osmUser.traces?.count ?? 0,
      }

      await updateIntegration(osmIntegration.id, user.id, {
        config: updatedConfig,
      })

      return {
        osmUserId: osmUser.id,
        osmDisplayName: osmUser.display_name,
        osmProfileImageUrl: osmUser.img?.href,
        osmAccountCreated: osmUser.account_created,
        osmChangesetCount: osmUser.changesets?.count ?? 0,
        osmTraceCount: osmUser.traces?.count ?? 0,
      }
    } catch (error: any) {
      const errorStatus = error.response?.status
      if (errorStatus === 401) {
        return status(401, { message: 'OSM access token is invalid or expired' })
      }
      return status(500, {
        message: error.message || 'Failed to fetch OSM profile',
      })
    }
  },
  {
    detail: {
      tags: ['Integrations', 'OAuth'],
      summary: 'Get fresh OSM profile data',
    },
  },
)

/**
 * Disconnect the user's OSM account.
 */
app.use(requireAuth).post(
  '/disconnect',
  async ({ user, status }) => {
    try {
      const userIntegrations = await getConfiguredIntegrations(user.id)
      const osmIntegration = userIntegrations.find(
        (i) => i.integrationId === IntegrationId.OPENSTREETMAP_ACCOUNT,
      )

      if (!osmIntegration) {
        return status(404, { message: 'No OSM integration found' })
      }

      await deleteIntegration(osmIntegration.id, user.id)

      return { success: true }
    } catch (error: any) {
      return status(500, {
        message: error.message || 'Failed to disconnect OSM account',
      })
    }
  },
  {
    detail: {
      tags: ['Integrations', 'OAuth'],
      summary: 'Disconnect OSM account',
    },
  },
)

export default app
