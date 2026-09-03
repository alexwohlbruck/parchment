<script setup lang="ts">
/**
 * A friend, where they last reported from.
 *
 * The same marker a tracker wears — same plate, same ring, same pulse, from
 * `lib/map-marker` — with a face on the plate instead of a glyph. Goes grey and
 * still once the position is old enough to distrust.
 */

import { computed } from 'vue'
import { BatteryIcon, BatteryChargingIcon } from 'lucide-vue-next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { MARKER_LIVE_PLATE_SIZE } from '@/lib/map-marker'
import { categoryMarkerPaint } from '@/lib/place-colors'
import { useAccentMarkerPaint } from '@/composables/useAccentMarkerPaint'
import { useThemeStore } from '@/stores/theme.store'

interface Props {
  friendHandle: string
  friendAlias: string
  friendName?: string
  friendAvatar?: string
  updatedAt: Date
  accuracy?: number
  /** Battery level 0-1, omitted when unavailable on the sender's device. */
  battery?: number
  batteryCharging?: boolean
}

const props = defineProps<Props>()

const { t } = useI18n()
const themeStore = useThemeStore()
const accentPaint = useAccentMarkerPaint()

function handleClick() {
  mapEventBus.emit('click:friend-marker', { friendHandle: props.friendHandle })
}

const displayName = computed(() => props.friendName || props.friendAlias)

const initials = computed(() => {
  const words = displayName.value.split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return displayName.value.slice(0, 2).toUpperCase()
})

const timeAgo = computed(() => formatTimeAgo(props.updatedAt, t))

// A location is worth trusting for about as long as it takes to walk out of
// its own accuracy radius; five minutes is where the friends UI draws it.
const isStale = computed(
  () => Date.now() - props.updatedAt.getTime() > 5 * 60 * 1000,
)

const paint = computed(() =>
  isStale.value
    ? categoryMarkerPaint('default', themeStore.isDark)
    : accentPaint.value,
)

const batteryPercent = computed(() =>
  props.battery == null ? null : Math.round(props.battery * 100),
)

// Visual cue when the battery is low and not charging — the only signal worth
// changing colour for in a tiny tooltip.
const batteryLow = computed(
  () =>
    batteryPercent.value != null &&
    batteryPercent.value <= 20 &&
    !props.batteryCharging,
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
          fill
          @click="handleClick"
        >
          <Avatar class="size-full rounded-none">
            <AvatarImage v-if="friendAvatar" :src="friendAvatar" :alt="displayName" />
            <AvatarFallback
              class="text-[11px] font-semibold rounded-none"
              :style="{ backgroundColor: paint.plate ?? undefined, color: paint.ink }"
            >
              {{ initials }}
            </AvatarFallback>
          </Avatar>

          <!-- Sits on the plate's edge rather than outside it, so the dot reads
               as part of the marker and not as a second mark beside it. -->
          <template #badge>
            <div
              v-if="!isStale"
              class="absolute bottom-0 right-0 size-2.5 rounded-full bg-forest-500"
              :style="{ boxShadow: `0 0 0 1.5px ${paint.ring}` }"
            />
          </template>
        </MapMarker>
      </TooltipTrigger>
      <TooltipContent side="top" :sideOffset="12">
        <div class="flex flex-col gap-0.5">
          <p class="font-semibold text-sm">{{ displayName }}</p>
          <p class="text-xs text-muted-foreground">
            {{ isStale ? t('general.lastSeen') : t('general.updated') }} {{ timeAgo }}
          </p>
          <p v-if="accuracy && accuracy > 30" class="text-xs text-muted-foreground">
            {{ t('friends.map.accuracy', { meters: Math.round(accuracy) }) }}
          </p>
          <p
            v-if="batteryPercent != null"
            class="text-xs flex items-center gap-1"
            :class="batteryLow ? 'text-compass-500' : 'text-muted-foreground'"
          >
            <component
              :is="batteryCharging ? BatteryChargingIcon : BatteryIcon"
              class="size-3"
            />
            {{ batteryPercent }}%
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
