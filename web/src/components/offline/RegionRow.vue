<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { ItemIcon } from '@/components/ui/item-icon'
import { ItemRow } from '@/components/ui/item-row'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppService } from '@/services/app.service'
import { useMapService } from '@/services/map/map.service'
import { useOfflineStore } from '@/stores/offline.store'
import { formatBytes } from '@/lib/offline/format'
import type { OfflineRegion } from '@/types/offline.types'

const props = defineProps<{ region: OfflineRegion }>()

const { t, locale } = useI18n()
const offlineStore = useOfflineStore()
const appService = useAppService()
const mapService = useMapService()

const percent = computed(() =>
  props.region.total ? Math.floor(((props.region.saved + props.region.failed) / props.region.total) * 100) : 0,
)
const inProgress = computed(() => props.region.status === 'downloading' || props.region.status === 'paused')

const detail = computed(() => {
  const r = props.region
  switch (r.status) {
    case 'downloading':
      return t('offlineMaps.region.saving', { percent: percent.value })
    case 'paused':
      return t('offlineMaps.region.paused', { percent: percent.value })
    case 'failed':
      return t('offlineMaps.region.failed', r.failed)
    default:
      return t('offlineMaps.region.ready', {
        size: formatBytes(r.bytes, locale.value),
        date: new Date(r.updatedAt).toLocaleDateString(locale.value, { month: 'short', day: 'numeric' }),
      })
  }
})

function show() {
  const [minLng, minLat, maxLng, maxLat] = props.region.bounds
  mapService.fitBounds({ minLng, minLat, maxLng, maxLat })
}

async function rename() {
  const name = await appService.prompt({
    title: t('offlineMaps.rename.title'),
    defaultValue: props.region.name,
    continueText: t('general.save'),
  })
  if (name?.trim()) offlineStore.rename(props.region.id, name.trim())
}

async function remove() {
  const confirmed = await appService.confirm({
    title: t('offlineMaps.delete.title'),
    description: t('offlineMaps.delete.description', { name: props.region.name }),
    continueText: t('general.delete'),
    destructive: true,
  })
  if (confirmed) await offlineStore.remove(props.region.id)
}
</script>

<template>
  <ItemRow :title="region.name" size="md" interactive has-details @click="show">
    <template #icon="{ size }">
      <ItemIcon icon="MapIcon" color="cobalt" :size="size" />
    </template>

    <template #details="{ detailClass }">
      <div class="text-muted-foreground truncate" :class="[detailClass, region.status === 'failed' && 'text-destructive']">
        {{ detail }}
      </div>
      <div v-if="inProgress" class="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-300"
          :class="region.status === 'paused' && 'bg-muted-foreground/50'"
          :style="{ width: `${percent}%` }"
        />
      </div>
    </template>

    <template #trailing>
      <Button
        v-if="region.status === 'downloading'"
        variant="ghost"
        size="icon"
        class="shrink-0"
        :aria-label="t('offlineMaps.actions.pause')"
        @click.stop="offlineStore.pause(region.id)"
      >
        <PauseIcon class="size-4" />
      </Button>
      <Button
        v-else-if="region.status === 'paused' || region.status === 'failed'"
        variant="ghost"
        size="icon"
        class="shrink-0"
        :aria-label="t('offlineMaps.actions.resume')"
        @click.stop="offlineStore.resume(region.id)"
      >
        <PlayIcon v-if="region.status === 'paused'" class="size-4" />
        <RefreshCwIcon v-else class="size-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child @click.stop>
          <Button variant="ghost" size="icon" class="shrink-0">
            <MoreHorizontalIcon class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem :disabled="region.status === 'downloading'" @click="offlineStore.update(region.id)">
            <RefreshCwIcon class="size-4" /> {{ t('offlineMaps.actions.update') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="rename">
            <PencilIcon class="size-4" /> {{ t('offlineMaps.actions.rename') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive" @click="remove">
            <Trash2Icon class="size-4" /> {{ t('general.delete') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
  </ItemRow>
</template>
