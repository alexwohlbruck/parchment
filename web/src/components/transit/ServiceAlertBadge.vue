<script setup lang="ts">
/**
 * "Something the agency published affects this."
 *
 * Two shapes, one meaning: bare icon where space is a departure chip or a
 * route bullet's shoulder, icon plus word where there's room to say what kind
 * of disruption it is. Tone comes from the alert's rank, resolved once in
 * `transit-alerts.ts`, so the badge and the card it stands for can never
 * disagree about how bad the news is.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlertIcon } from 'lucide-vue-next'
import { alertTone, alertEffectKey } from '@/lib/transit-alerts'
import type { ServiceAlert } from '@/types/transit.types'

const props = withDefaults(
  defineProps<{
    alert: ServiceAlert
    /** Show the effect word alongside the icon. */
    labelled?: boolean
  }>(),
  { labelled: false },
)

const { t } = useI18n()

const tone = computed(() => alertTone(props.alert))

const toneClass = computed(() => ({
  severe: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground',
}[tone.value]))

/** The word for the kind of disruption, when the feed names one worth showing. */
const label = computed(() => {
  const key = alertEffectKey(props.alert)
  return key ? t(`place.transit.alerts.effect.${key}`) : t('place.transit.alerts.title')
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1 shrink-0"
    :class="[toneClass, labelled && 'rounded-md bg-muted/60 px-1.5 py-0.5']"
    :title="alert.header"
  >
    <TriangleAlertIcon class="size-3 shrink-0" />
    <span v-if="labelled" class="text-[11px] font-medium leading-none whitespace-nowrap">
      {{ label }}
    </span>
  </span>
</template>
