import { ref, computed } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'

export type Tier = 'free' | 'basic' | 'premium'

export type SubscriptionDetails = {
  status: string
  amount: number
  currency: string
  interval: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  startedAt: string | null
  productName: string
  tier: Tier
}

export type ProductInfo = {
  name: string
  description: string | null
  priceAmount: number
  priceCurrency: string
  interval: string
  trialDays: number | null
  tier: Tier
}

function subscriptionService() {
  const authStore = useAuthStore()

  const billingEnabled = ref(false)
  const checkingOutTier = ref<Tier | null>(null)
  const details = ref<SubscriptionDetails | null>(null)
  const basicProduct = ref<ProductInfo | null>(null)
  const premiumProduct = ref<ProductInfo | null>(null)

  async function fetchConfig() {
    try {
      const { data } = await api.get('/subscriptions/config')
      billingEnabled.value = data.billingEnabled
      if (data.products) {
        basicProduct.value = data.products.basic ?? null
        premiumProduct.value = data.products.premium ?? null
      }
    } catch {
      billingEnabled.value = false
    }
  }

  // Kick off the config fetch once and keep the promise so callers (and
  // guarded endpoints below) can wait for `billingEnabled` to settle before
  // deciding whether to hit billing-only routes.
  const configReady = fetchConfig()

  const isPremium = computed(() => authStore.subscription?.isPremium ?? false)
  const isBasic = computed(() => authStore.subscription?.isBasic ?? false)
  const hasSubscription = computed(() => authStore.subscription?.hasSubscription ?? false)

  const tier = computed<Tier>(() => {
    const t = authStore.subscription?.tier
    if (t === 'premium' || t === 'basic') return t
    return 'free'
  })

  async function startCheckout(checkoutTier?: Tier, successUrl?: string) {
    const tier = checkoutTier ?? 'basic'
    checkingOutTier.value = tier
    try {
      const { data } = await api.post('/subscriptions/checkout', {
        tier,
        successUrl,
      })
      window.location.href = data.checkoutUrl
    } finally {
      checkingOutTier.value = null
    }
  }

  async function openPortal() {
    const { data } = await api.get('/subscriptions/portal')
    window.open(data.portalUrl, '_blank')
  }

  async function fetchDetails() {
    // Billing-only route: when billing is disabled the server never registers
    // it, so calling would 404 (and spawn an error toast). Wait for config,
    // then bail out cleanly. `silentStatuses` is a defensive net in case
    // billing flips off server-side between config and this call.
    await configReady
    if (!billingEnabled.value) {
      details.value = null
      return
    }
    try {
      const { data } = await api.get('/subscriptions/details', {
        silentStatuses: [404],
      } as any)
      details.value = data.details
    } catch {
      details.value = null
    }
  }

  async function refreshStatus() {
    // Re-fetch permissions + subscription from the server
    const { useAuthService } = await import('@/services/auth.service')
    await useAuthService().getPermissions()
  }

  async function verifySubscription() {
    // Verify with Polar and sync roles, then re-fetch permissions
    const { data } = await api.post('/subscriptions/verify')
    const { useAuthService } = await import('@/services/auth.service')
    await useAuthService().getPermissions()
    return data
  }

  return {
    billingEnabled,
    isPremium,
    isBasic,
    hasSubscription,
    tier,
    checkingOutTier,
    details,
    basicProduct,
    premiumProduct,
    startCheckout,
    openPortal,
    refreshStatus,
    verifySubscription,
    fetchConfig,
    fetchDetails,
    configReady,
  }
}

export const useSubscriptionService = createSharedComposable(subscriptionService)
