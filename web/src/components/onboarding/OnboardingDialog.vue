<script setup lang="ts">
import { ref, computed, provide, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useAuthStore } from '@/stores/auth.store'
import { useSubscriptionService } from '@/services/subscription.service'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ArrowRight, ArrowLeft, Check } from 'lucide-vue-next'
import OnboardingCompletion from './OnboardingCompletion.vue'
import ProfileSetupStep from './ProfileSetupStep.vue'
import RecoveryKeyStep from './RecoveryKeyStep.vue'
import PasskeyStep from './PasskeyStep.vue'
import IntegrationsSetupStep from './IntegrationsSetupStep.vue'
import OpenStreetMapStep from './OpenStreetMapStep.vue'
import ThemeStep from './ThemeStep.vue'
import WelcomeStep from './WelcomeStep.vue'
import { validateKey, type StepValidateFn } from './types'

type StepId = 'welcome' | 'profile' | 'theme' | 'recovery-key' | 'passkey' | 'integrations' | 'openstreetmap'

interface StepDef {
  id: StepId
  component: any
  wide?: boolean
}

const emit = defineEmits<{ finishing: [value: boolean]; complete: [] }>()

const STORAGE_KEY = 'onboarding-step'

const { t } = useI18n()
const authStore = useAuthStore()
const sub = useSubscriptionService()
const integrations = useIntegrationsStore()
const skippingOsm = computed(() => currentStep.value.id === 'openstreetmap' && !integrations.osmProfile)
const skippingPasskey = computed(() => currentStep.value.id === 'passkey')

const currentIndex = ref(0)
const completing = ref(false)
const completedAt = ref<string | null>(null)
const brandOrigin = ref<DOMRect | null>(null)
let revealed = false
let finished = false
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
    { id: 'welcome', component: WelcomeStep },
    { id: 'profile', component: ProfileSetupStep },
    { id: 'theme', component: ThemeStep },
    { id: 'recovery-key', component: RecoveryKeyStep },
    { id: 'passkey', component: PasskeyStep },
    { id: 'openstreetmap', component: OpenStreetMapStep },
  ]
  if (sub.billingEnabled.value && sub.hasSubscription.value) {
    s.push({ id: 'integrations', component: IntegrationsSetupStep, wide: true })
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

async function next() {
  if (completing.value || completedAt.value) return
  if (stepValidateFn.value) {
    const valid = await stepValidateFn.value()
    if (!valid) return
  }

  advance()
}

function advance() {
  if (completing.value || completedAt.value) return
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
  if (completing.value) return
  if (!isFirst.value) {
    currentIndex.value--
    stepValidateFn.value = null
    canContinue.value = true
    persistStep()
  }
}

async function complete() {
  if (completing.value || completedAt.value) return
  completing.value = true
  brandOrigin.value = document.querySelector('[data-onboarding-brand]')?.getBoundingClientRect() ?? null
  emit('finishing', true)
  try {
    const { api } = await import('@/lib/api')
    let timestamp: string
    try {
      const { data } = await api.post('/users/me/onboarding/complete')
      timestamp = data.onboardingCompletedAt
    } catch {
      timestamp = new Date().toISOString()
    }
    completedAt.value = timestamp
  } finally {
    completing.value = false
    if (!completedAt.value) emit('finishing', false)
  }
}

function revealMap() {
  if (revealed || !completedAt.value) return
  revealed = true
  authStore.updateUser({
    ...authStore.me!,
    onboardingCompletedAt: completedAt.value,
  })
  localStorage.removeItem(STORAGE_KEY)
  authStore.goToStashedPath()
}

function finish() {
  if (finished) return
  finished = true
  revealMap()
  emit('complete')
}

function handleInteractOutside(e: Event) {
  e.preventDefault()
}
</script>

<template>
  <OnboardingCompletion v-if="completedAt" :origin="brandOrigin" @reveal="revealMap" @complete="finish" />
  <Dialog v-else :open="true">
    <DialogContent
      overlay-class="onboarding-backdrop bg-background backdrop-blur-none !animate-none"
      :class="[
        // Mobile: fullscreen
        'max-w-full h-[100dvh] max-h-[100dvh] rounded-none border-0 max-sm:bg-background/75 max-sm:backdrop-blur-sm',
        // Desktop: centered card
        'sm:h-fit sm:max-h-[min(85dvh,720px)] sm:rounded-lg sm:border',
        'gap-0 p-0 flex flex-col transition-[max-width] duration-300',
        currentStep.wide
          ? 'sm:max-w-2xl md:max-w-3xl'
          : 'sm:max-w-lg md:max-w-xl',
      ]"
      :show-close-button="false"
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
          @complete="advance"
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
          :variant="skippingOsm || skippingPasskey ? 'ghost' : 'default'"
          @click="next"
          :disabled="completing || !canContinue"
        >
          <Spinner v-if="completing" class="h-4 w-4 mr-2" />
          <template v-else>
            <template v-if="skippingPasskey">
              {{ t('settings.identity.recoveryKey.passkeyOffer.skipForNow') }}
            </template>
            <template v-else-if="skippingOsm">
              {{ t('onboarding.openstreetmap.skip') }}
            </template>
            <template v-else-if="isLast">
              <Check class="h-4 w-4 mr-2" />
              {{ t('onboarding.finish') }}
            </template>
            <template v-else>
              {{ currentStep.id === 'welcome' ? t('onboarding.welcome.start') : t('general.continue') }}
              <ArrowRight class="h-4 w-4 ml-2" />
            </template>
          </template>
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style>
.onboarding-backdrop::before {
  content: '';
  position: absolute;
  inset: 0;
  background: url('@/assets/img/parchment-map.png') center / cover no-repeat;
  opacity: 0.35;
}

.dark .onboarding-backdrop::before { filter: invert(1); }
</style>
