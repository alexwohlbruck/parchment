<script setup lang="ts">
/**
 * One disruption in full, in the agency's own words.
 *
 * This is what opens under the row when a chip is tapped, so it shows
 * everything: the whole of the operational prose the chip clamped to two
 * lines, and when it applies. No clamp here — the rider asked for this one.
 *
 * The footnote says when it was posted and when it runs. That matters more
 * than it looks: an alert posted last December reads very differently from one
 * posted at 11pm tonight, and agencies leave long-running notices up for
 * months.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlertIcon, ExternalLinkIcon } from 'lucide-vue-next'
import { alertTone, alertStart, alertEnd } from '@/lib/transit-alerts'
import { useExternalLink } from '@/composables/useExternalLink'
import type { ServiceAlert } from '@/types/transit.types'

const props = defineProps<{ alert: ServiceAlert }>()

const { t } = useI18n()
const { openExternalLink } = useExternalLink()

const tone = computed(() => alertTone(props.alert))

const headerClass = computed(() => ({
  severe: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-foreground',
}[tone.value]))

const iconClass = computed(() => ({
  severe: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground',
}[tone.value]))

/**
 * A date the rider can place. The year is included once it isn't this one:
 * MTA's long-running work carries posting dates from previous years, and
 * "Posted Dec 1" with no year reads as a fortnight ago rather than as
 * something that has been sitting there since 2025.
 */
function formatWhen(date: Date): string {
  const thisYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: thisYear ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * When this happened, in whichever terms the feed actually committed to.
 *
 * The posting time leads when the agency gives one: an alert written three
 * weeks ago and one written at 11pm tonight read completely differently, and
 * agencies leave stale notices up. Failing that, fall back to the window —
 * when it starts, or when it lifts.
 */
const timing = computed(() => {
  const posted = props.alert.postedAt ? new Date(props.alert.postedAt) : null
  if (posted && !Number.isNaN(posted.getTime())) {
    return t('place.transit.alerts.postedAt', { date: formatWhen(posted) })
  }

  const start = alertStart(props.alert)
  const end = alertEnd(props.alert)
  if (start && start.getTime() > Date.now()) {
    return t('place.transit.alerts.startsAt', { date: formatWhen(start) })
  }
  if (start) return t('place.transit.alerts.inEffectSince', { date: formatWhen(start) })
  if (end) return t('place.transit.alerts.until', { date: formatWhen(end) })
  return null
})
</script>

<template>
  <article class="rounded-lg border bg-card/50 px-3 py-2.5 text-xs">
    <div class="flex items-start gap-2">
      <TriangleAlertIcon class="size-3.5 shrink-0 mt-px" :class="iconClass" />

      <div class="min-w-0 flex-1">
        <!-- A div, not a heading: h1-h3 carry the display serif globally, which
             at this size shouted over the route the alert belongs to. -->
        <div data-testid="alert-header" class="font-semibold leading-snug" :class="headerClass">
          {{ alert.header }}
        </div>

        <!-- Agency prose runs to eight paragraphs of stop lists and travel
             alternatives. Bounded and scrolled rather than clamped behind a
             second tap: the rider already tapped once to get here, and an
             unbounded block pushes the stop list off the page. -->
        <p
          v-if="alert.description"
          class="mt-1.5 max-h-44 overflow-y-auto leading-relaxed text-muted-foreground whitespace-pre-line"
        >{{ alert.description }}</p>

        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span v-if="timing" :title="alert.category || undefined">{{ timing }}</span>
          <button
            v-if="alert.url"
            type="button"
            class="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            @click="openExternalLink(alert.url!, '_blank')"
          >
            <ExternalLinkIcon class="size-3" />
            {{ t('place.transit.alerts.moreInfo') }}
          </button>
        </div>
      </div>
    </div>
  </article>
</template>
