import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

// Stub DB and config before importing the service so the module-level
// `billing` object comes from our fake.

const insertedRows: { userId: string; roleId: string }[] = []
const deletedWhere: unknown[] = []
const updatedSets: unknown[] = []
let selectRows: unknown[] = []

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => selectRows,
      }),
    }),
  }),
  insert: (table: unknown) => ({
    values: (row: unknown) => {
      insertedRows.push(row as any)
      return { returning: () => [row] }
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
      return {
        where: () => {},
      }
    },
  }),
}

mock.module('../db', () => ({ db: fakeDb }))
mock.module('../config', () => ({
  billing: {
    enabled: true,
    accessToken: 'test-token',
    premiumProductId: 'prod_test',
  },
}))
mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
}))
mock.module('@polar-sh/sdk', () => ({
  Polar: class FakePolar {
    checkouts = {
      create: async (opts: any) => ({
        url: `https://polar.sh/checkout?products=${opts.products[0]}`,
      }),
    }
    customerSessions = {
      create: async () => ({
        customerPortalUrl: 'https://polar.sh/portal/abc',
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
    selectRows = []
  })

  describe('assignPremiumRole', () => {
    test('inserts when role not already present', async () => {
      selectRows = []
      await subService.assignPremiumRole('user-1')
      expect(insertedRows).toHaveLength(1)
      expect(insertedRows[0]).toEqual({
        userId: 'user-1',
        roleId: 'premium',
      })
    })

    test('is idempotent — skips insert if already assigned', async () => {
      selectRows = [{ userId: 'user-1', roleId: 'premium' }]
      await subService.assignPremiumRole('user-1')
      expect(insertedRows).toHaveLength(0)
    })
  })

  describe('removePremiumRole', () => {
    test('calls delete', async () => {
      await subService.removePremiumRole('user-2')
      expect(deletedWhere).toHaveLength(1)
    })
  })

  describe('getSubscriptionStatus', () => {
    test('returns isPremium: true when user has premium role', async () => {
      selectRows = [{ userId: 'user-1', roleId: 'premium' }]
      const result = await subService.getSubscriptionStatus('user-1')
      expect(result).toEqual({ isPremium: true, tier: 'premium' })
    })

    test('returns isPremium: false when user lacks premium role', async () => {
      selectRows = []
      const result = await subService.getSubscriptionStatus('user-2')
      expect(result).toEqual({ isPremium: false, tier: 'free' })
    })
  })

  describe('findUserByPolarCustomerId', () => {
    test('returns user when found', async () => {
      const fakeUser = { id: 'u1', email: 'a@b.com', polarCustomerId: 'pol_1' }
      selectRows = [fakeUser]
      const result = await subService.findUserByPolarCustomerId('pol_1')
      expect(result).toEqual(fakeUser)
    })

    test('returns null when not found', async () => {
      selectRows = []
      const result = await subService.findUserByPolarCustomerId('pol_unknown')
      expect(result).toBeNull()
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
      const url = await subService.getCustomerPortalUrl('cus_123')
      expect(url).toBe('https://polar.sh/portal/abc')
    })
  })
})
