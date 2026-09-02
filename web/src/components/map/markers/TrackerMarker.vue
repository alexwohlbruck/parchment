<script setup lang="ts">
/**
 * A tracked thing — a car, a bike — where it last reported from.
 *
 * Wears the app's own accent rather than a category colour: a tracker is
 * something you own, not somewhere you could go. Once its position is old
 * enough to distrust it falls back to the palette's "Other" grey, dims, and
 * stops pulsing.
 */

import { computed } from 'vue'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import MapMarker from './MapMarker.vue'
import { mapEventBus } from '@/lib/eventBus'
import { useI18n } from 'vue-i18n'
import { formatTimeAgo } from '@/lib/time.utils'
import { getVehicleIcon } from '@/lib/travel-mode-icons'
import { MARKER_LIVE_PLATE_SIZE } from '@/lib/map-marker'
import { categoryMarkerPaint } from '@/lib/place-colors'
import { useAccentMarkerPaint } from '@/composables/useAccentMarkerPaint'
import { useThemeStore } from '@/stores/theme.store'

interface Props {
  trackerId: string
  trackerName: string
  trackerType: string
  updatedAt?: Date
  staleness?: 'fresh' | 'aging' | 'stale' | 'very-stale' | 'unknown'
}

const props = withDefaults(defineProps<Props>(), {
  staleness: 'fresh',
})

const { t } = useI18n()
const themeStore = useThemeStore()
const accentPaint = useAccentMarkerPaint()

function handleClick() {
  mapEventBus.emit('click:tracker-marker', { trackerId: props.trackerId })
}

const icon = computed(() => getVehicleIcon(props.trackerType))

const isStale = computed(
  () => props.staleness === 'stale' || props.staleness === 'very-stale',
)

const paint = computed(() =>
  isStale.value
    ? categoryMarkerPaint('default', themeStore.isDark)
    : accentPaint.value,
)

const timeAgo = computed(() =>
  props.updatedAt
    ? formatTimeAgo(props.updatedAt, t, { absoluteAfterDays: Infinity })
    : null,
)
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <MapMarker
          class="cursor-pointer"
          :paint="paint"
          :size="MARKER_LIVE_PLATE_SIZE"
          pulse
          :muted="isStale"
          @click="handleClick"
        >
          <component :is="icon" />
        </MapMarker>
      </TooltipTrigger>
      <TooltipContent side="top" :sideOffset="12">
        <div class="flex flex-col gap-0.5">
          <p class="font-semibold text-sm">{{ trackerName }}</p>
          <p v-if="timeAgo" class="text-xs text-muted-foreground">
            {{ isStale ? t('general.lastSeen') : t('general.updated') }}
            {{ timeAgo }}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
