import { Elysia, t } from 'elysia'
import {
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegrationConfig,
  getConfiguredIntegrations,
  getAvailableIntegrations,
  getIntegrationDefinition,
  extractPublicConfig,
  getDependentIntegrations,
  IntegrationSchemeConflictError,
} from '../services/integration.service'
import {
  IntegrationId,
  IntegrationCapabilityId,
  IntegrationCapability,
  IntegrationScope,
  IntegrationScheme,
  ConfiguredIntegrationDto,
  IntegrationRecord,
} from '../types/integration.types'
import { requireAuth, getSession } from '../middleware/auth.middleware'
import { PermissionId } from '../types/auth.types'
import { hasPermission, getPermissions } from '../services/auth.service'
import { logger } from '../lib/logger'

const app = new Elysia({ prefix: '/integrations' })

/**
 * GET /integrations/configured
 *
 * Public endpoint (no auth required).
 * Returns configured integrations the caller has permission to see,
 * with only publicly-marked config fields.
 *
 * - Unauthenticated: system integrations with public config fields only
 * - Authenticated: system integrations (always) + user integrations,
 *   all with public config fields only. Filtered by read permissions.
 */
app.use(getSession).get(
  '/configured',
  async ({ user }) => {
    const { integrationManager } = await import('../services/integrations')

    // Build the public-facing view of one integration row. Shared between the
    // system and user branches — the only difference is that user rows carry
    // userId + (for user-e2ee) the opaque encryptedConfig envelope.
    const toDto = (
      integration: IntegrationRecord,
      includeUserFields: boolean,
    ): ConfiguredIntegrationDto => {
      const definition = getIntegrationDefinition(integration.integrationId)
      const publicConfig = extractPublicConfig(
        (integration.config || {}) as Record<string, any>,
        definition,
      )
      const instance =
        integrationManager.getCachedIntegrationInstance(integration)
      const enhancedCapabilities = integration.capabilities.map((cap) => ({
        ...cap,
        metadata: instance?.capabilities[cap.id]?.metadata ?? null,
      }))

      const dto: ConfiguredIntegrationDto = {
        id: integration.id,
        integrationId: integration.integrationId,
        scheme: integration.scheme,
        config: publicConfig,
        capabilities: enhancedCapabilities,
        name: definition?.name,
      }
      if (includeUserFields) {
        dto.userId = integration.userId
        // user-e2ee rows carry the client-encrypted config as an opaque
        // envelope; the client decrypts it locally on hydrate.
        dto.encryptedConfig = integration.encryptedConfig
      }
      return dto
    }

    // Always include system integrations with public fields.
    const systemIntegrations = await getConfiguredIntegrations()
    const result: ConfiguredIntegrationDto[] = systemIntegrations.map((i) =>
      toDto(i, false),
    )

    if (user) {
      const userPermissions = await getPermissions(user.id)
      const canReadUser = hasPermission(
        userPermissions,
        PermissionId.INTEGRATIONS_READ_USER,
      )
      if (canReadUser) {
        const userIntegrations = await getConfiguredIntegrations(user.id)
        for (const integration of userIntegrations) {
          result.push(toDto(integration, true))
        }
      }
    }

    return result
  },
  {
    detail: {
      tags: ['Integrations'],
      summary:
        'Get configured integrations with public config fields only',
    },
  },
)

// All remaining endpoints require auth
app.use(requireAuth)

/**
 * GET /integrations/available
 *
 * Returns integration definitions the user has permission to see in the
 * settings UI. User integrations require INTEGRATIONS_READ_USER,
 * system integrations require INTEGRATIONS_READ_SYSTEM.
 */
app.get(
  '/available',
  async ({ user, status, t }) => {
    const userPermissions = await getPermissions(user.id)
    const canReadUser = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_READ_USER,
    )
    const canReadSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_READ_SYSTEM,
    )
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )

    if (!canReadUser && !canReadSystem) {
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
            return canReadSystem
          }
          // If not configured, only show to users with write permissions
          return canWriteSystem
        }

        // If integration has USER scope, user needs read user permissions
        if (integration.scope.includes(IntegrationScope.USER)) {
          return canReadUser
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

/**
 * GET /integrations/:id
 *
 * Returns full config for a single integration. Requires the appropriate
 * write permission (write:user for user-scoped, write:system for system-scoped).
 */
app.get(
  '/:id',
  async ({ params: { id }, user, status, t }) => {
    const userPermissions = await getPermissions(user.id)
    const canWriteUser = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_USER,
    )
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )

    // First try user-specific integration
    let integration = await getIntegration(id, user.id)

    // If not found, try system-wide integration
    if (!integration) {
      integration = await getIntegration(id)
    }

    if (!integration) {
      return status(404, { message: t('errors.notFound.integration') })
    }

    // Check if user has write permission for this integration's scope
    const definition = getIntegrationDefinition(integration.integrationId)
    if (!definition) {
      return status(404, { message: t('errors.notFound.integrationDefinition') })
    }

    const hasWriteAccess =
      (definition.scope.includes(IntegrationScope.USER) && canWriteUser) ||
      (definition.scope.includes(IntegrationScope.SYSTEM) && canWriteSystem)

    if (!hasWriteAccess) {
      return status(403, {
        message: t('errors.auth.insufficientPermissions'),
      })
    }

    // Return full config
    return integration
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    detail: {
      tags: ['Integrations'],
      summary: 'Get a specific integration with full config (requires write permission)',
    },
  },
)

/**
 * POST /integrations
 *
 * Create a new integration. Requires write permission for the
 * integration's scope (write:user or write:system).
 */
app.post(
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

    const { integrationId, config, capabilities, scheme } = body
    const effectiveScheme: IntegrationScheme =
      (scheme as IntegrationScheme | undefined) ?? 'server-key'

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

    // Scheme must be one the definition opts into. Defaults to ['server-key']
    // for integrations that haven't declared supportedSchemes.
    const supportedSchemes = definition.supportedSchemes ?? ['server-key']
    if (!supportedSchemes.includes(effectiveScheme)) {
      return status(400, {
        message: t('errors.integration.unsupportedScheme'),
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
        effectiveScheme,
      )

      return integration
    } catch (err: unknown) {
      if (err instanceof IntegrationSchemeConflictError) {
        return status(409, {
          message: t('errors.integration.schemeAlreadyConfigured'),
        })
      }
      // Known Error throws from the service carry human-facing messages
      // (validation, not-found, test-failed) — surface as 400. Non-Error
      // throws are unexpected (DB / runtime bugs): log + generic 500 so
      // we don't echo internal details to the caller.
      if (err instanceof Error) {
        logger.warn({ err, integrationId }, 'createIntegration failed')
        return status(400, { message: err.message })
      }
      logger.error({ err }, 'createIntegration unexpected non-Error throw')
      return status(500, { message: 'Failed to create integration' })
    }
  },
  {
    body: t.Object({
      integrationId: t.String(),
      // Config may be empty for scheme='user-e2ee' — the ciphertext lives in
      // the personal-blob channel and is uploaded separately by the client.
      config: t.Record(t.String(), t.Any()),
      capabilities: t.Optional(
        t.Array(
          t.Object({
            id: t.String(),
            active: t.Boolean(),
          }),
        ),
      ),
      scheme: t.Optional(t.String()),
    }),
    detail: {
      tags: ['Integrations'],
      summary: 'Create a new integration',
    },
  },
)

/**
 * PUT /integrations/:id
 *
 * Update an integration. Requires write permission for the
 * integration's scope.
 */
app.put(
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
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.warn({ err, id }, 'updateIntegration failed')
        return status(400, { message: err.message })
      }
      logger.error({ err }, 'updateIntegration unexpected non-Error throw')
      return status(500, { message: 'Failed to update integration' })
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

/**
 * GET /integrations/:id/dependents
 *
 * Returns a list of configured integrations that depend on this one
 * (via requiresSystemIntegration). Used by the frontend to warn users
 * before deleting a system integration that other integrations rely on.
 */
app.get(
  '/:id/dependents',
  async ({ params: { id }, user, status, t }) => {
    const userPermissions = await getPermissions(user.id)
    const canWriteSystem = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    )
    const canWriteUser = hasPermission(
      userPermissions,
      PermissionId.INTEGRATIONS_WRITE_USER,
    )

    // `getIntegration(id, user.id)` returns either the caller's own user
    // integration or a system integration — it never returns another user's
    // row. That gives us ownership-by-construction for the user-scope path.
    const integration = await getIntegration(id, user.id)
    if (!integration) {
      return status(404, { message: t('errors.notFound.integration') })
    }

    // Permission must match the row's actual scope. Without this, a regular
    // user with WRITE_USER could enumerate system-integration dependents,
    // leaking which users configured the dependent (e.g. OSM accounts).
    const isSystem = integration.userId === null
    if (isSystem) {
      if (!canWriteSystem) {
        return status(403, {
          message: t('errors.auth.insufficientPermissions'),
        })
      }
    } else {
      if (!canWriteUser) {
        return status(403, {
          message: t('errors.auth.insufficientPermissions'),
        })
      }
    }

    const dependents = await getDependentIntegrations(
      integration.integrationId as any,
    )

    // Deliberately omit `userId` — the client only renders the integration
    // name in a warning dialog; returning userIds would expose which users
    // have configured which dependent integrations.
    return dependents.map((dep) => {
      const definition = getIntegrationDefinition(dep.integrationId)
      return {
        id: dep.id,
        integrationId: dep.integrationId,
        name: definition?.name ?? dep.integrationId,
      }
    })
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    detail: {
      tags: ['Integrations'],
      summary: 'Get integrations that depend on this one',
    },
  },
)

/**
 * DELETE /integrations/:id
 *
 * Delete an integration. Requires write permission for the
 * integration's scope. Cascade-deletes dependent integrations.
 */
app.delete(
  '/:id',
  async ({ params: { id }, user, set, status, t }) => {
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
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.warn({ err, id }, 'deleteIntegration failed')
        return status(400, { message: err.message })
      }
      logger.error({ err }, 'deleteIntegration unexpected non-Error throw')
      return status(500, { message: 'Failed to delete integration' })
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

/**
 * POST /integrations/test
 *
 * Test an integration configuration. Requires write permission for the
 * integration's scope.
 */
app.post(
  '/test',
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
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.warn({ err, integrationId }, 'testIntegrationConfig failed')
        return status(400, { message: err.message })
      }
      logger.error({ err }, 'testIntegrationConfig unexpected non-Error throw')
      return status(500, { message: 'Failed to test integration' })
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
