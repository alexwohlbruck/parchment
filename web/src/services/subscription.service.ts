import { ref, computed } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'

function subscriptionService() {
  const authService = useAuthService()

  const billingEnabled = ref(false)
  const hasSubscription = ref(false)
  const loading = ref(false)

  async function fetchConfig() {
    try {
      const { data } = await api.get('/subscriptions/config')
      billingEnabled.value = data.billingEnabled
    } catch {
      billingEnabled.value = false
    }
  }

  fetchConfig()
  refreshStatus().catch(() => {})

  const isPremium = computed(() => {
    if (!billingEnabled.value) return true
    return authService.hasPermission(PermissionId.PREMIUM_DATA_PROVIDERS)
  })

  const tier = computed(() => (isPremium.value ? 'premium' : 'free'))

  async function startCheckout() {
    loading.value = true
    try {
      const { data } = await api.post('/subscriptions/checkout')
      window.location.href = data.checkoutUrl
    } finally {
      loading.value = false
    }
  }

  async function openPortal() {
    const { data } = await api.get('/subscriptions/portal')
    window.open(data.portalUrl, '_blank')
  }

  async function refreshStatus() {
    const { data } = await api.get('/subscriptions/status')
    hasSubscription.value = data.hasSubscription
    if (data.isPremium) {
      await authService.getPermissions()
    }
    return data
  }

  return {
    billingEnabled,
    isPremium,
    hasSubscription,
    tier,
    loading,
    startCheckout,
    openPortal,
    refreshStatus,
    fetchConfig,
  }
}

export const useSubscriptionService = createSharedComposable(subscriptionService)
