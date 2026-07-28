import { describe, test, expect, mock, beforeEach } from 'bun:test'

// Stub DB and config before importing the service so the module-level
// `billing` object and Polar client come from our fakes.

const insertedRows: { userId: string; roleId: string }[] = []
const deletedWhere: unknown[] = []
const updatedSets: unknown[] = []

/**
 * Rows the next `db.select()` chain resolves to. Functions that issue more than
 * one select (getSubscriptionStatus reads roles, then the user) shift one entry
 * per call, so queue them in the order the service reads them. When the queue
 * is empty every select falls back to `selectRows`.
 */
let selectQueue: unknown[][] = []
let selectRows: unknown[] = []

function nextRows(): unknown[] {
  return selectQueue.length > 0 ? selectQueue.shift()! : selectRows
}

const fakeDb = {
  select: () => {
    // Resolved once per select() so a queued entry is consumed per statement.
    const rows = nextRows()
    // Drizzle chains end either at .where() or at .where().limit(). Returning an
    // array with a `limit` property satisfies both: awaiting it yields the rows,
    // and .limit() hands back the same rows.
    const terminal = Object.assign([...rows], { limit: () => rows })
    return { from: () => ({ where: () => terminal }) }
  },
  insert: () => ({
    values: (row: unknown) => {
      insertedRows.push(row as any)
      return {
        returning: () => [row],
        onConflictDoNothing: () => {},
      }
    },
  }),
  delete: () => ({
    where: (...args: unknown[]) => {
      deletedWhere.push(args)
    },
  }),
  update: () => ({
    set: (values: unknown) => {
      updatedSets.push(values)
      return { where: () => {} }
    },
  }),
}

mock.module('../db', () => ({ db: fakeDb }))
mock.module('../config', () => ({
  billing: {
    enabled: true,
    accessToken: 'test-token',
    basicProductId: 'prod_basic',
    premiumProductId: 'prod_premium',
    organizationId: 'org_test',
  },
  appName: 'Parchment',
  origins: {
    clientHostname: 'localhost',
    clientOrigin: 'http://localhost:5173',
    serverOrigin: 'http://localhost:5000',
  },
  isSelfHosted: false,
  registrationMode: 'invite',
}))
mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

let fakeCustomers: any[] = []
/** Active subscriptions keyed by the productId the service filters on. */
let fakeSubsByProduct: Record<string, any[]> = {}

mock.module('@polar-sh/sdk', () => ({
  Polar: class FakePolar {
    checkouts = {
      create: async (opts: any) => ({
        url: `https://polar.sh/checkout?products=${opts.products[0]}`,
      }),
    }
    customerSessions = {
      create: async () => ({ customerPortalUrl: 'https://polar.sh/portal/abc' }),
    }
    customers = {
      list: async () => ({ result: { items: fakeCustomers } }),
      get: async ({ id }: { id: string }) => {
        const found = fakeCustomers.find((c) => c.id === id)
        if (!found) throw new Error('not found')
        return found
      },
    }
    subscriptions = {
      list: async ({ productId }: { productId: string }) => ({
        result: { items: fakeSubsByProduct[productId] ?? [] },
      }),
    }
  },
}))

const subService = await import('./subscription.service')

describe('subscription.service', () => {
  beforeEach(() => {
    insertedRows.length = 0
    deletedWhere.length = 0
    updatedSets.length = 0
    selectQueue = []
    selectRows = []
    fakeCustomers = []
    fakeSubsByProduct = {}
  })

  describe('resolveProductTier', () => {
    test('maps configured product ids to their tier', () => {
      expect(subService.resolveProductTier('prod_basic')).toBe('basic')
      expect(subService.resolveProductTier('prod_premium')).toBe('premium')
    })

    test('returns null for an unknown product', () => {
      expect(subService.resolveProductTier('prod_unknown')).toBeNull()
    })
  })

  describe('role assignment', () => {
    test('assignPremiumRole inserts the premium role', async () => {
      await subService.assignPremiumRole('user-1')
      expect(insertedRows).toEqual([{ userId: 'user-1', roleId: 'premium' }])
    })

    test('assignBasicRole inserts the basic role', async () => {
      await subService.assignBasicRole('user-1')
      expect(insertedRows).toEqual([{ userId: 'user-1', roleId: 'basic' }])
    })

    test('removePremiumRole issues a delete', async () => {
      await subService.removePremiumRole('user-2')
      expect(deletedWhere).toHaveLength(1)
    })

    test('removeBasicRole issues a delete', async () => {
      await subService.removeBasicRole('user-2')
      expect(deletedWhere).toHaveLength(1)
    })

    test('assignTierRole routes each tier to the matching role', async () => {
      await subService.assignTierRole('user-1', 'basic')
      await subService.assignTierRole('user-1', 'premium')
      expect(insertedRows.map((row) => row.roleId)).toEqual(['basic', 'premium'])
    })

    test('assignTierRole on the free tier assigns nothing', async () => {
      await subService.assignTierRole('user-1', 'free')
      expect(insertedRows).toHaveLength(0)
    })
  })

  describe('getSubscriptionStatus', () => {
    test('reports premium when the user holds the premium role', async () => {
      selectQueue = [[{ roleId: 'premium' }], [{ polarCustomerId: null }]]
      expect(await subService.getSubscriptionStatus('user-1')).toEqual({
        isPremium: true,
        isBasic: false,
        hasSubscription: false,
        tier: 'premium',
      })
    })

    test('reports basic when the user holds only the basic role', async () => {
      selectQueue = [[{ roleId: 'basic' }], [{ polarCustomerId: null }]]
      expect(await subService.getSubscriptionStatus('user-1')).toEqual({
        isPremium: false,
        isBasic: true,
        hasSubscription: false,
        tier: 'basic',
      })
    })

    test('premium outranks basic when the user holds both', async () => {
      selectQueue = [
        [{ roleId: 'basic' }, { roleId: 'premium' }],
        [{ polarCustomerId: null }],
      ]
      const result = await subService.getSubscriptionStatus('user-1')
      expect(result.tier).toBe('premium')
      expect(result.isPremium).toBe(true)
      expect(result.isBasic).toBe(true)
    })

    test('reports free with no paid roles', async () => {
      selectQueue = [[], [{ polarCustomerId: null }]]
      expect(await subService.getSubscriptionStatus('user-2')).toEqual({
        isPremium: false,
        isBasic: false,
        hasSubscription: false,
        tier: 'free',
      })
    })

    test('hasSubscription tracks the Polar customer link, not the role', async () => {
      selectQueue = [[], [{ polarCustomerId: 'cus_1' }]]
      const result = await subService.getSubscriptionStatus('user-2')
      expect(result.hasSubscription).toBe(true)
      expect(result.tier).toBe('free')
    })
  })

  describe('findUserByPolarCustomerId', () => {
    test('returns the user when found', async () => {
      // Only the columns the service selects; cast past the full row type.
      const fakeUser = { id: 'u1', email: 'a@b.com', polarCustomerId: 'pol_1' }
      selectRows = [fakeUser]
      expect(await subService.findUserByPolarCustomerId('pol_1')).toEqual(
        fakeUser as any,
      )
    })

    test('returns null when not found', async () => {
      selectRows = []
      expect(await subService.findUserByPolarCustomerId('pol_unknown')).toBeNull()
    })
  })

  describe('linkPolarCustomer', () => {
    test('sets the polarCustomerId on the user', async () => {
      await subService.linkPolarCustomer('user-1', 'pol_123')
      expect(updatedSets).toHaveLength(1)
      expect((updatedSets[0] as any).polarCustomerId).toBe('pol_123')
    })
  })

  describe('createCheckoutSession', () => {
    test('returns a checkout URL', async () => {
      const url = await subService.createCheckoutSession(
        'user-1',
        'test@test.com',
        'http://localhost/success',
      )
      expect(url).toContain('polar.sh/checkout')
    })
  })

  describe('getCustomerPortalUrl', () => {
    test('returns a portal URL', async () => {
      expect(await subService.getCustomerPortalUrl('cus_123')).toBe(
        'https://polar.sh/portal/abc',
      )
    })
  })

  describe('verifyAndSyncSubscription', () => {
    test('assigns premium when Polar has an active premium subscription', async () => {
      fakeCustomers = [{ id: 'cus_1' }]
      fakeSubsByProduct = { prod_premium: [{ id: 'sub_1', status: 'active' }] }

      const result = await subService.verifyAndSyncSubscription('user-1', 'test@test.com')

      expect(result).toEqual({
        isPremium: true,
        isBasic: false,
        hasSubscription: true,
        tier: 'premium',
      })
      expect(insertedRows).toEqual([{ userId: 'user-1', roleId: 'premium' }])
      // The customer link is written before roles are reconciled.
      expect((updatedSets[0] as any).polarCustomerId).toBe('cus_1')
    })

    test('assigns basic when only a basic subscription is active', async () => {
      fakeCustomers = [{ id: 'cus_1' }]
      fakeSubsByProduct = { prod_basic: [{ id: 'sub_2', status: 'active' }] }

      const result = await subService.verifyAndSyncSubscription('user-1', 'test@test.com')

      expect(result).toEqual({
        isPremium: false,
        isBasic: true,
        hasSubscription: true,
        tier: 'basic',
      })
      expect(insertedRows).toEqual([{ userId: 'user-1', roleId: 'basic' }])
    })

    test('premium wins when both subscriptions are active', async () => {
      fakeCustomers = [{ id: 'cus_1' }]
      fakeSubsByProduct = {
        prod_basic: [{ id: 'sub_2', status: 'active' }],
        prod_premium: [{ id: 'sub_1', status: 'active' }],
      }

      const result = await subService.verifyAndSyncSubscription('user-1', 'test@test.com')

      expect(result.tier).toBe('premium')
      expect(insertedRows).toEqual([{ userId: 'user-1', roleId: 'premium' }])
    })

    test('drops both paid roles when the customer has no active subscription', async () => {
      fakeCustomers = [{ id: 'cus_1' }]

      const result = await subService.verifyAndSyncSubscription('user-1', 'test@test.com')

      expect(result).toEqual({
        isPremium: false,
        isBasic: false,
        hasSubscription: true,
        tier: 'free',
      })
      // Both tiers are revoked, so two deletes.
      expect(deletedWhere).toHaveLength(2)
      expect(insertedRows).toHaveLength(0)
    })

    test('drops both paid roles when no Polar customer exists', async () => {
      fakeCustomers = []

      const result = await subService.verifyAndSyncSubscription('user-1', 'test@test.com')

      expect(result).toEqual({
        isPremium: false,
        isBasic: false,
        hasSubscription: false,
        tier: 'free',
      })
      expect(deletedWhere).toHaveLength(2)
      // No customer means nothing to link.
      expect(updatedSets).toHaveLength(0)
    })

    test('refuses to re-link a Polar customer already owned by another user', async () => {
      fakeCustomers = [{ id: 'cus_1' }]
      fakeSubsByProduct = { prod_premium: [{ id: 'sub_1', status: 'active' }] }
      // 1st select: this user's polarCustomerId (none).
      // 2nd select: findUserByPolarCustomerId — a *different* user owns cus_1.
      selectQueue = [[], [{ id: 'other-user', polarCustomerId: 'cus_1' }]]

      const result = await subService.verifyAndSyncSubscription('user-1', 'test@test.com')

      expect(result).toEqual({
        isPremium: false,
        isBasic: false,
        hasSubscription: false,
        tier: 'free',
      })
      // Guard must fire before the link write and before any role is granted.
      expect(updatedSets).toHaveLength(0)
      expect(insertedRows).toHaveLength(0)
    })
  })
})
