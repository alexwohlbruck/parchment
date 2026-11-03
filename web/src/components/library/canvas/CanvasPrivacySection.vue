<script setup lang="ts">
/** A canvas's privacy, plus the public link a shareable canvas can have. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { CopyIcon, LinkIcon } from 'lucide-vue-next'
import PrivacySection from '@/components/library/privacy/PrivacySection.vue'
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
</script>

<template>
  <PrivacySection
    :scheme="scheme"
    :has-identity="hasIdentity"
    :disabled="disabled"
    @switch="emit('switch', $event)"
  >
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
  </PrivacySection>
</template>
