<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Fingerprint, Mail } from 'lucide-vue-next'
import {
  assertPasskeyForReset,
  beginResetStepUp,
  type ResetProof,
  type ResetStepUp,
} from '@/services/identity.service'
import { useIdentityStore } from '@/stores/identity.store'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  PinInput,
  PinInputGroup,
  PinInputInput,
  PinInputSeparator,
} from '@/components/ui/pin-input'
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const emit = defineEmits<{ reset: [] }>()

const { t } = useI18n()
const identityStore = useIdentityStore()

const stepUp = shallowRef<ResetStepUp | null>(null)
const code = ref<string[]>([])
const busy = ref(false)
const error = ref<string | null>(null)

const codeComplete = computed(() => /^\d{8}$/.test(code.value.join('')))

async function start(method?: 'email') {
  busy.value = true
  try {
    stepUp.value = await beginResetStepUp(method)
    code.value = []
  } catch {
    error.value = t('settings.identity.recoveryKey.reset.failedFallback')
  } finally {
    busy.value = false
  }
}

async function finish(proof: ResetProof) {
  const result = await identityStore.resetIdentity(proof)
  if (result.success) {
    emit('reset')
    return
  }
  error.value = result.error ?? t('settings.identity.recoveryKey.reset.verifyFailed')
  if (stepUp.value?.method === 'passkey') void start()
}

async function usePasskey() {
  if (stepUp.value?.method !== 'passkey') return
  busy.value = true
  error.value = null
  try {
    await finish({ passkey: await assertPasskeyForReset(stepUp.value.options) })
  } catch {
    error.value = t('settings.identity.recoveryKey.reset.verifyFailed')
    void start()
  } finally {
    busy.value = false
  }
}

async function submitCode() {
  if (!codeComplete.value) return
  busy.value = true
  error.value = null
  try {
    await finish({ code: code.value.join('') })
  } finally {
    busy.value = false
  }
}

onMounted(() => start())
</script>

<template>
  <div class="flex flex-col gap-5">
    <DialogHeader class="items-center sm:text-center">
      <div class="flex size-11 items-center justify-center rounded-full bg-muted">
        <Mail v-if="stepUp?.method === 'email'" class="size-5 text-muted-foreground" />
        <Fingerprint v-else class="size-5 text-muted-foreground" />
      </div>
      <DialogTitle>{{ t('settings.identity.recoveryKey.reset.verifyTitle') }}</DialogTitle>
      <DialogDescription>
        {{
          stepUp?.method === 'email'
            ? t('settings.identity.recoveryKey.reset.verifyEmailDescription')
            : t('settings.identity.recoveryKey.reset.verifyPasskeyDescription')
        }}
      </DialogDescription>
    </DialogHeader>

    <div v-if="!stepUp" class="flex justify-center py-2">
      <Spinner class="size-5" />
    </div>

    <template v-else-if="stepUp.method === 'passkey'">
      <Button variant="destructive" class="w-full" :disabled="busy" @click="usePasskey">
        <Spinner v-if="busy" class="size-4 mr-2" />
        {{ t('settings.identity.recoveryKey.reset.usePasskey') }}
      </Button>
      <button
        type="button"
        class="text-sm text-muted-foreground hover:text-foreground"
        :disabled="busy"
        @click="start('email')"
      >
        {{ t('settings.identity.recoveryKey.reset.emailInstead') }}
      </button>
    </template>

    <form v-else class="flex flex-col gap-5" @submit.prevent="submitCode">
      <PinInput
        v-model="code"
        otp
        mode="eager"
        placeholder="○"
        class="flex justify-center"
        @complete="submitCode"
      >
        <PinInputGroup>
          <template v-for="(id, index) in 8" :key="id">
            <PinInputInput
              :index="index"
              inputmode="numeric"
              pattern="[0-9]*"
              class="h-10 w-9 text-sm font-semibold"
            />
            <PinInputSeparator v-if="index === 3" class="text-muted-foreground" />
          </template>
        </PinInputGroup>
      </PinInput>
      <Button
        type="submit"
        variant="destructive"
        class="w-full"
        :disabled="busy || !codeComplete"
      >
        <Spinner v-if="busy" class="size-4 mr-2" />
        {{ t('settings.identity.recoveryKey.reset.eraseAction') }}
      </Button>
    </form>

    <p v-if="error" class="text-sm text-destructive text-center">{{ error }}</p>
  </div>
</template>
