import { ref, computed } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'

function subscriptionService() {
  const authStore = useAuthStore()

  const billingEnabled = ref(false)
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

  const isPremium = computed(() => authStore.subscription?.isPremium ?? false)
  const hasSubscription = computed(() => authStore.subscription?.hasSubscription ?? false)

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
    hasSubscription,
    tier,
    loading,
    startCheckout,
    openPortal,
    refreshStatus,
    verifySubscription,
    fetchConfig,
  }
}

export const useSubscriptionService = createSharedComposable(subscriptionService)
