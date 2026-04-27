<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ItemIcon } from '@/components/ui/item-icon'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import type { LocationHistoryStop } from '@server/types/location-history.types'

dayjs.extend(duration)
dayjs.extend(localizedFormat)

const props = defineProps<{
  stop: LocationHistoryStop
}>()

const emit = defineEmits<{
  (e: 'select', stop: LocationHistoryStop): void
}>()

const { t } = useI18n()
const themeStore = useThemeStore()

// Dawarich visits don't carry a place category, so all stops use the
// "default" tint — same as the corresponding map marker. When future
// integrations supply place categories, fall back to that.
const iconColor = computed(() =>
  getCategoryColor('default', themeStore.isDark),
)

const timeRange = computed(() => {
  const start = dayjs(props.stop.startTime).format('h:mm A')
  const end = dayjs(props.stop.endTime).format('h:mm A')
  return `${start} – ${end}`
})

const durationLabel = computed(() => {
  const totalMin = Math.max(1, Math.round(props.stop.duration / 60))
  if (totalMin < 60) return `${totalMin} min`
  const hours = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return min === 0 ? `${hours} hr` : `${hours} hr ${min} min`
})

const displayName = computed(
  () => props.stop.name?.trim() || t('timeline.unnamedStop'),
)

const formattedAddress = computed(
  () => props.stop.address?.formatted ?? null,
)
</script>

<template>
  <button
    class="group relative w-full text-left flex gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 rounded-md"
    @click="emit('select', stop)"
  >
    <!-- Thread: a thin muted line that runs through the centre of the
         icon column so adjacent rows visually connect into one timeline.
         Mode-coloured segments paint over their portion of this thread. -->
    <div
      aria-hidden="true"
      class="absolute top-0 bottom-0 w-px bg-border/70 left-[28px] -translate-x-1/2"
    />
    <ItemIcon
      icon="MapPin"
      :custom-color="iconColor"
      size="sm"
      shape="circle"
      variant="solid"
      class="relative z-10 shrink-0 mt-0.5"
    />
    <div class="flex-1 min-w-0">
      <div class="flex items-baseline justify-between gap-3">
        <span
          class="font-semibold text-sm leading-snug truncate"
        >
          {{ displayName }}
        </span>
        <span
          class="text-xs text-muted-foreground tabular-nums shrink-0"
        >
          {{ durationLabel }}
        </span>
      </div>
      <div
        v-if="formattedAddress"
        class="text-xs text-muted-foreground truncate mt-0.5"
      >
        {{ formattedAddress }}
      </div>
      <div class="text-xs text-muted-foreground/80 mt-0.5 tabular-nums">
        {{ timeRange }}
      </div>
    </div>
  </button>
</template>
