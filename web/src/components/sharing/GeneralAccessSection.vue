<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { GlobeIcon, LinkIcon, LockIcon } from 'lucide-vue-next'

/** Whether a shareable collection is invite-only or open to anyone with its link. */
const props = defineProps<{
  publicToken: string | null | undefined
  /** The public URL — undefined when no token is set. */
  publicUrl?: string
  /** Disable actions while something is mid-flight. */
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'mint-public-link'): void
  (e: 'revoke-public-link'): void
  (e: 'copy-public-link'): void
}>()

const { t } = useI18n()

const hasPublicLink = computed(() => !!props.publicToken)
</script>

<template>
  <section class="space-y-3">
    <div class="text-sm font-medium text-foreground">
      {{ t('sharing.generalAccess.title') }}
    </div>

    <div
      v-if="!hasPublicLink"
      class="flex items-start gap-3 rounded-md border p-3"
    >
      <LockIcon class="size-4 text-muted-foreground shrink-0 mt-0.5" />
      <div class="flex-1">
        <p class="text-sm font-medium">
          {{ t('sharing.generalAccess.restricted.title') }}
        </p>
        <p class="text-xs text-muted-foreground">
          {{ t('sharing.generalAccess.restricted.description') }}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        :disabled="disabled"
        @click="emit('mint-public-link')"
      >
        {{ t('sharing.generalAccess.restricted.enableAction') }}
      </Button>
    </div>

    <div
      v-else
      class="rounded-md border p-3 overflow-hidden"
    >
      <div class="flex items-start gap-3">
        <GlobeIcon class="size-4 text-primary shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">
            {{ t('sharing.generalAccess.anyoneWithLink.title') }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ t('sharing.generalAccess.anyoneWithLink.description') }}
          </p>
        </div>
      </div>
      <!-- Actions as a balanced button row under the description. The
           URL itself isn't displayed — users interact via Copy, not by
           reading. Hover-tooltip on Copy surfaces it for sanity checks. -->
      <div class="flex gap-2 mt-3">
        <Button
          variant="outline"
          size="sm"
          class="flex-1"
          :disabled="disabled || !publicUrl"
          :title="publicUrl"
          @click="emit('copy-public-link')"
        >
          <LinkIcon class="size-3.5 mr-1.5" />
          {{ t('sharing.generalAccess.anyoneWithLink.copyAction') }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :disabled="disabled"
          @click="emit('revoke-public-link')"
        >
          {{ t('sharing.generalAccess.anyoneWithLink.revokeAction') }}
        </Button>
      </div>
    </div>
  </section>
</template>
