<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GlobeIcon, LockIcon } from 'lucide-vue-next'
import { Label } from '@/components/ui/label'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import type { PrivacyScheme } from './types'

defineProps<{
  /** False on a device without the recovery key, which can't encrypt. */
  hasIdentity: boolean
}>()

const scheme = defineModel<PrivacyScheme>({ required: true })

const { t } = useI18n()

const OPTIONS = [
  { value: 'server-key', icon: GlobeIcon },
  { value: 'user-e2ee', icon: LockIcon },
] as const
</script>

<template>
  <div class="space-y-2">
    <Label class="text-xs text-muted-foreground">
      {{ t('library.privacy.label') }}
    </Label>
    <div class="grid grid-cols-2 gap-1.5">
      <button
        v-for="option in OPTIONS"
        :key="option.value"
        type="button"
        :disabled="option.value === 'user-e2ee' && !hasIdentity"
        :class="[
          ITEM_ROW_SURFACES.tile,
          'flex flex-col items-start gap-1 p-3 text-left transition-colors',
          option.value === scheme
            ? 'bg-secondary ring-1 ring-inset ring-primary/50'
            : 'hover:bg-secondary/40',
          option.value === 'user-e2ee' &&
            !hasIdentity &&
            'opacity-50 cursor-not-allowed hover:bg-transparent',
        ]"
        @click="scheme = option.value"
      >
        <component :is="option.icon" class="size-4 text-muted-foreground" />
        <span class="text-sm font-medium">
          {{ t(`library.privacy.schemes.${option.value}.title`) }}
        </span>
        <span class="text-[11px] text-muted-foreground leading-snug">
          {{
            option.value === 'user-e2ee' && !hasIdentity
              ? t('library.privacy.needsIdentity')
              : t(`library.privacy.schemes.${option.value}.description`)
          }}
        </span>
      </button>
    </div>
  </div>
</template>
