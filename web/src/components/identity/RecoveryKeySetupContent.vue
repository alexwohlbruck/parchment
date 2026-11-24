<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { useClipboard } from '@/composables/useClipboard'
import { Check, Copy, ShieldAlert } from 'lucide-vue-next'
import RecoveryWordGrid from './RecoveryWordGrid.vue'
import RecoveryWordCheck from './RecoveryWordCheck.vue'

const props = defineProps<{
  hideFooter?: boolean
}>()

const emit = defineEmits<{
  confirm: []
}>()

const { t } = useI18n()
const identityStore = useIdentityStore()
const { pendingRecoveryWords, isLoading } = storeToRefs(identityStore)

const { copied, copy } = useClipboard()
const checking = ref(false)
const hasSavedKey = ref(false)
const error = ref<string | null>(null)

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

function showWords() {
  checking.value = false
  hasSavedKey.value = false
}

function reset() {
  showWords()
  error.value = null
}

defineExpose({ reset, hasSavedKey, handleConfirm })
</script>

<template>
  <div class="flex flex-col gap-4">
    <template v-if="!checking">
      <button
        type="button"
        class="group rounded-2xl border border-dashed bg-muted/30 px-4 pb-3 pt-4 transition-colors hover:bg-muted/50 disabled:pointer-events-none"
        :disabled="!pendingRecoveryWords"
        :aria-label="t('settings.identity.recoveryKey.view.copyToClipboard')"
        @click="copy(pendingRecoveryWords!.join(' '), t('settings.identity.recoveryKey.setup.keyCopiedToast'))"
      >
        <RecoveryWordGrid v-if="pendingRecoveryWords" :words="pendingRecoveryWords" />
        <span v-else class="block text-center text-sm text-muted-foreground">{{ t('settings.identity.recoveryKey.setup.generating') }}</span>
        <span class="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
          <component :is="copied ? Check : Copy" class="size-3.5" aria-hidden="true" />
          {{ copied ? t('settings.identity.recoveryKey.view.copied') : t('settings.identity.recoveryKey.view.copyToClipboard') }}
          <span aria-hidden="true">·</span>
          {{ t('settings.identity.recoveryKey.setup.masterPasswordHint') }}
        </span>
      </button>

      <p class="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldAlert class="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {{ t('settings.identity.recoveryKey.setup.importantDescription') }}
      </p>

      <Button :disabled="!pendingRecoveryWords" @click="checking = true">
        {{ t('settings.identity.recoveryKey.check.start') }}
      </Button>
    </template>

    <template v-else-if="pendingRecoveryWords">
      <RecoveryWordCheck v-model:passed="hasSavedKey" :words="pendingRecoveryWords" />

      <button type="button" class="self-start text-sm text-muted-foreground hover:text-foreground" @click="showWords">
        {{ t('settings.identity.recoveryKey.check.showAgain') }}
      </button>

      <Alert v-if="error" variant="destructive" role="alert">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <Button
        v-if="!props.hideFooter"
        :disabled="!hasSavedKey || isLoading"
        @click="handleConfirm"
      >
        <Spinner v-if="isLoading" class="h-4 w-4 mr-2" />
        {{ t('general.continue') }}
      </Button>
    </template>
  </div>
</template>
