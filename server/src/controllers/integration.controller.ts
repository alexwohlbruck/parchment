import { Elysia, t } from 'elysia'
import {
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegrationConfig,
  getConfiguredIntegrations,
  getAvailableIntegrations,
  getPublicIntegrations,
  getIntegrationDefinition,
} from '../services/integration.service'
import {
  IntegrationId,
  IntegrationCapabilityId,
  IntegrationCapability,
  IntegrationScope,
  IntegrationRecord,
} from '../types/integration.types'
import { requireAuth } from '../middleware/auth.middleware'
import { PermissionId } from '../types/auth.types'
import { hasPermission, getPermissions } from '../services/auth.service'

// Helper function to sanitize integration configs by removing sensitive data
function sanitizeIntegrationConfig(
  integration: IntegrationRecord,
): IntegrationRecord {
  return {
    ...integration,
    config: {} as any, // Remove all config data for users without system read permissions
  }
}

const app = new Elysia({ prefix: '/integrations' })

// All endpoints require auth
app.use(requireAuth)

// New: Public integrations for client (safe subset)
app.get(
  '/public',
  async () => {
    const list = await getPublicIntegrations()
    return list
  },
  {
    detail: {
      tags: ['Integrations'],
      summary: 'Get public integrations (safe subset)',
    },
  },
)

// Get all available integrations (metadata only)
app.use(requireAuth).get(
  '/available',
  async ({ user, status, t }) => {
    // Check if user has basic read permission for integrations
    const userPermissions = await getPermissions(user.id)
    const canRead = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_READ,
    )
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )

    if (!canRead) {
      return status(403, {
        message: t('errors.auth.insufficientPermissions'),
      })
    }

    const allAvailableIntegrations = await getAvailableIntegrations()

    // Get configured integrations to check what's already set up
    const configuredIntegrations = await getConfiguredIntegrations()
    const configuredIntegrationIds = new Set(
      configuredIntegrations.map((integration) => integration.integrationId),
    )

    // Filter integrations based on user permissions and scope
    const filteredIntegrations = allAvailableIntegrations.filter(
      (integration) => {
        // Hide integrations whose system prerequisite isn't configured
        if (
          integration.requiresSystemIntegration &&
          !configuredIntegrationIds.has(integration.requiresSystemIntegration)
        ) {
          return false
        }

        // If integration has SYSTEM scope
        if (integration.scope.includes(IntegrationScope.SYSTEM)) {
          // If it's already configured, show to users with read permissions
          if (configuredIntegrationIds.has(integration.id)) {
            return canRead
          }
          // If not configured, only show to users with write permissions
          return canWriteSystem
        }

        // If integration has USER scope, user just needs read permissions
        if (integration.scope.includes(IntegrationScope.USER)) {
          return canRead
        }

        return false
      },
    )

    return filteredIntegrations
  },
  {
    detail: {
      tags: ['Integrations'],
      summary: 'Get all available integrations (metadata only)',
    },
  },
)

// TODO: Don't require auth, we should be able to get public integrations
// Get user's configured integrations (user-specific ones plus system-wide ones)
// Configs are sanitized unless user has appropriate write permissions
app.use(requireAuth).get(
  '/configured',
  async ({ user, status, t }) => {
    // Check if user has basic read permission for integrations
    const userPermissions = await getPermissions(user.id)
    const canRead = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_READ,
    )
    const canWriteUser = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_USER,
    )
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )

    if (!canRead) {
      return status(403, {
        message: t('errors.auth.insufficientPermissions'),
      })
    }

    // Get user-specific integrations
    const userIntegrations = await getConfiguredIntegrations(user.id)

    // Get system-wide integrations
    const systemIntegrations = await getConfiguredIntegrations()

    // Combine all integrations
    const allIntegrations = [...userIntegrations, ...systemIntegrations]

    // Import integration manager to get capability metadata
    const { integrationManager } = await import('../services/integrations')

    // Sanitize configs based on user permissions and integration scope
    // and add capability metadata
    return allIntegrations.map((integration) => {
      const definition = getIntegrationDefinition(integration.integrationId)
      if (!definition) return sanitizeIntegrationConfig(integration)

      // Check if user can see full config based on integration scope
      const canSeeFullConfig =
        (definition.scope.includes(IntegrationScope.USER) && canWriteUser) ||
        (definition.scope.includes(IntegrationScope.SYSTEM) && canWriteSystem)

      const baseIntegration = canSeeFullConfig
        ? integration
        : sanitizeIntegrationConfig(integration)

      // Get the integration instance to access capability metadata
      const instance =
        integrationManager.getCachedIntegrationInstance(integration)

      // Enhance capabilities with metadata
      const enhancedCapabilities = integration.capabilities.map((cap) => {
        const capabilityMetadata = instance?.capabilities[cap.id]?.metadata
        return {
          ...cap,
          metadata: capabilityMetadata || null,
        }
      })

      return {
        ...baseIntegration,
        name: definition.name, // Add human-friendly name from definition
        capabilities: enhancedCapabilities,
      }
    })
  },
  {
    detail: {
      tags: ['Integrations'],
      summary: 'Get configured integrations for user with capability metadata',
    },
  },
)

// Get a specific integration
app.use(requireAuth).get(
  '/:id',
  async ({ params: { id }, user, status, t }) => {
    const userPermissions = await getPermissions(user.id)
    const canRead = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_READ,
    )
    const canWriteUser = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_USER,
    )
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )

    if (!canRead) {
      return status(403, {
        message: t('errors.auth.insufficientPermissions'),
      })
    }

    // First try user-specific integration
    let integration = await getIntegration(id, user.id)

    // If not found, try system-wide integration
    if (!integration) {
      integration = await getIntegration(id)
    }

    if (!integration) {
      return status(404, { message: t('errors.notFound.integration') })
    }

    // Check if user can see full config based on integration scope
    const definition = getIntegrationDefinition(integration.integrationId)
    if (!definition) return sanitizeIntegrationConfig(integration)

    const canSeeFullConfig =
      (definition.scope.includes(IntegrationScope.USER) && canWriteUser) ||
      (definition.scope.includes(IntegrationScope.SYSTEM) && canWriteSystem)

    return canSeeFullConfig
      ? integration
      : sanitizeIntegrationConfig(integration)
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    detail: {
      tags: ['Integrations'],
      summary: 'Get a specific integration',
    },
  },
)

// Create a new integration
app.use(requireAuth).post(
  '/',
  async ({ body, user, status, t }) => {
    const userPermissions = await getPermissions(user.id)
    const canWriteUser = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_USER,
    )
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )

    const { integrationId, config, capabilities, isSystemWide } = body

    // Verify the integration ID is valid
    const validId = Object.values(IntegrationId).includes(
      integrationId as IntegrationId,
    )
    if (!validId) {
      return status(400, { message: t('errors.integration.invalidId') })
    }

    // Get integration definition to check scope
    const definition = getIntegrationDefinition(integrationId as IntegrationId)
    if (!definition) {
      return status(400, {
        message: t('errors.notFound.integrationDefinition'),
      })
    }

    // Check permissions based on integration scope
    if (definition.scope.includes(IntegrationScope.SYSTEM)) {
      if (!canWriteSystem) {
        return status(403, {
          message: t('errors.auth.insufficientPermissions'),
        })
      }
    } else if (definition.scope.includes(IntegrationScope.USER)) {
      if (!canWriteUser) {
        return status(403, {
          message: t('errors.auth.insufficientPermissions'),
        })
      }
    } else {
      return status(400, { message: t('errors.integration.invalidScope') })
    }

    // Enforce system prerequisite
    if (definition.requiresSystemIntegration) {
      const systemIntegrations = await getConfiguredIntegrations()
      const hasPrerequisite = systemIntegrations.some(
        (i) => i.integrationId === definition.requiresSystemIntegration,
      )
      if (!hasPrerequisite) {
        return status(400, {
          message:
            'System prerequisite integration is not configured. An admin must configure it first.',
        })
      }
    }

    try {
      const processedCapabilities = capabilities
        ? capabilities.map((cap) => ({
            id: cap.id as IntegrationCapabilityId,
            active: cap.active,
          }))
        : undefined

      // Determine userId based on scope and permissions
      let userId: string | undefined
      if (definition.scope.includes(IntegrationScope.SYSTEM)) {
        userId = undefined // System-wide
      } else {
        userId = user.id // User-specific
      }

      const integration = await createIntegration(
        userId,
        integrationId as IntegrationId,
        config,
        processedCapabilities,
      )

      return integration
    } catch (err: any) {
      return status(400, {
        message: err.message || 'Failed to create integration',
      })
    }
  },
  {
    body: t.Object({
      integrationId: t.String(),
      config: t.Record(t.String(), t.Any()),
      capabilities: t.Optional(
        t.Array(
          t.Object({
            id: t.String(),
            active: t.Boolean(),
          }),
        ),
      ),
      isSystemWide: t.Optional(t.Boolean()),
    }),
    detail: {
      tags: ['Integrations'],
      summary: 'Create a new integration',
    },
  },
)

// Update an integration
app.use(requireAuth).put(
  '/:id',
  async ({ params: { id }, body, user, status, t }) => {
    const userPermissions = await getPermissions(user.id)
    const canWriteUser = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_USER,
    )
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )

    // At least one of config or capabilities must be provided
    if (!body.config && !body.capabilities) {
      return status(400, { message: t('errors.integration.noUpdates') })
    }

    try {
      // First, check if this is a system-wide integration
      const systemIntegration = await getIntegration(id)
      const userIntegration = await getIntegration(id, user.id)

      if (!systemIntegration && !userIntegration) {
        return status(404, { message: t('errors.notFound.integration') })
      }

      const integration = systemIntegration || userIntegration
      const definition = getIntegrationDefinition(integration!.integrationId)

      if (!definition) {
        return status(400, {
          message: t('errors.notFound.integrationDefinition'),
        })
      }

      // Check permissions based on integration scope
      if (definition.scope.includes(IntegrationScope.SYSTEM)) {
        if (!canWriteSystem) {
          return status(403, {
            message: t('errors.auth.insufficientPermissions'),
          })
        }
      } else if (definition.scope.includes(IntegrationScope.USER)) {
        if (!canWriteUser) {
          return status(403, {
            message: t('errors.auth.insufficientPermissions'),
          })
        }
      }

      const userId: string | undefined = systemIntegration ? undefined : user.id

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

      const updatedIntegration = await updateIntegration(id, userId, updates)
      return updatedIntegration
    } catch (err: any) {
      return status(400, {
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
    detail: {
      tags: ['Integrations'],
      summary: 'Update an integration',
    },
  },
)

// Delete an integration
app.use(requireAuth).delete(
  '/:id',
  async ({ params: { id }, user, set, status }) => {
    const userPermissions = await getPermissions(user.id)
    const canWriteUser = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_USER,
    )
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )

    try {
      // First, check if this is a system-wide integration
      const systemIntegration = await getIntegration(id)
      const userIntegration = await getIntegration(id, user.id)

      if (!systemIntegration && !userIntegration) {
        return status(404, { message: t('errors.notFound.integration') })
      }

      const integration = systemIntegration || userIntegration
      const definition = getIntegrationDefinition(integration!.integrationId)

      if (!definition) {
        return status(400, {
          message: t('errors.notFound.integrationDefinition'),
        })
      }

      // Check permissions based on integration scope
      if (definition.scope.includes(IntegrationScope.SYSTEM)) {
        if (!canWriteSystem) {
          return status(403, {
            message: t('errors.auth.insufficientPermissions'),
          })
        }
      } else if (definition.scope.includes(IntegrationScope.USER)) {
        if (!canWriteUser) {
          return status(403, {
            message: t('errors.auth.insufficientPermissions'),
          })
        }
      }

      const userId: string | undefined = systemIntegration ? undefined : user.id

      await deleteIntegration(id, userId)

      set.status = 204
      return null
    } catch (err: any) {
      return status(400, {
        message: err.message || 'Failed to delete integration',
      })
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    detail: {
      tags: ['Integrations'],
      summary: 'Delete an integration',
    },
  },
)

// Test an integration configuration
app.use(requireAuth).post(
  '/test',
  async ({ body, user, status }) => {
    const userPermissions = await getPermissions(user.id)
    const canWriteUser = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_USER,
    )
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )

    const { integrationId, config } = body

    // Verify the integration ID is valid
    const validId = Object.values(IntegrationId).includes(
      integrationId as IntegrationId,
    )
    if (!validId) {
      return status(400, { message: t('errors.integration.invalidId') })
    }

    // Get integration definition to check scope
    const definition = getIntegrationDefinition(integrationId as IntegrationId)
    if (!definition) {
      return status(400, {
        message: t('errors.notFound.integrationDefinition'),
      })
    }

    // Check permissions based on integration scope
    if (definition.scope.includes(IntegrationScope.SYSTEM)) {
      if (!canWriteSystem) {
        return status(403, {
          message: t('errors.auth.insufficientPermissions'),
        })
      }
    } else if (definition.scope.includes(IntegrationScope.USER)) {
      if (!canWriteUser) {
        return status(403, {
          message: t('errors.auth.insufficientPermissions'),
        })
      }
    } else {
      return status(400, { message: t('errors.integration.invalidScope') })
    }

    try {
      const result = await testIntegrationConfig(
        integrationId as IntegrationId,
        config,
      )
      return result
    } catch (err: any) {
      return status(400, {
        message: err.message || 'Failed to test integration',
      })
    }
  },
  {
    body: t.Object({
      integrationId: t.String(),
      config: t.Record(t.String(), t.Any()),
    }),
    detail: {
      tags: ['Integrations'],
      summary: 'Test an integration configuration',
    },
  },
)

export default app
