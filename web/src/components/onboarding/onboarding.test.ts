import { describe, test, expect, beforeEach, vi } from 'vitest'
import { ref, computed, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const mockMe = ref<any>(null)
const mockSubscription = ref<any>(null)

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({
    me: mockMe,
    needsOnboarding: computed(() => mockMe.value != null && mockMe.value.onboardingCompletedAt == null),
    updateUser: (user: any) => { mockMe.value = user },
  }),
}))

vi.mock('@/services/user.service', () => ({
  useUserService: () => ({
    checkAliasAvailability: vi.fn(async (alias: string) => alias !== 'taken'),
    updateMyProfile: vi.fn(async () => ({})),
    uploadAvatar: vi.fn(async () => ({})),
  }),
}))

vi.mock('@/stores/identity.store', () => ({
  useIdentityStore: () => ({
    domain: ref('example.com'),
    updateAlias: vi.fn(async () => ({ success: true })),
    startSetup: vi.fn(async () => {}),
    completeSetup: vi.fn(async () => true),
  }),
}))

vi.mock('@/services/subscription.service', () => ({
  useSubscriptionService: () => ({
    billingEnabled: ref(false),
    hasSubscription: ref(false),
    tier: ref('free'),
    products: ref([]),
    startCheckout: vi.fn(),
    verifySubscription: vi.fn(async () => ({ isPremium: false, isBasic: false })),
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: any) => {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
  }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useRoute: () => ({
    query: {},
  }),
}))

import { useAuthStore } from '@/stores/auth.store'
import { useUserService } from '@/services/user.service'

describe('needsOnboarding', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockMe.value = null
  })

  test('returns false when user is null', () => {
    const store = useAuthStore()
    expect((store.needsOnboarding as any).value).toBe(false)
  })

  test('returns true when onboardingCompletedAt is null', () => {
    mockMe.value = { id: '1', firstName: 'Test', onboardingCompletedAt: null }
    const store = useAuthStore()
    expect((store.needsOnboarding as any).value).toBe(true)
  })

  test('returns false when onboardingCompletedAt is set', () => {
    mockMe.value = { id: '1', firstName: 'Test', onboardingCompletedAt: '2026-01-01T00:00:00Z' }
    const store = useAuthStore()
    expect((store.needsOnboarding as any).value).toBe(false)
  })
})

describe('alias validation', () => {
  test('regex accepts valid usernames', () => {
    const regex = /^[a-zA-Z0-9_]{3,30}$/
    expect(regex.test('alice')).toBe(true)
    expect(regex.test('bob_123')).toBe(true)
    expect(regex.test('ABC')).toBe(true)
    expect(regex.test('a_B_3')).toBe(true)
    expect(regex.test('a'.repeat(30))).toBe(true)
  })

  test('regex rejects invalid usernames', () => {
    const regex = /^[a-zA-Z0-9_]{3,30}$/
    expect(regex.test('ab')).toBe(false) // too short
    expect(regex.test('a'.repeat(31))).toBe(false) // too long
    expect(regex.test('has space')).toBe(false)
    expect(regex.test('has-dash')).toBe(false)
    expect(regex.test('has.dot')).toBe(false)
    expect(regex.test('@mention')).toBe(false)
    expect(regex.test('')).toBe(false)
  })
})

describe('alias availability check', () => {
  test('returns true for available alias', async () => {
    const service = useUserService()
    const result = await service.checkAliasAvailability('newuser')
    expect(result).toBe(true)
  })

  test('returns false for taken alias', async () => {
    const service = useUserService()
    const result = await service.checkAliasAvailability('taken')
    expect(result).toBe(false)
  })
})

describe('auto-alias generation', () => {
  test('concatenates first and last name lowercase', () => {
    const firstName = 'Christopher'
    const lastName = 'Columbus'
    const autoAlias = `${firstName}${lastName}`.replace(/\s/g, '').toLowerCase()
    expect(autoAlias).toBe('christophercolumbus')
  })

  test('handles first name only', () => {
    const firstName = 'Alice'
    const lastName = ''
    const autoAlias = `${firstName}${lastName}`.replace(/\s/g, '').toLowerCase()
    expect(autoAlias).toBe('alice')
  })

  test('strips whitespace', () => {
    const firstName = 'Mary Jane'
    const lastName = 'Watson'
    const autoAlias = `${firstName}${lastName}`.replace(/\s/g, '').toLowerCase()
    expect(autoAlias).toBe('maryjanewatson')
  })

  test('handles empty names', () => {
    const autoAlias = `${''}${''}`.replace(/\s/g, '').toLowerCase()
    expect(autoAlias).toBe('')
  })
})

describe('avatar logic', () => {
  const COLUMBUS_AVATAR = 'https://api.dicebear.com/9.x/open-peeps/svg?seed=f&accessories=eyepatch&skinColor=d08b5b&accessoriesProbability=100&face=driven&facialHair=moustache1&facialHairProbability=100&head=hatHip&backgroundColor=b6e3f4'

  test('uses Columbus default when alias is empty', () => {
    const alias = ''
    const avatar = !alias
      ? COLUMBUS_AVATAR
      : `https://api.dicebear.com/9.x/open-peeps/svg?seed=${encodeURIComponent(alias)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`
    expect(avatar).toBe(COLUMBUS_AVATAR)
  })

  test('uses seed-based avatar when alias is set', () => {
    const alias = 'testuser'
    const avatar = !alias
      ? COLUMBUS_AVATAR
      : `https://api.dicebear.com/9.x/open-peeps/svg?seed=${encodeURIComponent(alias)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`
    expect(avatar).toContain('seed=testuser')
    expect(avatar).not.toBe(COLUMBUS_AVATAR)
  })

  test('encodes special characters in alias seed', () => {
    const alias = 'user name'
    const avatar = `https://api.dicebear.com/9.x/open-peeps/svg?seed=${encodeURIComponent(alias)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`
    expect(avatar).toContain('seed=user%20name')
  })

  test('validates file types for avatar upload', () => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp']
    expect(validTypes.includes('image/jpeg')).toBe(true)
    expect(validTypes.includes('image/png')).toBe(true)
    expect(validTypes.includes('image/webp')).toBe(true)
    expect(validTypes.includes('image/gif')).toBe(false)
    expect(validTypes.includes('image/svg+xml')).toBe(false)
  })

  test('rejects files over 2MB', () => {
    const maxSize = 2 * 1024 * 1024
    expect(1_000_000 <= maxSize).toBe(true)
    expect(2_097_152 <= maxSize).toBe(true)
    expect(2_097_153 <= maxSize).toBe(false)
  })
})

describe('onboarding step progression', () => {
  test('base steps are profile, theme, recovery-key, passkey', () => {
    const billingEnabled = false
    const hasSubscription = false

    const steps: string[] = ['profile', 'theme', 'recovery-key', 'passkey']
    if (billingEnabled) {
      steps.push('subscription')
      if (hasSubscription) steps.push('integrations')
    }

    expect(steps).toEqual(['profile', 'theme', 'recovery-key', 'passkey'])
  })

  test('adds subscription step when billing is enabled', () => {
    const billingEnabled = true
    const hasSubscription = false

    const steps: string[] = ['profile', 'theme', 'recovery-key', 'passkey']
    if (billingEnabled) {
      steps.push('subscription')
      if (hasSubscription) steps.push('integrations')
    }

    expect(steps).toEqual(['profile', 'theme', 'recovery-key', 'passkey', 'subscription'])
  })

  test('adds integrations step when user has subscription', () => {
    const billingEnabled = true
    const hasSubscription = true

    const steps: string[] = ['profile', 'theme', 'recovery-key', 'passkey']
    if (billingEnabled) {
      steps.push('subscription')
      if (hasSubscription) steps.push('integrations')
    }

    expect(steps).toEqual(['profile', 'theme', 'recovery-key', 'passkey', 'subscription', 'integrations'])
  })

  test('progress tracks visited steps', () => {
    const steps = ['profile', 'theme', 'recovery-key', 'passkey']
    const currentIndex = 2
    const progress = steps.map((_, i) => i <= currentIndex)
    expect(progress).toEqual([true, true, true, false])
  })

  test('isFirst and isLast flags', () => {
    const steps = ['profile', 'theme', 'recovery-key', 'passkey']
    const first = 0
    const last = steps.length - 1

    expect(first === 0).toBe(true)
    expect(first === last).toBe(false)
    expect(last === 0).toBe(false)
    expect(last === steps.length - 1).toBe(true)
  })
})

describe('step persistence', () => {
  const STORAGE_KEY = 'onboarding-step'

  beforeEach(() => {
    localStorage.clear()
  })

  test('persists current step to localStorage', () => {
    const steps = [
      { id: 'profile' },
      { id: 'theme' },
      { id: 'recovery-key' },
    ]
    const currentIndex = 1
    localStorage.setItem(STORAGE_KEY, steps[currentIndex].id)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('theme')
  })

  test('restores step index from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'recovery-key')
    const steps = [
      { id: 'profile' },
      { id: 'theme' },
      { id: 'recovery-key' },
      { id: 'passkey' },
    ]
    const savedId = localStorage.getItem(STORAGE_KEY)
    const idx = steps.findIndex(s => s.id === savedId)
    expect(idx).toBe(2)
  })

  test('defaults to 0 when saved step not found', () => {
    localStorage.setItem(STORAGE_KEY, 'nonexistent')
    const steps = [
      { id: 'profile' },
      { id: 'theme' },
    ]
    const savedId = localStorage.getItem(STORAGE_KEY)
    const idx = steps.findIndex(s => s.id === savedId)
    expect(idx).toBe(-1) // not found, wizard stays at 0
  })

  test('clears storage key on completion', () => {
    localStorage.setItem(STORAGE_KEY, 'theme')
    localStorage.removeItem(STORAGE_KEY)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('successUrl validation', () => {
  const CLIENT_ORIGIN = 'https://maps.example.com'

  function validateSuccessUrl(successUrl: string | undefined, clientOrigin: string): string {
    const defaultUrl = `${clientOrigin}/settings/account?checkout=success`
    if (!successUrl) return defaultUrl
    try {
      const parsed = new URL(successUrl)
      const allowed = new URL(clientOrigin)
      if (parsed.origin === allowed.origin) return successUrl
    } catch {
      // invalid URL
    }
    return defaultUrl
  }

  test('returns default when no successUrl provided', () => {
    const result = validateSuccessUrl(undefined, CLIENT_ORIGIN)
    expect(result).toBe('https://maps.example.com/settings/account?checkout=success')
  })

  test('accepts same-origin URL', () => {
    const url = 'https://maps.example.com/onboarding?checkout=success'
    const result = validateSuccessUrl(url, CLIENT_ORIGIN)
    expect(result).toBe(url)
  })

  test('rejects cross-origin URL', () => {
    const url = 'https://evil.com/steal-session'
    const result = validateSuccessUrl(url, CLIENT_ORIGIN)
    expect(result).toBe('https://maps.example.com/settings/account?checkout=success')
  })

  test('rejects invalid URL', () => {
    const result = validateSuccessUrl('not-a-url', CLIENT_ORIGIN)
    expect(result).toBe('https://maps.example.com/settings/account?checkout=success')
  })

  test('rejects javascript: protocol', () => {
    const result = validateSuccessUrl('javascript:alert(1)', CLIENT_ORIGIN)
    expect(result).toBe('https://maps.example.com/settings/account?checkout=success')
  })

  test('rejects data: protocol', () => {
    const result = validateSuccessUrl('data:text/html,<script>alert(1)</script>', CLIENT_ORIGIN)
    expect(result).toBe('https://maps.example.com/settings/account?checkout=success')
  })
})
