<script setup lang="ts">
import { ref, computed, provide, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { AppRoute } from '@/router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.store'
import { useSubscriptionService } from '@/services/subscription.service'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ArrowRight, ArrowLeft, Check } from 'lucide-vue-next'
import ProfileSetupStep from './ProfileSetupStep.vue'
import RecoveryKeyStep from './RecoveryKeyStep.vue'
import PasskeyStep from './PasskeyStep.vue'
import IntegrationsSetupStep from './IntegrationsSetupStep.vue'
import ThemeStep from './ThemeStep.vue'
import SubscriptionStep from './SubscriptionStep.vue'
import { validateKey, type StepValidateFn } from './types'
import { toast } from 'vue-sonner'

type StepId = 'profile' | 'theme' | 'recovery-key' | 'passkey' | 'subscription' | 'integrations'

interface StepDef {
  id: StepId
  component: any
  wide?: boolean
}

const STORAGE_KEY = 'onboarding-step'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const sub = useSubscriptionService()

const currentIndex = ref(0)
const completing = ref(false)
const stepValidateFn = ref<StepValidateFn | null>(null)
const canContinue = ref(true)

provide(validateKey, {
  register: (fn: StepValidateFn) => {
    stepValidateFn.value = fn
  },
  setCanContinue: (value: boolean) => {
    canContinue.value = value
  },
})

const steps = computed<StepDef[]>(() => {
  const s: StepDef[] = [
    { id: 'profile', component: ProfileSetupStep },
    { id: 'theme', component: ThemeStep },
    { id: 'recovery-key', component: RecoveryKeyStep },
    { id: 'passkey', component: PasskeyStep },
  ]
  if (sub.billingEnabled.value) {
    s.push({ id: 'subscription', component: SubscriptionStep, wide: true })
    if (sub.hasSubscription.value) {
      s.push({ id: 'integrations', component: IntegrationsSetupStep, wide: true })
    }
  }
  return s
})

const currentStep = computed(() => steps.value[currentIndex.value])
const isFirst = computed(() => currentIndex.value === 0)
const isLast = computed(() => currentIndex.value === steps.value.length - 1)
const progress = computed(() =>
  steps.value.map((_, i) => i <= currentIndex.value),
)

function persistStep() {
  localStorage.setItem(STORAGE_KEY, steps.value[currentIndex.value]?.id ?? '')
}

const stepRestored = ref(false)

watch(steps, (newSteps, oldSteps) => {
  if (stepRestored.value) return
  const savedId = localStorage.getItem(STORAGE_KEY)
  if (!savedId) {
    stepRestored.value = true
    return
  }
  const idx = newSteps.findIndex(s => s.id === savedId)
  if (idx > 0) {
    currentIndex.value = idx
    stepValidateFn.value = null
    canContinue.value = true
    stepRestored.value = true
  } else if (oldSteps && oldSteps.length === newSteps.length) {
    stepRestored.value = true
  }
}, { immediate: true })

const checkoutHandled = ref(false)

watch(steps, async () => {
  if (checkoutHandled.value) return
  if (route.query.checkout !== 'success') {
    checkoutHandled.value = true
    return
  }
  if (!sub.billingEnabled.value) return

  checkoutHandled.value = true
  router.replace({ query: {} })
  const status = await sub.verifySubscription()
  if (status.isPremium || status.isBasic) {
    const tierName = status.isPremium ? 'Premium' : 'Basic'
    toast.success(t('settings.billing.checkout.welcomeTier', { tier: tierName }))
  }
}, { immediate: true })

async function next() {
  if (stepValidateFn.value) {
    const valid = await stepValidateFn.value()
    if (!valid) return
  }

  advance()
}

function advance() {
  if (isLast.value) {
    complete()
  } else {
    currentIndex.value++
    stepValidateFn.value = null
    canContinue.value = true
    persistStep()
  }
}

function back() {
  if (!isFirst.value) {
    currentIndex.value--
    stepValidateFn.value = null
    canContinue.value = true
    persistStep()
  }
}

function handlePasskeyComplete() {
  advance()
}

async function complete() {
  completing.value = true
  try {
    const { api } = await import('@/lib/api')
    let completedAt: string
    try {
      const { data } = await api.post('/users/me/onboarding/complete')
      completedAt = data.onboardingCompletedAt
    } catch {
      completedAt = new Date().toISOString()
    }
    authStore.updateUser({
      ...authStore.me!,
      onboardingCompletedAt: completedAt,
    })
    localStorage.removeItem(STORAGE_KEY)
    router.push({ name: AppRoute.MAP })
  } finally {
    completing.value = false
  }
}

function handleInteractOutside(e: Event) {
  e.preventDefault()
}
</script>

<template>
  <Dialog :open="true">
    <DialogContent
      :class="[
        // Mobile: fullscreen
        'max-w-full h-[100dvh] max-h-[100dvh] rounded-none border-0',
        // Desktop: centered card
        'sm:h-auto sm:max-h-[90dvh] sm:rounded-lg sm:border',
        'gap-0 p-0 flex flex-col transition-[max-width] duration-300',
        currentStep.wide
          ? 'sm:max-w-2xl md:max-w-3xl'
          : 'sm:max-w-lg md:max-w-xl',
      ]"
      :trap-focus="true"
      @interact-outside="handleInteractOutside"
      @escape-key-down.prevent
    >
      <!-- Progress dots -->
      <div
        v-if="steps.length > 1"
        class="flex justify-center gap-1.5 pt-6 pb-2"
      >
        <div
          v-for="(done, i) in progress"
          :key="i"
          class="h-1.5 rounded-full transition-all duration-300"
          :class="[
            i === currentIndex
              ? 'w-6 bg-primary'
              : done
                ? 'w-1.5 bg-primary/40'
                : 'w-1.5 bg-muted-foreground/20',
          ]"
        />
      </div>

      <!-- Step content -->
      <div class="px-6 py-6 overflow-y-auto flex-1">
        <component
          :is="currentStep.component"
          :key="currentStep.id"
          @complete="handlePasskeyComplete"
        />
      </div>

      <!-- Footer navigation -->
      <div class="flex items-center justify-between px-6 pb-6 pt-2">
        <Button
          v-if="!isFirst"
          variant="ghost"
          @click="back"
        >
          <ArrowLeft class="h-4 w-4 mr-2" />
          {{ t('general.back') }}
        </Button>
        <div v-else />

        <Button
          @click="next"
          :disabled="completing || !canContinue"
        >
          <Spinner v-if="completing" class="h-4 w-4 mr-2" />
          <template v-else>
            <template v-if="isLast">
              <Check class="h-4 w-4 mr-2" />
              {{ t('onboarding.finish') }}
            </template>
            <template v-else>
              {{ currentStep.id === 'subscription' ? t('onboarding.subscription.skipLabel', { plan: t(`settings.billing.plan.${sub.tier.value}`) }) : t('general.continue') }}
              <ArrowRight class="h-4 w-4 ml-2" />
            </template>
          </template>
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
