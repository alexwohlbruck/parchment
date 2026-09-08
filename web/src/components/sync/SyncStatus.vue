<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlertIcon, WifiOffIcon } from 'lucide-vue-next'
import ResponsiveHoverCard from '@/components/responsive/ResponsiveHoverCard.vue'
import { Spinner } from '@/components/ui/spinner'
import SyncQueuePanel from '@/components/sync/SyncQueuePanel.vue'
import { useConnectivity } from '@/composables/useConnectivity'
import { useSyncStore } from '@/stores/sync.store'

/**
 * Quiet connectivity/sync pill for the sidebar (Linear-style): invisible
 * while everything is normal, a small "Offline · n" chip while changes are
 * queued, with the itemized queue in a hover card. Clicking while offline
 * nudges a reconnect probe.
 *
 * `collapsed` renders the icon-with-dot rail treatment instead of the pill.
 */
const props = withDefaults(defineProps<{ collapsed?: boolean }>(), {
  collapsed: false,
})

const { t } = useI18n()
const { isOffline, status, checkNow } = useConnectivity()
const syncStore = useSyncStore()

const visible = computed(() => isOffline.value || syncStore.hasWork)
const hasFailures = computed(() => syncStore.failedMutations.length > 0)
const pendingCount = computed(() => syncStore.pendingMutations.length)

const label = computed(() => {
  if (status.value === 'offline') return t('offline.badge')
  if (status.value === 'reconnecting') return t('offline.reconnecting')
  if (syncStore.isFlushing) return t('offline.sync.syncing')
  if (hasFailures.value) return t('offline.sync.failed')
  return t('offline.sync.title')
})

const countSuffix = computed(() =>
  pendingCount.value > 0 ? String(pendingCount.value) : '',
)
</script>

<template>
  <ResponsiveHoverCard
    v-if="visible"
    side="right"
    :side-offset="10"
    align="start"
    :open-delay="200"
    desktop-content-class="p-0 w-fit overflow-hidden rounded-md"
  >
    <template #trigger>
      <button
        v-if="collapsed"
        type="button"
        class="flex h-10 w-full cursor-pointer items-center rounded-md px-2 text-foreground transition-colors hover:bg-foreground/5"
        :aria-label="label"
        @click="isOffline && checkNow()"
      >
        <span class="relative inline-flex">
          <Spinner
            v-if="syncStore.isFlushing"
            size="icon"
            class="size-5 text-muted-foreground"
          />
          <CircleAlertIcon
            v-else-if="hasFailures && !isOffline"
            class="size-5 text-destructive"
          />
          <WifiOffIcon v-else class="size-5 text-muted-foreground" />
          <span
            v-if="pendingCount > 0 || hasFailures"
            class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-muted"
            :class="hasFailures ? 'bg-destructive' : 'bg-primary'"
            aria-hidden
          />
        </span>
      </button>

      <button
        v-else
        type="button"
        class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 text-left transition-colors hover:bg-muted/70"
        @click="isOffline && checkNow()"
      >
        <Spinner
          v-if="syncStore.isFlushing"
          size="icon"
          class="shrink-0 text-muted-foreground"
        />
        <CircleAlertIcon
          v-else-if="hasFailures && !isOffline"
          class="size-4 shrink-0 text-destructive"
        />
        <WifiOffIcon v-else class="size-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-sm text-foreground">
          {{ label }}
        </span>
        <span
          v-if="countSuffix"
          class="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {{ countSuffix }}
        </span>
      </button>
    </template>
    <template #content>
      <SyncQueuePanel />
    </template>
  </ResponsiveHoverCard>
</template>
