<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { useClipboard } from '@/composables/useClipboard'
import { Check, Copy, LockKeyhole, ShieldAlert } from 'lucide-vue-next'

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

const { copied, copy } = useClipboard()
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
    <div class="overflow-hidden rounded-2xl border bg-muted/20">
      <div class="flex items-center gap-2 px-5 pt-5 text-sm font-medium">
        <LockKeyhole class="size-4 text-muted-foreground" aria-hidden="true" />
        {{ t('settings.identity.recoveryKey.setup.keyLabel') }}
      </div>
      <div class="px-5 py-5">
        <code class="block select-all break-words text-center font-mono text-base leading-8 sm:text-lg">{{ formattedKey || t('settings.identity.recoveryKey.setup.generating') }}</code>
      </div>
      <div class="border-t bg-background/60 p-3">
        <Button
          variant="outline"
          class="w-full"
          :disabled="!pendingRecoveryKey"
          @click="copy(pendingRecoveryKey!, t('settings.identity.recoveryKey.setup.keyCopiedToast'))"
        >
          <component :is="copied ? Check : Copy" class="mr-2 size-4" />
          {{ copied ? t('settings.identity.recoveryKey.view.copied') : t('settings.identity.recoveryKey.view.copyToClipboard') }}
        </Button>
        <p class="mt-2 text-center text-xs text-muted-foreground">{{ t('settings.identity.recoveryKey.setup.masterPasswordHint') }}</p>
      </div>
    </div>

    <div class="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
      <ShieldAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{{ t('settings.identity.recoveryKey.setup.importantDescription') }}</p>
    </div>

    <label class="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/30" :class="hasSavedKey && 'border-primary/30 bg-primary/5'">
      <Checkbox
        id="saved-key"
        v-model="hasSavedKey"
        class="mt-0.5"
        :disabled="!pendingRecoveryKey"
      />
      <span class="text-sm leading-relaxed">{{ t('settings.identity.recoveryKey.setup.confirmSavedLabel') }}</span>
    </label>

    <Alert v-if="error" variant="destructive" role="alert">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

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
