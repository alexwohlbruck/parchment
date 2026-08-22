<script setup lang="ts">
/**
 * Where a canvas is stored, and how to change it.
 *
 * Modelled on the share dialog's "General access" block, because it is the
 * same decision in a different place: a record the server can read is one it
 * can publish, and a record it cannot read is one only your devices can open.
 * Switching re-packages the whole canvas under the other scheme — a real
 * migration, so it confirms first.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { GlobeIcon, ShieldCheckIcon } from 'lucide-vue-next'
import type { CanvasScheme } from '@/types/canvas.types'

const props = defineProps<{
  scheme: CanvasScheme
  /** False on a device that hasn't imported the recovery key. */
  hasIdentity: boolean
  /** Disable actions while something is mid-flight. */
  disabled?: boolean
}>()

const emit = defineEmits<{ switch: [target: CanvasScheme] }>()

const { t } = useI18n()

const isPrivate = computed(() => props.scheme === 'user-e2ee')
const target = computed<CanvasScheme>(() =>
  isPrivate.value ? 'server-key' : 'user-e2ee',
)

/** Going private needs a key to encrypt with; coming back never does. */
const blocked = computed(() => target.value === 'user-e2ee' && !props.hasIdentity)
</script>

<template>
  <section class="space-y-2">
    <p class="text-xs text-muted-foreground">{{ t('canvases.dialog.privacy') }}</p>

    <Alert :variant="isPrivate ? 'info' : 'default'">
      <ShieldCheckIcon v-if="isPrivate" class="size-4" />
      <GlobeIcon v-else class="size-4" />
      <AlertDescription class="text-xs">
        <p class="font-medium">
          {{ t(`canvases.schemes.${scheme}.title`) }}
        </p>
        <p class="text-muted-foreground">
          {{ t(`canvases.schemes.${scheme}.description`) }}
        </p>

        <p v-if="blocked" class="text-muted-foreground mt-1">
          {{ t('canvases.privacy.needsIdentity') }}
        </p>
        <Button
          v-else
          variant="link"
          size="sm"
          class="px-0 mt-1 h-auto"
          :disabled="disabled"
          @click="emit('switch', target)"
        >
          {{ t(`canvases.privacy.switchTo.${target}`) }}
        </Button>
      </AlertDescription>
    </Alert>
  </section>
</template>
