import { Elysia, t, error } from 'elysia'
import {
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegrationConfig,
  getConfiguredIntegrations,
  getAvailableIntegrationsForUser,
  getAvailableIntegrations,
} from '../services/integration.service'
import {
  IntegrationId,
  IntegrationCapabilityId,
  IntegrationCapability,
} from '../types/integration.types'
import { requireAuth } from '../middleware/auth.middleware'

const app = new Elysia({ prefix: '/integrations' }).use(requireAuth)

// Get all available integrations (metadata only)
app.get('/available', async () => {
  return getAvailableIntegrations()
})

// Get all available integrations for a user (excludes already configured ones)
app.get('/available/user', async ({ user }) => {
  return await getAvailableIntegrationsForUser(user.id)
})

// Get user's configured integrations
app.get('/configured', async ({ user }) => {
  return await getConfiguredIntegrations(user.id)
})

// Get a specific integration
app.get(
  '/:id',
  async ({ params: { id }, user }) => {
    const integration = await getIntegration(id, user.id)

    if (!integration) {
      return error(404, { message: 'Integration not found' })
    }

    return integration
  },
  {
    params: t.Object({
      id: t.String(),
    }),
  },
)

// Create a new integration
app.post(
  '/',
  async ({ body, user }) => {
    const { integrationId, config } = body

    // Verify the integration ID is valid
    const validId = Object.values(IntegrationId).includes(
      integrationId as IntegrationId,
    )
    if (!validId) {
      return error(400, { message: 'Invalid integration ID' })
    }

    try {
      const integration = await createIntegration(
        user.id,
        integrationId as IntegrationId,
        config,
      )
      return integration
    } catch (err: any) {
      return error(400, {
        message: err.message || 'Failed to create integration',
      })
    }
  },
  {
    body: t.Object({
      integrationId: t.String(),
      config: t.Record(t.String(), t.Any()),
    }),
  },
)

// Update an integration
app.put(
  '/:id',
  async ({ params: { id }, body, user }) => {
    // At least one of config or capabilities must be provided
    if (!body.config && !body.capabilities) {
      return error(400, { message: 'No updates provided' })
    }

    try {
      // Convert capabilities array if provided
      const updates = {
        config: body.config,
        capabilities: body.capabilities
          ? (body.capabilities.map((cap) => ({
              id: cap.id as IntegrationCapabilityId,
              active: cap.active,
            })) as IntegrationCapability[])
          : undefined,
      }

      const integration = await updateIntegration(id, user.id, updates)
      return integration
    } catch (err: any) {
      return error(400, {
        message: err.message || 'Failed to update integration',
      })
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      config: t.Optional(t.Record(t.String(), t.Any())),
      capabilities: t.Optional(
        t.Array(
          t.Object({
            id: t.String(),
            active: t.Boolean(),
          }),
        ),
      ),
    }),
  },
)

// Delete an integration
app.delete(
  '/:id',
  async ({ params: { id }, user, set }) => {
    try {
      await deleteIntegration(id, user.id)
      set.status = 204
      return null
    } catch (err: any) {
      return error(400, {
        message: err.message || 'Failed to delete integration',
      })
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
  },
)

// Test an integration configuration
app.post(
  '/test',
  async ({ body }) => {
    const { integrationId, config } = body

    // Verify the integration ID is valid
    const validId = Object.values(IntegrationId).includes(
      integrationId as IntegrationId,
    )
    if (!validId) {
      return error(400, { message: 'Invalid integration ID' })
    }

    try {
      const result = await testIntegrationConfig(
        integrationId as IntegrationId,
        config,
      )
      return result
    } catch (err: any) {
      return error(400, {
        message: err.message || 'Failed to test integration',
      })
    }
  },
  {
    body: t.Object({
      integrationId: t.String(),
      config: t.Record(t.String(), t.Any()),
    }),
  },
)

export default app
