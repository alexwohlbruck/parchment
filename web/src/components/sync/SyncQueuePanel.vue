<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  CircleAlertIcon,
  ClockIcon,
  RotateCwIcon,
  XIcon,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useConnectivity } from '@/composables/useConnectivity'
import { useSyncStore } from '@/stores/sync.store'

/**
 * The offline sync queue, itemized: what's waiting, what's syncing, what
 * failed — with per-item cancel (pending) and retry/dismiss (failed).
 * Rendered inside the sidebar status pill's hover card / bottom sheet.
 */
const { t } = useI18n()
const { isOffline } = useConnectivity()
const syncStore = useSyncStore()
</script>

<template>
  <div class="w-72 max-w-full">
    <div class="px-3 pt-3 pb-2">
      <p class="text-sm font-medium text-foreground">
        {{ t('offline.sync.title') }}
      </p>
      <p v-if="isOffline" class="mt-0.5 text-xs text-muted-foreground">
        {{ t('offline.sync.willSync') }}
      </p>
    </div>

    <ul
      v-if="syncStore.queue.length"
      class="max-h-64 overflow-y-auto px-1 pb-1.5"
    >
      <li
        v-for="item in syncStore.queue"
        :key="item.id"
        class="flex items-center gap-2.5 rounded-md px-2 py-1.5"
      >
        <Spinner
          v-if="item.status === 'syncing'"
          size="icon"
          class="shrink-0 text-muted-foreground"
        />
        <CircleAlertIcon
          v-else-if="item.status === 'failed'"
          class="size-4 shrink-0 text-destructive"
        />
        <ClockIcon v-else class="size-4 shrink-0 text-muted-foreground" />

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-foreground">{{ item.label }}</p>
          <p
            v-if="item.status === 'failed'"
            class="truncate text-xs text-destructive"
          >
            {{ item.error || t('offline.sync.failed') }}
          </p>
        </div>

        <template v-if="item.status === 'failed'">
          <Button
            size="icon-xs"
            variant="ghost"
            :aria-label="t('offline.sync.retryAction')"
            @click="syncStore.retry(item.id)"
          >
            <RotateCwIcon class="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            :aria-label="t('offline.sync.dismiss')"
            @click="syncStore.dismiss(item.id)"
          >
            <XIcon class="size-3.5" />
          </Button>
        </template>
        <Button
          v-else-if="item.status === 'pending'"
          size="icon-xs"
          variant="ghost"
          :aria-label="t('offline.sync.cancel')"
          @click="syncStore.cancel(item.id)"
        >
          <XIcon class="size-3.5" />
        </Button>
      </li>
    </ul>
  </div>
</template>
