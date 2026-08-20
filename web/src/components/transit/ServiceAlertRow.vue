<script setup lang="ts">
/**
 * An alert that is in effect right now, at full width.
 *
 * These are the ones a rider standing on a platform can act on, and there are
 * almost never many — a line with twelve alerts typically has one or two
 * actually running. So they get the width, a tinted surface that reads as
 * "something is wrong here" at a glance, and the headline unclamped enough to
 * finish a sentence. Scheduled work is a row of small chips instead; the size
 * difference is the hierarchy.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlertIcon, ChevronDownIcon } from 'lucide-vue-next'
import { alertTone, alertEffectKey } from '@/lib/transit-alerts'
import type { ServiceAlert } from '@/types/transit.types'

const props = defineProps<{
  alert: ServiceAlert
  /** When it applies, already phrased — "Now", "Until 5:00 AM". */
  when: string | null
  expanded: boolean
}>()

defineEmits<{ toggle: [] }>()

const { t } = useI18n()

const tone = computed(() => alertTone(props.alert))

/**
 * The surface carries the severity, not just the icon. A live alert has to be
 * distinguishable from the rest of the panel without being read.
 */
const surfaceClass = computed(() => ({
  severe: 'border-red-300/70 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30',
  warning: 'border-amber-300/70 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/25',
  info: 'border-border bg-card',
}[tone.value]))

const toneClass = computed(() => ({
  severe: 'text-red-700 dark:text-red-400',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-muted-foreground',
}[tone.value]))

const label = computed(() => {
  const key = alertEffectKey(props.alert)
  return key ? t(`place.transit.alerts.effect.${key}`) : t('place.transit.alerts.title')
})
</script>

<template>
  <button
    type="button"
    class="w-full flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer"
    :class="surfaceClass"
    :aria-expanded="expanded"
    @click="$emit('toggle')"
  >
    <TriangleAlertIcon class="size-4 shrink-0 mt-px" :class="toneClass" />

    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2">
        <span class="text-xs font-semibold" :class="toneClass">{{ label }}</span>
        <span v-if="when" class="text-[11px] text-muted-foreground">{{ when }}</span>
      </div>
      <div class="mt-0.5 text-xs leading-snug" :class="expanded ? undefined : 'line-clamp-2'">
        {{ alert.header }}
      </div>
    </div>

    <ChevronDownIcon
      class="size-3.5 shrink-0 mt-0.5 text-muted-foreground transition-transform"
      :class="expanded && 'rotate-180'"
    />
  </button>
</template>
