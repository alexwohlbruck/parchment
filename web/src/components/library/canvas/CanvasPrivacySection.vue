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
import { CopyIcon, GlobeIcon, LinkIcon, ShieldCheckIcon } from 'lucide-vue-next'
import type { CanvasScheme } from '@/types/canvas.types'

const props = defineProps<{
  scheme: CanvasScheme
  /** False on a device that hasn't imported the recovery key. */
  hasIdentity: boolean
  /** The live share URL, when one has been minted. */
  shareUrl?: string | null
  /** Disable actions while something is mid-flight. */
  disabled?: boolean
}>()

const emit = defineEmits<{
  switch: [target: CanvasScheme]
  share: []
  revokeShare: []
  copyShare: []
}>()

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

    <!-- Link sharing. Only offered on a canvas the server can actually
         render to a visitor. -->
    <template v-if="!isPrivate">
      <div v-if="shareUrl" class="space-y-1.5">
        <div class="flex items-center gap-1.5">
          <code
            class="flex-1 min-w-0 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] font-mono"
          >
            {{ shareUrl }}
          </code>
          <Button
            variant="ghost"
            size="icon"
            class="size-8 shrink-0"
            :title="t('canvases.share.copy')"
            :aria-label="t('canvases.share.copy')"
            :disabled="disabled"
            @click="emit('copyShare')"
          >
            <CopyIcon class="size-3.5" />
          </Button>
        </div>
        <Button
          variant="link"
          size="sm"
          class="px-0 h-auto text-muted-foreground"
          :disabled="disabled"
          @click="emit('revokeShare')"
        >
          {{ t('canvases.share.revoke') }}
        </Button>
      </div>

      <Button
        v-else
        variant="outline"
        size="sm"
        class="w-full"
        :disabled="disabled"
        @click="emit('share')"
      >
        <LinkIcon class="size-3.5" />
        {{ t('canvases.share.create') }}
      </Button>
    </template>
  </section>
</template>
