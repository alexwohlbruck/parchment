import { Polar } from '@polar-sh/sdk'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { billing } from '../config'
import { users } from '../schema/users.schema'
import { usersToRoles } from '../schema/users-roles.schema'
import { logger } from '../lib/logger'

const PREMIUM_ROLE_ID = 'premium'

let polar: Polar | null = null
let cachedProduct: ProductInfo | null = null

export type ProductInfo = {
  name: string
  description: string | null
  priceAmount: number
  priceCurrency: string
  interval: string
  trialDays: number | null
}

function getPolar(): Polar {
  if (!polar) {
    polar = new Polar({
      accessToken: billing.accessToken,
      server: billing.sandbox ? 'sandbox' : 'production',
    })
  }
  return polar
}

/**
 * Fetch and cache the premium product info from Polar.
 * Cached in-memory since product details rarely change.
 */
export async function getProductInfo(): Promise<ProductInfo | null> {
  if (cachedProduct) return cachedProduct

  try {
    const product = await getPolar().products.get({ id: billing.premiumProductId })

    // Find the first non-archived fixed price
    const price = product.prices?.find(
      (p: any) => p.amountType === 'fixed' && !p.isArchived,
    ) as { priceAmount: number; priceCurrency: string } | undefined

    // Convert trial interval to days
    let trialDays: number | null = null
    if (product.trialIntervalCount && product.trialInterval) {
      const multiplier: Record<string, number> = {
        day: 1,
        week: 7,
        month: 30,
        year: 365,
      }
      trialDays = product.trialIntervalCount * (multiplier[product.trialInterval] ?? 30)
    }

    cachedProduct = {
      name: product.name,
      description: product.description ?? null,
      priceAmount: price?.priceAmount ?? 0,
      priceCurrency: price?.priceCurrency ?? 'usd',
      interval: product.recurringInterval ?? 'month',
      trialDays,
    }

    return cachedProduct
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch product info from Polar')
    return null
  }
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

/**
 * Fetch rich subscription details from Polar for display on the billing page.
 * Returns null if the user has no Polar customer link or no active subscription.
 */
export async function getSubscriptionDetails(userId: string) {
  const [user] = await db
    .select({ polarCustomerId: users.polarCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user?.polarCustomerId) return null

  const p = getPolar()

  try {
    const subs = await p.subscriptions.list({
      customerId: user.polarCustomerId,
      productId: billing.premiumProductId,
      limit: 1,
    })

    const sub = subs.result.items[0]
    if (!sub) return null

    // Extract price from the subscription's amount field
    const amount = sub.amount ?? 0
    const currency = sub.currency ?? 'usd'
    const interval = sub.recurringInterval ?? 'month'

    return {
      status: sub.status,
      amount,
      currency,
      interval,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
      startedAt: sub.startedAt?.toISOString() ?? null,
      productName: sub.product?.name ?? 'Premium',
    }
  } catch (err) {
    logger.warn({ userId, err }, 'Failed to fetch subscription details from Polar')
    return null
  }
}
