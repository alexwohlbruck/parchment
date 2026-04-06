import { Elysia, t } from 'elysia'
import * as arctic from 'arctic'
import axios from 'axios'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth.middleware'
import { serverOrigin, clientOrigin } from '../config/origins.config'
import { db } from '../db'
import { tokens } from '../schema/tokens.schema'
import {
  createIntegration,
  deleteIntegration,
  updateIntegration,
  getConfiguredIntegrations,
} from '../services/integration.service'
import { IntegrationId } from '../types/integration.types'
import { getOsmConfig } from '../config/osm.config'
import { generateId } from '../util'

const OSM_SCOPES = ['read_prefs', 'write_notes', 'write_api'] // read_prefs needed to fetch display name during OAuth callback

function getOsmClient() {
  const config = getOsmConfig()
  const redirectUri = config.redirectUri || `${serverOrigin}/integrations/osm/callback`

  return new arctic.OAuth2Client(
    config.clientId,
    config.clientSecret || null,
    redirectUri,
  )
}

/**
 * Render a minimal HTML page that posts a message to the opener window and closes itself.
 * Used as the OAuth callback response so the SPA isn't disrupted by a redirect.
 */
function oauthCallbackPage(result: { status: 'connected' | 'error'; message?: string }) {
  // Sanitize message for safe inline script embedding:
  // - Escape </ to prevent </script> breakout
  // - Use only the status enum for the fallback URL message to avoid injection
  const safeMessage = JSON.stringify({ type: 'osm-oauth-callback', ...result })
    .replace(/</g, '\\u003c')
  const safeOrigin = clientOrigin.replace(/'/g, "\\'")
  const fallbackUrl = `${clientOrigin}/settings/integrations?osm=${encodeURIComponent(result.status)}${result.message ? `&message=${encodeURIComponent(result.message)}` : ''}`
  const safeFallbackUrl = fallbackUrl.replace(/'/g, "\\'")
  return new Response(
    `<!DOCTYPE html>
<html><head><title>Connecting...</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage(${safeMessage}, '${safeOrigin}');
    window.close();
  } else {
    window.location.href = '${safeFallbackUrl}';
  }
</script>
<noscript>You can close this window.</noscript>
</body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
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

      // Store state → userId mapping with a 1-hour expiry (longer than the default
      // 15 minutes to accommodate the dev-mode manual callback workaround)
      // Clean up any existing OAuth state tokens for this user
      await db
        .delete(tokens)
        .where(and(eq(tokens.userId, user.id), eq(tokens.type, 'token')))

      await db.insert(tokens).values({
        id: generateId(),
        userId: user.id,
        type: 'token',
        value: state,
        ephemeral: true,
        expires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      })

      const osmCfg = getOsmConfig()
      const url = client.createAuthorizationURL(
        osmCfg.authEndpoint,
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
 * Opens in a popup/new tab — posts result back to opener via postMessage.
 * Falls back to redirect if there's no opener (e.g. popup was blocked).
 */
app.get(
  '/callback',
  async ({ query }) => {
    const { code, state } = query

    if (!code || !state) {
      return oauthCallbackPage({ status: 'error', message: 'Missing authorization code or state' })
    }

    try {
      // Look up the state token to find the associated user
      const matchingTokens = await db
        .select()
        .from(tokens)
        .where(and(eq(tokens.type, 'token'), eq(tokens.value, state)))

      if (matchingTokens.length === 0) {
        return oauthCallbackPage({ status: 'error', message: 'Invalid or expired state parameter' })
      }

      const stateToken = matchingTokens[0]
      const userId = stateToken.userId

      // Check expiry
      if (stateToken.expires && new Date(stateToken.expires) < new Date()) {
        await db.delete(tokens).where(eq(tokens.id, stateToken.id))
        return oauthCallbackPage({ status: 'error', message: 'Authorization request expired' })
      }

      // Clean up the state token
      await db.delete(tokens).where(eq(tokens.id, stateToken.id))

      // Exchange authorization code for tokens
      const client = getOsmClient()
      const osmCfg = getOsmConfig()
      const oauthTokens = await client.validateAuthorizationCode(
        osmCfg.tokenEndpoint,
        code,
        null,
      )

      const accessToken = oauthTokens.accessToken()

      // Fetch OSM user details
      const userResponse = await axios.get(`${osmCfg.apiBase}/user/details.json`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      const osmUser = userResponse.data?.user
      if (!osmUser) {
        return oauthCallbackPage({ status: 'error', message: 'Failed to fetch OSM user details' })
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

      return oauthCallbackPage({ status: 'connected' })
    } catch (error: any) {
      console.error('OSM OAuth2 callback error:', error)
      const message =
        error instanceof arctic.OAuth2RequestError
          ? `OAuth2 error: ${error.code}`
          : error.message || 'OAuth2 callback failed'
      return oauthCallbackPage({ status: 'error', message })
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

      const osmCfg = getOsmConfig()
      const userResponse = await axios.get(`${osmCfg.apiBase}/user/details.json`, {
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
