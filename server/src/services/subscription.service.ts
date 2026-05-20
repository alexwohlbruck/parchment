import { Polar } from '@polar-sh/sdk'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { billing } from '../config'
import { users } from '../schema/users.schema'
import { usersToRoles } from '../schema/users-roles.schema'
import { logger } from '../lib/logger'

const PREMIUM_ROLE_ID = 'premium'

let polar: Polar | null = null

function getPolar(): Polar {
  if (!polar) {
    polar = new Polar({
      accessToken: billing.accessToken,
      server: billing.sandbox ? 'sandbox' : 'production',
    })
  }
  return polar
}

export async function createCheckoutSession(
  userId: string,
  userEmail: string,
  successUrl: string,
) {
  const base = {
    products: [billing.premiumProductId],
    metadata: { parchmentUserId: userId },
    successUrl,
  }
  try {
    const checkout = await getPolar().checkouts.create({
      ...base,
      customerEmail: userEmail,
    })
    return checkout.url
  } catch {
    const checkout = await getPolar().checkouts.create(base)
    return checkout.url
  }
}

export async function getCustomerPortalUrl(polarCustomerId: string) {
  const session = await getPolar().customerSessions.create({
    customerId: polarCustomerId,
  })
  return session.customerPortalUrl
}

export async function assignPremiumRole(userId: string) {
  await db
    .insert(usersToRoles)
    .values({ userId, roleId: PREMIUM_ROLE_ID })
    .onConflictDoNothing()
  logger.info({ userId }, 'Assigned premium role')
}

export async function removePremiumRole(userId: string) {
  await db
    .delete(usersToRoles)
    .where(
      and(
        eq(usersToRoles.userId, userId),
        eq(usersToRoles.roleId, PREMIUM_ROLE_ID),
      ),
    )
  logger.info({ userId }, 'Removed premium role')
}

export async function linkPolarCustomer(
  userId: string,
  polarCustomerId: string,
) {
  await db
    .update(users)
    .set({ polarCustomerId, updatedAt: new Date() })
    .where(eq(users.id, userId))
}

export async function findUserByPolarCustomerId(polarCustomerId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.polarCustomerId, polarCustomerId))
    .limit(1)
  return user ?? null
}

export async function verifyAndSyncSubscription(userId: string, userEmail: string) {
  const p = getPolar()

  // Try to find the Polar customer — first by an existing link in our DB,
  // then by email. Handles the case where the Polar checkout email differs
  // from the Parchment account email (common in dev/sandbox).
  const [localUser] = await db
    .select({ polarCustomerId: users.polarCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  let customer: { id: string } | undefined

  if (localUser?.polarCustomerId) {
    try {
      customer = await p.customers.get({ id: localUser.polarCustomerId })
    } catch {
      // Customer may have been deleted on Polar side
    }
  }

  if (!customer) {
    const customers = await p.customers.list({
      email: userEmail,
      organizationId: billing.organizationId,
      limit: 1,
    })
    customer = customers.result.items[0]
  }

  if (!customer) {
    await removePremiumRole(userId)
    return { isPremium: false, hasSubscription: false, tier: 'free' as const }
  }

  const existingLinkedUser = await findUserByPolarCustomerId(customer.id)
  if (existingLinkedUser && existingLinkedUser.id !== userId) {
    logger.warn(
      { userId, existingUserId: existingLinkedUser.id, polarCustomerId: customer.id },
      'Polar customer already linked to a different user — refusing to re-link',
    )
    await removePremiumRole(userId)
    return { isPremium: false, hasSubscription: false, tier: 'free' as const }
  }

  await linkPolarCustomer(userId, customer.id)

  const subs = await p.subscriptions.list({
    customerId: customer.id,
    productId: billing.premiumProductId,
    active: true,
    limit: 1,
  })

  const activeSub = subs.result.items[0]
  if (activeSub) {
    await assignPremiumRole(userId)
    logger.info({ userId, polarCustomerId: customer.id }, 'Subscription verified active via Polar API')
    return { isPremium: true, hasSubscription: true, tier: 'premium' as const }
  }

  await removePremiumRole(userId)
  logger.info({ userId, polarCustomerId: customer.id }, 'Subscription verified inactive via Polar API')
  return { isPremium: false, hasSubscription: true, tier: 'free' as const }
}

export async function getSubscriptionStatus(userId: string) {
  const [row] = await db
    .select()
    .from(usersToRoles)
    .where(
      and(
        eq(usersToRoles.userId, userId),
        eq(usersToRoles.roleId, PREMIUM_ROLE_ID),
      ),
    )
    .limit(1)

  const [user] = await db
    .select({ polarCustomerId: users.polarCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const isPremium = !!row
  const hasSubscription = !!user?.polarCustomerId
  return { isPremium, hasSubscription, tier: isPremium ? 'premium' : 'free' } as const
}
