<script setup lang="ts">
/**
 * An alert that is in effect but is not a disruption — a line running local,
 * a holiday timetable.
 *
 * Real news, and none of it changes whether a rider can travel. Given the
 * same tinted full-width card as a suspension, six of them bury the one
 * alert that matters under a screen of identical amber. So they read as a
 * list: one line each, the effect word carrying the meaning, no surface of
 * their own. The size difference is the hierarchy.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDownIcon } from 'lucide-vue-next'
import { alertEffectKey } from '@/lib/transit-alerts'
import type { ServiceAlert } from '@/types/transit.types'

const props = defineProps<{
  alert: ServiceAlert
  /** A qualifier worth the space — "Until 5:00 AM" — or null. */
  when: string | null
  expanded: boolean
}>()

defineEmits<{ toggle: [] }>()

const { t } = useI18n()

const label = computed(() => {
  const key = alertEffectKey(props.alert)
  return key ? t(`place.transit.alerts.effect.${key}`) : t('place.transit.alerts.title')
})
</script>

<template>
  <button
    type="button"
    data-testid="alert-notice"
    class="w-full flex items-start gap-2 py-1 text-left cursor-pointer group"
    :aria-expanded="expanded"
    @click="$emit('toggle')"
  >
    <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />

    <span class="min-w-0 flex-1 text-xs leading-snug" :class="expanded ? undefined : 'truncate'">
      <span class="font-medium">{{ label }}</span>
      <span v-if="when" class="text-muted-foreground"> · {{ when }}</span>
      <span class="text-muted-foreground"> — {{ alert.header }}</span>
    </span>

    <ChevronDownIcon
      class="size-3.5 shrink-0 mt-0.5 text-muted-foreground/60 transition-transform"
      :class="expanded && 'rotate-180'"
    />
  </button>
</template>
