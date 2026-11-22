<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  CalendarClockIcon,
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
import { dayAsDate } from '@/lib/offline/expiry'
import KeepUntilPicker from '@/components/offline/KeepUntilPicker.vue'
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
    default: {
      const day = (date: Date) => date.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
      const size = formatBytes(r.bytes, locale.value)
      if (r.keepUntil) return t('offlineMaps.region.keepUntil', { size, date: day(dayAsDate(r.keepUntil)) })
      return r.timetableUntil
        ? t('offlineMaps.region.readyTransit', { size, date: day(dayAsDate(r.timetableUntil)) })
        : t('offlineMaps.region.ready', { size, date: day(new Date(r.updatedAt)) })
    }
  }
})

const keepOpen = ref(false)
let openKeepOnClose = false
const armKeep = () => (openKeepOnClose = true)

function keepAfterMenu(event: Event) {
  if (!openKeepOnClose) return
  openKeepOnClose = false
  event.preventDefault()
  keepOpen.value = true
}

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

      <KeepUntilPicker
        v-model:open="keepOpen"
        :model-value="region.keepUntil ?? null"
        @update:model-value="offlineStore.setKeepUntil(region.id, $event)"
      >
        <div class="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger as-child @click.stop>
              <Button variant="ghost" size="icon" class="shrink-0">
                <MoreHorizontalIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" @close-auto-focus="keepAfterMenu">
              <DropdownMenuItem :disabled="region.status === 'downloading'" @click="offlineStore.update(region.id)">
                <RefreshCwIcon class="size-4" /> {{ t('offlineMaps.actions.update') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="armKeep">
                <CalendarClockIcon class="size-4" /> {{ t('offlineMaps.actions.keep') }}
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
        </div>
      </KeepUntilPicker>
    </template>
  </ItemRow>
</template>
