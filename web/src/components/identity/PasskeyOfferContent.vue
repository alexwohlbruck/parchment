<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { useAuthService } from '@/services/auth.service'
import type { Passkey } from '@/types/auth.types'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { useBusyOperation } from '@/composables/useDialogCompletion'
import { Fingerprint } from 'lucide-vue-next'

const props = defineProps<{
  hideSkip?: boolean
}>()

const emit = defineEmits<{
  complete: []
  skip: []
}>()

const { t } = useI18n()
const identityStore = useIdentityStore()
const authService = useAuthService()

const passkeyBusy = ref(false)
const error = ref<string | null>(null)
const existingPasskeys = ref<Passkey[]>([])

const runPasskeyBusy = useBusyOperation(passkeyBusy, error)

const promotionCandidate = computed(() => {
  return existingPasskeys.value.find(
    p => !identityStore.passkeySlotCredentialIds.has(p.id),
  )
})

async function refreshExistingPasskeyList() {
  try {
    const [list] = await Promise.all([
      authService.getPasskeys(),
      identityStore.refreshSlotAvailability(),
    ])
    existingPasskeys.value = list ?? []
  } catch {
    existingPasskeys.value = []
  }
}

async function handleUseExistingPasskey() {
  const candidate = promotionCandidate.value
  if (!candidate) return

  await runPasskeyBusy(async () => {
    const result = await identityStore.enrollExistingPasskey(candidate.id)
    if (result.cancelled) return
    if (result.success && result.slotCreated) {
      emit('complete')
    } else {
      error.value =
        result.error ??
        t('settings.identity.recoveryKey.passkeyOffer.cannotUseError')
    }
  })
}

async function handleAddRecoveryPasskey() {
  await runPasskeyBusy(async () => {
    const result = await identityStore.enrollPasskey('', {
      onSecondTapNeeded: () => {
        error.value = null
        passkeyBusy.value = true
      },
    })
    if (result.cancelled) return
    if (result.success && result.slotCreated) {
      emit('complete')
    } else {
      error.value =
        result.error ??
        t('settings.identity.recoveryKey.passkeyOffer.enableFailedError')
    }
  })
}

onMounted(() => {
  refreshExistingPasskeyList()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <Alert>
      <Fingerprint class="h-4 w-4" />
      <AlertDescription>
        {{ t('settings.identity.recoveryKey.passkeyOffer.alertDescription') }}
      </AlertDescription>
    </Alert>

    <div
      v-if="promotionCandidate"
      class="rounded-md border p-3 flex flex-col gap-2"
    >
      <div class="text-sm">
        <span class="font-semibold">{{
          t('settings.identity.recoveryKey.passkeyOffer.existingLabel')
        }}</span>
        <span class="ml-1 font-mono">{{ promotionCandidate.name }}</span>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ t('settings.identity.recoveryKey.passkeyOffer.existingHint') }}
      </p>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div class="flex flex-col gap-2">
      <Button
        v-if="promotionCandidate"
        class="w-full"
        :disabled="passkeyBusy"
        @click="handleUseExistingPasskey"
      >
        <Spinner v-if="passkeyBusy" class="h-4 w-4 mr-2" />
        <Fingerprint v-else class="h-4 w-4 mr-2" />
        {{
          t('settings.identity.recoveryKey.passkeyOffer.useExisting', {
            name: promotionCandidate.name,
          })
        }}
      </Button>
      <Button
        :variant="promotionCandidate ? 'outline' : 'default'"
        class="w-full"
        :disabled="passkeyBusy"
        @click="handleAddRecoveryPasskey"
      >
        {{
          promotionCandidate
            ? t('settings.identity.recoveryKey.passkeyOffer.addNewInstead')
            : t('settings.identity.recoveryKey.passkeyOffer.addPasskey')
        }}
      </Button>
      <Button
        v-if="!props.hideSkip"
        variant="ghost"
        class="w-full"
        :disabled="passkeyBusy"
        @click="emit('skip')"
      >
        {{ t('settings.identity.recoveryKey.passkeyOffer.skipForNow') }}
      </Button>
    </div>
  </div>
</template>
