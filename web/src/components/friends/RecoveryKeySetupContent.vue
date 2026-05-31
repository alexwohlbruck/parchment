<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Code } from '@/components/ui/code'
import CopyButton from '@/components/CopyButton.vue'
import { Key, AlertTriangle } from 'lucide-vue-next'

const props = defineProps<{
  hideFooter?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()
const identityStore = useIdentityStore()
const { pendingRecoveryKey, isLoading } = storeToRefs(identityStore)

const hasSavedKey = ref(false)
const error = ref<string | null>(null)

const formattedKey = computed(() => {
  const k = pendingRecoveryKey.value
  if (!k) return ''
  return k.match(/.{1,5}/g)?.join(' ') ?? k
})

async function handleConfirm(): Promise<boolean> {
  if (!hasSavedKey.value) return false

  error.value = null
  const result = await identityStore.completeSetup()

  if (result.success) {
    emit('confirm')
    return true
  } else {
    error.value = result.error || t('settings.identity.recoveryKey.setup.failedFallback')
    return false
  }
}

function reset() {
  hasSavedKey.value = false
  error.value = null
}

defineExpose({ reset, hasSavedKey, handleConfirm })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-4">
      <Alert variant="warning">
        <AlertTriangle class="h-4 w-4" />
        <AlertTitle>{{ t('settings.identity.recoveryKey.setup.importantTitle') }}</AlertTitle>
        <AlertDescription>
          {{ t('settings.identity.recoveryKey.setup.importantDescription') }}
        </AlertDescription>
      </Alert>

      <div class="flex flex-col gap-2">
        <Label>{{ t('settings.identity.recoveryKey.setup.keyLabel') }}</Label>
        <Code
          class="p-3 text-sm font-mono whitespace-pre-wrap break-words leading-relaxed select-all"
        >
          {{ formattedKey || t('settings.identity.recoveryKey.setup.generating') }}
        </Code>
        <div v-if="pendingRecoveryKey" class="flex gap-2">
          <CopyButton
            :text="pendingRecoveryKey"
            variant="outline"
            :message="t('settings.identity.recoveryKey.setup.keyCopiedToast')"
          />
          <span class="text-xs text-muted-foreground self-center">
            {{ t('settings.identity.recoveryKey.setup.masterPasswordHint') }}
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Checkbox
          id="saved-key"
          v-model="hasSavedKey"
          :disabled="!pendingRecoveryKey"
        />
        <Label for="saved-key" class="text-sm cursor-pointer">
          {{ t('settings.identity.recoveryKey.setup.confirmSavedLabel') }}
        </Label>
      </div>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </div>

    <div v-if="!props.hideFooter" class="flex justify-end gap-2">
      <Button variant="outline" @click="emit('cancel')">
        {{ t('general.cancel') }}
      </Button>
      <Button
        :disabled="!hasSavedKey || isLoading"
        @click="handleConfirm"
      >
        <Spinner v-if="isLoading" class="h-4 w-4 mr-2" />
        {{ t('general.continue') }}
      </Button>
    </div>
  </div>
</template>
