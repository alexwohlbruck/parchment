<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useClipboard } from '@/composables/useClipboard'

const props = defineProps<{ recoveryKey: string | null }>()
const { t } = useI18n()
const { copied, copy } = useClipboard()
const formattedKey = computed(() => props.recoveryKey?.match(/.{1,5}/g)?.join(' ') ?? '')

function copyRecoveryKey() {
  if (!props.recoveryKey) return
  return copy(props.recoveryKey, t('settings.identity.recoveryKey.setup.keyCopiedToast'))
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label class="text-xs text-muted-foreground font-normal">
      {{ t('settings.identity.recoveryKey.view.keyLabel') }}
    </Label>
    <code class="block rounded border bg-muted p-3 text-sm font-mono whitespace-pre-wrap break-words leading-relaxed select-all">
      {{ formattedKey || t('general.loading') }}
    </code>
    <Button
      v-if="recoveryKey"
      variant="outline"
      class="self-start mt-1"
      @click="copyRecoveryKey"
    >
      <component
        :is="copied ? Check : Copy"
        class="h-4 w-4 mr-2"
        :class="copied ? 'text-forest-600' : ''"
      />
      {{ copied ? t('settings.identity.recoveryKey.view.copied') : t('settings.identity.recoveryKey.view.copyToClipboard') }}
    </Button>
  </div>
</template>
