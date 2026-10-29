<script setup lang="ts">
import { ref, shallowRef, computed, provide, watch, useTemplateRef } from 'vue'
import { useMediaQuery, useResizeObserver } from '@vueuse/core'
import { domToCanvas } from 'modern-screenshot'
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
import { stepIndexKey, validateKey, type StepValidateFn } from './types'

type StepId = 'welcome' | 'profile' | 'theme' | 'recovery-key' | 'passkey' | 'integrations' | 'openstreetmap'

interface StepDef {
  id: StepId
  component: any
  wide?: boolean
}

const emit = defineEmits<{ finishing: [value: boolean]; unfolding: []; complete: [] }>()

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
const dialogRect = ref<DOMRect | null>(null)
const dialogFace = shallowRef<HTMLCanvasElement | null>(null)
const unfolding = ref(false)
let revealed = false
let snapshotting = false
let finished = false
const stepValidateFn = ref<StepValidateFn | null>(null)
const canContinue = ref(true)

provide(stepIndexKey, currentIndex)

const desktop = useMediaQuery('(min-width: 640px)')
const stepContent = useTemplateRef<HTMLElement>('stepContent')
const contentHeight = ref<number | null>(null)
useResizeObserver(stepContent, ([entry]) => {
  const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
  if (height > 0) contentHeight.value = height
})
const contentStyle = computed(() =>
  desktop.value && contentHeight.value ? { height: `${contentHeight.value + 48}px` } : undefined,
)
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

let pendingFace: Promise<HTMLCanvasElement | null> | null = null

function prepareFace() {
  if (!isLast.value || pendingFace || completedAt.value) return
  const card = document.querySelector<HTMLElement>('.onboarding-card')
  pendingFace = card
    ? domToCanvas(card, { scale: Math.min(window.devicePixelRatio || 1, 2) }).catch(() => null)
    : Promise.resolve(null)
}

watch(currentIndex, () => { pendingFace = null })

async function complete() {
  if (snapshotting || completing.value || completedAt.value) return
  snapshotting = true
  dialogRect.value = document.querySelector('.onboarding-card')?.getBoundingClientRect() ?? null
  prepareFace()
  dialogFace.value = await pendingFace
  snapshotting = false
  completing.value = true
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
  <OnboardingCompletion v-if="completedAt" :origin="dialogRect" :face="dialogFace" @reveal="revealMap" @start="unfolding = true; emit('unfolding')" @complete="finish" />
  <Dialog :open="!unfolding">
    <DialogContent
      overlay-class="onboarding-backdrop bg-background backdrop-blur-none !animate-none"
      :class="[
        // Mobile: fullscreen
        'max-w-full h-[100dvh] max-h-[100dvh] rounded-none border-0 max-sm:bg-background/75 max-sm:backdrop-blur-sm',
        // Desktop: centered card
        'sm:h-fit sm:max-h-[min(90dvh,880px)] sm:rounded-lg sm:border',
        'onboarding-card data-[state=closed]:animate-none',
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
      <div class="min-h-0 overflow-y-auto px-6 py-6 max-sm:flex-1 sm:shrink sm:transition-[height] sm:duration-300 sm:ease-out" :style="contentStyle">
        <div ref="stepContent" class="relative">
          <Transition name="onboarding-step">
            <component
              :is="currentStep.component"
              :key="currentStep.id"
              @complete="advance"
            />
          </Transition>
        </div>
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
          @pointerenter="prepareFace"
          @pointerdown="prepareFace"
          @focus="prepareFace"
          :disabled="completing || !!completedAt || !canContinue"
        >
          <Spinner v-if="completing || completedAt" class="h-4 w-4 mr-2" />
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

.onboarding-step-enter-active { transition: opacity 200ms ease; }
.onboarding-step-leave-active { position: absolute; inset: 0 0 auto; transition: opacity 160ms ease; pointer-events: none; }
.onboarding-step-enter-from, .onboarding-step-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .onboarding-step-enter-active, .onboarding-step-leave-active { transition: none; }
}
</style>
