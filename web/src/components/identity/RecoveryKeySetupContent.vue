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
import { Check, Copy, ShieldAlert } from 'lucide-vue-next'

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

const keyGroups = computed(() => pendingRecoveryKey.value?.match(/.{1,5}/g) ?? [])

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
    <button
      type="button"
      class="group rounded-2xl border border-dashed bg-muted/30 px-4 pb-3 pt-5 transition-colors hover:bg-muted/50 disabled:pointer-events-none"
      :disabled="!pendingRecoveryKey"
      :aria-label="t('settings.identity.recoveryKey.view.copyToClipboard')"
      @click="copy(pendingRecoveryKey!, t('settings.identity.recoveryKey.setup.keyCopiedToast'))"
    >
      <div class="@container">
        <code v-if="keyGroups.length" class="recovery-key flex select-all justify-center whitespace-nowrap font-mono font-medium">
          <span v-for="(group, i) in keyGroups" :key="i" class="px-[0.22ch]">{{ group }}</span>
        </code>
        <span v-else class="block text-center text-sm text-muted-foreground">{{ t('settings.identity.recoveryKey.setup.generating') }}</span>
      </div>
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

    <label class="flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted/30" :class="hasSavedKey && 'border-primary/30 bg-primary/5'">
      <Checkbox
        id="saved-key"
        v-model="hasSavedKey"
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

<style scoped>
.recovery-key { font-size: clamp(10px, calc(100cqw / 30), 17px); }
</style>
