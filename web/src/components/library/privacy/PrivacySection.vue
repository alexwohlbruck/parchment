<script setup lang="ts">
/**
 * A record's current privacy and the way to change it. Switching re-packages
 * the whole record, so the caller confirms before acting on `switch`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GlobeIcon, LockIcon } from 'lucide-vue-next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { PrivacyScheme } from './types'

const props = defineProps<{
  scheme: PrivacyScheme
  /** False on a device without the recovery key, which can't encrypt. */
  hasIdentity: boolean
  disabled?: boolean
  /** Only the owner can move a record between schemes. */
  readonly?: boolean
}>()

const emit = defineEmits<{ switch: [target: PrivacyScheme] }>()

const { t } = useI18n()

const isPrivate = computed(() => props.scheme === 'user-e2ee')
const target = computed<PrivacyScheme>(() =>
  isPrivate.value ? 'server-key' : 'user-e2ee',
)
const blocked = computed(() => target.value === 'user-e2ee' && !props.hasIdentity)
</script>

<template>
  <section class="space-y-2">
    <p class="block text-sm tracking-tight font-medium text-foreground">{{ t('library.privacy.label') }}</p>

    <Alert :variant="isPrivate ? 'info' : 'default'">
      <LockIcon v-if="isPrivate" class="size-4" />
      <GlobeIcon v-else class="size-4" />
      <AlertDescription class="text-xs">
        <p class="font-medium">
          {{ t(`library.privacy.schemes.${scheme}.title`) }}
        </p>
        <p class="text-muted-foreground">
          {{ t(`library.privacy.schemes.${scheme}.description`) }}
        </p>

        <template v-if="readonly" />
        <p v-else-if="blocked" class="text-muted-foreground mt-1">
          {{ t('library.privacy.needsIdentity') }}
        </p>
        <Button
          v-else
          type="button"
          variant="link"
          size="sm"
          class="px-0 mt-1 h-auto"
          :disabled="disabled"
          @click="emit('switch', target)"
        >
          {{ t(`library.privacy.switchTo.${target}`) }}
        </Button>
      </AlertDescription>
    </Alert>

    <slot />
  </section>
</template>
