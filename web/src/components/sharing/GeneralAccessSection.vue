<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { GlobeIcon, LockIcon, ShieldCheckIcon } from 'lucide-vue-next'
import type { CollectionScheme } from '@/types/library.types'

/**
 * The "General access" block in the share dialog. Behaviour depends on
 * the collection's encryption scheme:
 *
 *   - server-key:
 *     - Toggle between `restricted` (only invited friends) and
 *       `anyone-with-link` (public-link shareable). The link itself is
 *       rendered alongside with copy/revoke affordances.
 *
 *   - user-e2ee:
 *     - Public links are disallowed. Show a one-line explainer with a
 *       `Switch to server-stored` button that hands off to the
 *       scheme-switch flow.
 */
const props = defineProps<{
  scheme: CollectionScheme
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
  (e: 'request-scheme-switch'): void
}>()

const { t } = useI18n()

const hasPublicLink = computed(() => !!props.publicToken)
</script>

<template>
  <section class="space-y-3">
    <div class="text-sm font-medium text-foreground">
      {{ t('sharing.generalAccess.title') }}
    </div>

    <!-- User-e2ee: link sharing disallowed -->
    <Alert v-if="scheme === 'user-e2ee'" variant="info">
      <ShieldCheckIcon class="size-4" />
      <AlertDescription class="text-xs">
        <p class="font-medium">
          {{ t('sharing.generalAccess.e2ee.title') }}
        </p>
        <p class="text-muted-foreground">
          {{ t('sharing.generalAccess.e2ee.description') }}
        </p>
        <Button
          variant="link"
          size="sm"
          class="px-0 mt-1 h-auto"
          :disabled="disabled"
          @click="emit('request-scheme-switch')"
        >
          {{ t('sharing.generalAccess.e2ee.switchAction') }}
        </Button>
      </AlertDescription>
    </Alert>

    <!-- Server-key: two states (restricted / anyone-with-link) -->
    <template v-else>
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
        class="flex items-start gap-3 rounded-md border p-3"
      >
        <GlobeIcon class="size-4 text-primary shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">
            {{ t('sharing.generalAccess.anyoneWithLink.title') }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ t('sharing.generalAccess.anyoneWithLink.description') }}
          </p>
          <p
            v-if="publicUrl"
            class="text-xs font-mono text-muted-foreground truncate mt-1"
            :title="publicUrl"
          >
            {{ publicUrl }}
          </p>
        </div>
        <div class="flex flex-col gap-1.5">
          <Button
            variant="outline"
            size="sm"
            :disabled="disabled || !publicUrl"
            @click="emit('copy-public-link')"
          >
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

      <!-- Upgrade affordance: server-key → user-e2ee. Placed below the
           public-link block so the "make it more private" hint is visible
           but not competing with the main share configuration. -->
      <Button
        variant="link"
        size="sm"
        class="px-0 h-auto text-xs"
        :disabled="disabled"
        @click="emit('request-scheme-switch')"
      >
        {{ t('sharing.generalAccess.serverKey.switchAction') }}
      </Button>
    </template>
  </section>
</template>
