<script setup lang="ts">
import { ref, computed, provide } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.store'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ArrowRight, ArrowLeft, Check } from 'lucide-vue-next'
import ProfileSetupStep from './ProfileSetupStep.vue'
import AliasSetupStep from './AliasSetupStep.vue'
import RecoveryKeyStep from './RecoveryKeyStep.vue'
import PasskeyStep from './PasskeyStep.vue'
import { validateKey, type StepValidateFn } from './types'

type StepId = 'profile' | 'alias' | 'recovery-key' | 'passkey'

interface StepDef {
  id: StepId
  component: any
  hideFooter?: boolean
}

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const authService = useAuthService()

const currentIndex = ref(0)
const completing = ref(false)
const stepValidateFn = ref<StepValidateFn | null>(null)

provide(validateKey, {
  register: (fn: StepValidateFn) => {
    stepValidateFn.value = fn
  },
})

const isAdmin = computed(() =>
  authService.hasPermission(PermissionId.INTEGRATIONS_WRITE_SYSTEM),
)

const steps = computed<StepDef[]>(() => {
  const s: StepDef[] = [
    { id: 'profile', component: ProfileSetupStep },
    { id: 'alias', component: AliasSetupStep },
    { id: 'recovery-key', component: RecoveryKeyStep, hideFooter: true },
    { id: 'passkey', component: PasskeyStep, hideFooter: true },
  ]
  return s
})

const currentStep = computed(() => steps.value[currentIndex.value])
const isFirst = computed(() => currentIndex.value === 0)
const isLast = computed(() => currentIndex.value === steps.value.length - 1)
const progress = computed(() =>
  steps.value.map((_, i) => i <= currentIndex.value),
)

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
  }
}

function back() {
  if (!isFirst.value) {
    currentIndex.value--
    stepValidateFn.value = null
  }
}

function handleRecoveryConfirm() {
  advance()
}

function handlePasskeyComplete() {
  advance()
}

function handlePasskeySkip() {
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
      class="sm:max-w-lg md:max-w-xl max-h-[90dvh] gap-0 p-0 flex flex-col"
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
          @confirm="handleRecoveryConfirm"
          @complete="handlePasskeyComplete"
          @skip="handlePasskeySkip"
        />
      </div>

      <!-- Footer navigation (hidden for steps with own controls) -->
      <div
        v-if="!currentStep.hideFooter"
        class="flex items-center justify-between px-6 pb-6 pt-2"
      >
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
          :disabled="completing"
        >
          <Spinner v-if="completing" class="h-4 w-4 mr-2" />
          <template v-else>
            <template v-if="isLast">
              <Check class="h-4 w-4 mr-2" />
              {{ t('onboarding.finish') }}
            </template>
            <template v-else>
              {{ t('general.continue') }}
              <ArrowRight class="h-4 w-4 ml-2" />
            </template>
          </template>
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
