<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Check, Copy } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useClipboard } from '@/composables/useClipboard'
import RecoveryWordGrid from './RecoveryWordGrid.vue'

const props = defineProps<{ recoveryWords: string[] | null }>()
const { t } = useI18n()
const { copied, copy } = useClipboard()

function copyRecoveryWords() {
  if (!props.recoveryWords) return
  return copy(props.recoveryWords.join(' '), t('settings.identity.recoveryKey.setup.keyCopiedToast'))
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label class="text-xs text-muted-foreground font-normal">
      {{ t('settings.identity.recoveryKey.view.keyLabel') }}
    </Label>
    <div class="rounded border bg-muted p-3">
      <RecoveryWordGrid v-if="recoveryWords" :words="recoveryWords" />
      <span v-else class="text-sm text-muted-foreground">{{ t('general.loading') }}</span>
    </div>
    <Button
      v-if="recoveryWords"
      variant="outline"
      class="self-start mt-1"
      @click="copyRecoveryWords"
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
