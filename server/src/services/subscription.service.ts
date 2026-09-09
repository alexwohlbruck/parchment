import { Polar } from '@polar-sh/sdk'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../db'
import { billing } from '../config'
import { users } from '../schema/users.schema'
import { usersToRoles } from '../schema/users-roles.schema'
import { logger } from '../lib/logger'

const BASIC_ROLE_ID = 'basic'
const PREMIUM_ROLE_ID = 'premium'

let polar: Polar | null = null
let cachedProducts: Record<string, { info: ProductInfo; fetchedAt: number }> = {}
const PRODUCT_CACHE_TTL = 60 * 60 * 1000 // 1 hour

export type Tier = 'free' | 'basic' | 'premium'

export type ProductInfo = {
  name: string
  description: string | null
  priceAmount: number
  priceCurrency: string
  interval: string
  trialDays: number | null
  tier: Tier
}

export function clearProductCache() {
  cachedProducts = {}
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
 * Map a Polar product ID to its tier.
 */
export function resolveProductTier(productId: string): Tier | null {
  if (productId === billing.basicProductId) return 'basic'
  if (productId === billing.premiumProductId) return 'premium'
  return null
}

/**
 * Fetch product info for a single Polar product.
 */
async function fetchProductInfo(productId: string, tier: Tier): Promise<ProductInfo | null> {
  if (!productId) return null
  const cached = cachedProducts[productId]
  if (cached && Date.now() - cached.fetchedAt < PRODUCT_CACHE_TTL) return cached.info

  try {
    const product = await getPolar().products.get({ id: productId })

    // Filter to active fixed prices; take the last one (most recently created)
    // so price changes in Polar are picked up immediately.
    const fixedPrices = (product.prices ?? []).filter(
      (p: any) => p.amountType === 'fixed' && !p.isArchived,
    ) as { priceAmount: number; priceCurrency: string }[]
    const price = fixedPrices[fixedPrices.length - 1]

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

    const info: ProductInfo = {
      name: product.name,
      description: product.description ?? null,
      priceAmount: price?.priceAmount ?? 0,
      priceCurrency: price?.priceCurrency ?? 'usd',
      interval: product.recurringInterval ?? 'month',
      trialDays,
      tier,
    }

    cachedProducts[productId] = { info, fetchedAt: Date.now() }
    logger.debug({ productId, tier, priceAmount: info.priceAmount }, 'Fetched product info from Polar')
    return info
  } catch (err) {
    logger.warn({ err, productId }, 'Failed to fetch product info from Polar')
    return null
  }
}

/**
 * Fetch and cache the premium product info from Polar.
 */
export async function getProductInfo(): Promise<ProductInfo | null> {
  return fetchProductInfo(billing.premiumProductId, 'premium')
}

/**
 * Fetch and cache the basic product info from Polar.
 */
export async function getBasicProductInfo(): Promise<ProductInfo | null> {
  return fetchProductInfo(billing.basicProductId, 'basic')
}

/**
 * Fetch info for all configured products.
 */
export async function getProductsInfo(): Promise<{ basic: ProductInfo | null; premium: ProductInfo | null }> {
  const [basic, premium] = await Promise.all([
    getBasicProductInfo(),
    getProductInfo(),
  ])
  return { basic, premium }
}

export async function createCheckoutSession(
  userId: string,
  userEmail: string,
  successUrl: string,
  productId?: string,
) {
  const targetProductId = productId ?? billing.premiumProductId
  const base = {
    products: [targetProductId],
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

// ── Role assignment ─────────────────────────────────────────────────────

export async function assignBasicRole(userId: string) {
  await db
    .insert(usersToRoles)
    .values({ userId, roleId: BASIC_ROLE_ID })
    .onConflictDoNothing()
  logger.info({ userId }, 'Assigned basic role')
}

export async function removeBasicRole(userId: string) {
  await db
    .delete(usersToRoles)
    .where(
      and(
        eq(usersToRoles.userId, userId),
        eq(usersToRoles.roleId, BASIC_ROLE_ID),
      ),
    )
  logger.info({ userId }, 'Removed basic role')
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

/**
 * Assign the role for a given tier, removing the other paid role if present.
 */
export async function assignTierRole(userId: string, tier: Tier) {
  if (tier === 'basic') {
    await removePremiumRole(userId)
    await assignBasicRole(userId)
  } else if (tier === 'premium') {
    await removeBasicRole(userId)
    await assignPremiumRole(userId)
  }
}

/**
 * Remove the role for a given tier.
 */
export async function removeTierRole(userId: string, tier: Tier) {
  if (tier === 'basic') {
    await removeBasicRole(userId)
  } else if (tier === 'premium') {
    await removePremiumRole(userId)
  }
}

// ── Customer linking ────────────────────────────────────────────────────

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

// ── Status queries ──────────────────────────────────────────────────────

/**
 * Determine the user's highest tier from their roles.
 * Premium > Basic > Free
 */
export async function getSubscriptionStatus(userId: string) {
  const rows = await db
    .select({ roleId: usersToRoles.roleId })
    .from(usersToRoles)
    .where(
      and(
        eq(usersToRoles.userId, userId),
        inArray(usersToRoles.roleId, [BASIC_ROLE_ID, PREMIUM_ROLE_ID]),
      ),
    )

  const [user] = await db
    .select({ polarCustomerId: users.polarCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const roleIds = rows.map(r => r.roleId)
  const isPremium = roleIds.includes(PREMIUM_ROLE_ID)
  const isBasic = roleIds.includes(BASIC_ROLE_ID)
  const hasSubscription = !!user?.polarCustomerId

  let tier: Tier = 'free'
  if (isPremium) tier = 'premium'
  else if (isBasic) tier = 'basic'

  return { isPremium, isBasic, hasSubscription, tier } as const
}

export async function verifyAndSyncSubscription(userId: string, userEmail: string) {
  const p = getPolar()

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
    await removeBasicRole(userId)
    await removePremiumRole(userId)
    return { isPremium: false, isBasic: false, hasSubscription: false, tier: 'free' as const }
  }

  const existingLinkedUser = await findUserByPolarCustomerId(customer.id)
  if (existingLinkedUser && existingLinkedUser.id !== userId) {
    logger.warn(
      { userId, existingUserId: existingLinkedUser.id, polarCustomerId: customer.id },
      'Polar customer already linked to a different user — refusing to re-link',
    )
    await removeBasicRole(userId)
    await removePremiumRole(userId)
    return { isPremium: false, isBasic: false, hasSubscription: false, tier: 'free' as const }
  }

  await linkPolarCustomer(userId, customer.id)

  // Check for premium subscription first
  const premiumSubs = billing.premiumProductId
    ? await p.subscriptions.list({
        customerId: customer.id,
        productId: billing.premiumProductId,
        active: true,
        limit: 1,
      })
    : { result: { items: [] } }

  if (premiumSubs.result.items[0]) {
    await removeBasicRole(userId)
    await assignPremiumRole(userId)
    logger.info({ userId, polarCustomerId: customer.id }, 'Premium subscription verified active')
    return { isPremium: true, isBasic: false, hasSubscription: true, tier: 'premium' as const }
  }

  // Check for basic subscription
  const basicSubs = billing.basicProductId
    ? await p.subscriptions.list({
        customerId: customer.id,
        productId: billing.basicProductId,
        active: true,
        limit: 1,
      })
    : { result: { items: [] } }

  if (basicSubs.result.items[0]) {
    await removePremiumRole(userId)
    await assignBasicRole(userId)
    logger.info({ userId, polarCustomerId: customer.id }, 'Basic subscription verified active')
    return { isPremium: false, isBasic: true, hasSubscription: true, tier: 'basic' as const }
  }

  // No active subscription
  await removeBasicRole(userId)
  await removePremiumRole(userId)
  logger.info({ userId, polarCustomerId: customer.id }, 'No active subscription found via Polar API')
  return { isPremium: false, isBasic: false, hasSubscription: true, tier: 'free' as const }
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

  // Check premium first, then basic
  const productIds = [billing.premiumProductId, billing.basicProductId].filter(Boolean)

  for (const productId of productIds) {
    try {
      const subs = await p.subscriptions.list({
        customerId: user.polarCustomerId,
        productId,
        limit: 1,
      })

      const sub = subs.result.items[0]
      if (!sub) continue

      const amount = sub.amount ?? 0
      const currency = sub.currency ?? 'usd'
      const interval = sub.recurringInterval ?? 'month'
      const tier = resolveProductTier(productId) ?? 'free'

      return {
        status: sub.status,
        amount,
        currency,
        interval,
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
        startedAt: sub.startedAt?.toISOString() ?? null,
        productName: sub.product?.name ?? (tier === 'premium' ? 'Premium' : 'Basic'),
        tier,
      }
    } catch (err) {
      logger.warn({ userId, productId, err }, 'Failed to fetch subscription details from Polar')
    }
  }

  return null
}

/**
 * Fetch rich Polar subscription data for admin user detail pages.
 * Returns customer info, active subscription, recent orders, and portal URL.
 */
export async function getAdminUserSubscriptionInfo(userId: string) {
  const [user] = await db
    .select({ polarCustomerId: users.polarCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user?.polarCustomerId) return null

  const p = getPolar()

  try {
    const customer = await p.customers.get({ id: user.polarCustomerId })

    // Find active subscription across configured products
    let subscription: any = null
    const productIds = [billing.premiumProductId, billing.basicProductId].filter(Boolean)
    for (const productId of productIds) {
      const subs = await p.subscriptions.list({
        customerId: user.polarCustomerId,
        productId,
        limit: 1,
      })
      const sub = subs.result.items[0]
      if (sub) {
        const tier = resolveProductTier(productId) ?? 'free'
        subscription = {
          id: sub.id,
          status: sub.status,
          tier,
          productName: sub.product?.name ?? tier,
          amount: sub.amount ?? 0,
          currency: sub.currency ?? 'usd',
          interval: sub.recurringInterval ?? 'month',
          currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
          canceledAt: sub.canceledAt?.toISOString() ?? null,
          startedAt: sub.startedAt?.toISOString() ?? null,
        }
        break
      }
    }

    // Fetch recent orders
    let orders: any[] = []
    try {
      const orderResult = await p.orders.list({
        customerId: user.polarCustomerId,
        limit: 10,
      })
      orders = orderResult.result.items.map((o: any) => ({
        id: o.id,
        status: o.status,
        amount: o.amount ?? 0,
        currency: o.currency ?? 'usd',
        createdAt: o.createdAt?.toISOString() ?? null,
        billingReason: o.billingReason ?? null,
      }))
    } catch (err) {
      logger.warn({ userId, err }, 'Failed to fetch orders from Polar')
    }

    // Customer portal URL
    let portalUrl: string | null = null
    try {
      portalUrl = await getCustomerPortalUrl(user.polarCustomerId)
    } catch (err) {
      logger.warn({ userId, err }, 'Failed to get customer portal URL')
    }

    return {
      customer: {
        email: customer.email,
        name: customer.name ?? null,
        avatarUrl: customer.avatarUrl ?? null,
      },
      subscription,
      orders,
      portalUrl,
    }
  } catch (err) {
    logger.warn({ userId, err }, 'Failed to fetch admin subscription info from Polar')
    return null
  }
}
