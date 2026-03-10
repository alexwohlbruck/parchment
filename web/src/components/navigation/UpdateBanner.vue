<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { MegaphoneIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import type { Update } from '@tauri-apps/plugin-updater'

const { t } = useI18n()

withDefaults(
  defineProps<{
    updateAvailable: Update | null
    forceShowUpdateBanner: boolean
    installInProgress: boolean
    /** When true, render only inner content (for hover card). When false, add card border/radius/shadow (expanded nav). */
    embedded?: boolean
  }>(),
  { embedded: false },
)

const emit = defineEmits<{
  restart: []
  dismiss: []
}>()

const versionDisplay = (updateAvailable: Update | null, forceShow: boolean) =>
  updateAvailable?.version ?? (forceShow ? '0.0.0' : '')
</script>

<template>
  <div
    :class="[
      'flex flex-col gap-3',
      embedded
        ? 'bg-gradient-to-br from-primary/5 via-primary/[0.07] to-primary/10 p-3'
        : 'mx-1 mt-2 mb-1 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-primary/[0.07] to-primary/10 px-3 py-3 shadow-sm',
    ]"
    :data-tauri-drag-region="!embedded"
  >
    <div class="flex items-center gap-3">
      <div
        class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
        aria-hidden
      >
        <MegaphoneIcon class="size-4" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-foreground">
          {{ t('profileMenu.updateBanner') }}
        </p>
        <p
          v-if="updateAvailable?.version || forceShowUpdateBanner"
          class="mt-0.5 text-xs text-muted-foreground"
        >
          {{ t('profileMenu.versionAvailable') }}
          {{ versionDisplay(updateAvailable, forceShowUpdateBanner) }}
        </p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <Button
        size="sm"
        variant="default"
        :disabled="installInProgress"
        @click="emit('restart')"
      >
        {{
          installInProgress
            ? t('profileMenu.updateInstalling')
            : t('profileMenu.restartToUpdate')
        }}
      </Button>
      <Button
        size="sm"
        variant="outline"
        :disabled="installInProgress"
        @click="emit('dismiss')"
      >
        {{ t('profileMenu.later') }}
      </Button>
    </div>
  </div>
</template>
