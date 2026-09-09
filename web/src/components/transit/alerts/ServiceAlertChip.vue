<script setup lang="ts">
/**
 * One alert, small enough that several fit across a phone.
 *
 * A line in New York can carry a dozen alerts at once — mostly scheduled
 * overnight work — and a stack of full-width cards buries the departure board
 * under a wall of agency prose. So the list is a row of these: the effect word,
 * two lines of the headline, and when it applies. Tapping opens the full text
 * below the row rather than inside the chip, which keeps every chip the same
 * height and the row scannable.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlertIcon, ChevronDownIcon } from 'lucide-vue-next'
import { alertTone, alertEffectKey } from '@/lib/transit-alerts'
import type { ServiceAlert } from '@/types/transit.types'

const props = defineProps<{
  alert: ServiceAlert
  /** When this alert applies, already phrased — "Now", "Tonight 1:30 AM". */
  when: string | null
  expanded: boolean
}>()

defineEmits<{ toggle: [] }>()

const { t } = useI18n()

const tone = computed(() => alertTone(props.alert))

/** Colour is severity and nothing else; selection is carried by the border. */
const toneClass = computed(() => ({
  severe: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
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
    class="shrink-0 w-[190px] flex flex-col gap-1 rounded-xl border px-2.5 py-2 text-left bg-card depth-raised transition-colors cursor-pointer hover:bg-muted/40"
    :class="expanded ? 'border-foreground/30' : 'border-border'"
    :aria-expanded="expanded"
    @click="$emit('toggle')"
  >
    <!-- Identity: what kind of disruption, and when it bites -->
    <div class="flex items-center gap-1.5 leading-none">
      <TriangleAlertIcon class="size-3 shrink-0" :class="toneClass" />
      <span class="text-[11px] font-medium truncate" :class="toneClass">{{ label }}</span>
      <span v-if="when" class="ml-auto text-[10px] text-muted-foreground shrink-0 tabular-nums">
        {{ when }}
      </span>
    </div>

    <!-- The agency's headline, clamped so every chip is the same height -->
    <span class="text-xs leading-snug line-clamp-2 text-foreground">{{ alert.header }}</span>

    <ChevronDownIcon
      class="size-3 text-muted-foreground transition-transform self-end"
      :class="expanded && 'rotate-180'"
    />
  </button>
</template>
