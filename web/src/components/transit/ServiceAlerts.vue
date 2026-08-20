<script setup lang="ts">
/**
 * Every alert affecting what the caller is looking at.
 *
 * Owns its own fetch so a page only has to say *what it is showing* — a route,
 * a stop, a trip — rather than wiring up a store. Renders nothing at all when
 * there are no alerts, so it can sit unconditionally in a layout.
 *
 * ── Two tiers, because they are not the same news ────────────────────
 * A New York line routinely carries a dozen alerts and typically one or two
 * are actually running; the rest is overnight work scheduled weeks out. Giving
 * all of them the same weight made a page shout identically whether a rider's
 * train was detoured right now or nothing at all was happening.
 *
 * So what is in effect gets full-width tinted rows — few, prominent, readable
 * without a tap. Scheduled work collapses to one quiet line that opens into a
 * row of small chips. A line with nothing running wrong shows no colour at
 * all, just "10 scheduled changes", which is the honest summary.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRightIcon } from 'lucide-vue-next'
import ServiceAlertRow from './ServiceAlertRow.vue'
import ServiceAlertChip from './ServiceAlertChip.vue'
import ServiceAlertCard from './ServiceAlertCard.vue'
import { useTransitAlerts } from '@/composables/useTransitAlerts'
import { isInEffect, nextStart, currentEnd } from '@/lib/transit-alerts'
import { useTransitClock } from '@/composables/useTransitClock'
import type { AlertQuery } from '@/stores/transit-alerts.store'
import type { ServiceAlert } from '@/types/transit.types'

const props = withDefaults(
  defineProps<{
    /**
     * What to ask about. `null` until the caller knows its ids. Pass
     * `includeUpcoming: true` to get scheduled work too — and pass the *same*
     * query a page uses for its own badges, so both share one fetch.
     */
    query: AlertQuery | null
    /** Heading over the row. Omit for no heading. */
    title?: string
  }>(),
  { title: undefined },
)

const { t } = useI18n()
// Alerts flip between "later tonight" and "now" on the hour; the clock keeps
// the row honest without re-fetching.
const now = useTransitClock()

const { inEffect, upcoming } = useTransitAlerts(computed(() => props.query))

const ordered = computed(() => [...inEffect.value, ...upcoming.value])

const openId = ref<string | null>(null)
/** Scheduled work stays folded away until asked for. */
const showScheduled = ref(false)

const openScheduled = computed(
  () => upcoming.value.find(a => a.id === openId.value) ?? null,
)

// Navigating to another route must not leave the previous line's alert open.
watch(ordered, (list) => {
  if (openId.value && !list.some(a => a.id === openId.value)) openId.value = null
})

// Folding the scheduled list away takes its open alert with it.
watch(showScheduled, (shown) => {
  if (!shown && openScheduled.value) openId.value = null
})

function toggle(alert: ServiceAlert) {
  openId.value = openId.value === alert.id ? null : alert.id
}

/**
 * When this alert bites, in as few characters as a chip can carry.
 *
 * "Now" is the only thing worth saying for something in effect — the rider is
 * living it. For scheduled work the time it starts is what decides whether it
 * matters today, so that leads, with the day attached once it isn't today's.
 */
function when(alert: ServiceAlert): string | null {
  const current = now.value.getTime()

  if (isInEffect(alert, current)) {
    const ends = currentEnd(alert, current)
    // Something ending within the hour is nearly over; say so rather than "now".
    if (ends && ends.getTime() - current < 60 * 60_000) {
      return t('place.transit.alerts.untilTime', { time: clock(ends) })
    }
    return t('place.transit.alerts.now')
  }

  const start = nextStart(alert, current)
  if (!start) return null

  const days = calendarDaysApart(new Date(current), start)
  if (days === 0) return clock(start)
  if (days === 1) return t('place.transit.alerts.tomorrow')
  if (days < 7) return start.toLocaleDateString([], { weekday: 'short' })
  return start.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function clock(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Whole days between two local calendar dates, ignoring the time of day. */
function calendarDaysApart(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
</script>

<template>
  <section v-if="ordered.length" class="space-y-2">
    <div v-if="title" class="text-sm font-semibold">{{ title }}</div>

    <!-- In effect: few, full width, and the detail opens directly beneath the
         row it belongs to rather than at the bottom of the section. -->
    <div v-if="inEffect.length" class="space-y-1.5">
      <template v-for="alert in inEffect" :key="alert.id">
        <ServiceAlertRow
          :alert="alert"
          :when="when(alert)"
          :expanded="alert.id === openId"
          @toggle="toggle(alert)"
        />
        <ServiceAlertCard v-if="alert.id === openId" :alert="alert" />
      </template>
    </div>

    <!-- Scheduled: one quiet line. On a clear day this is the whole section. -->
    <div v-if="upcoming.length" class="space-y-2">
      <button
        type="button"
        data-testid="scheduled-toggle"
        class="flex items-center gap-1 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        :aria-expanded="showScheduled"
        @click="showScheduled = !showScheduled"
      >
        <ChevronRightIcon
          class="size-3.5 transition-transform"
          :class="showScheduled && 'rotate-90'"
        />
        {{ t('place.transit.alerts.scheduledCount', upcoming.length) }}
      </button>

      <!-- The row runs to the panel edges, so the chip cut off at the right is
           visibly cut off rather than stranded inside a margin — that is what
           says it scrolls.

           The scroller's `py-1.5` is real space, not decoration: a scroll
           container cannot have visible overflow on one axis only, so without
           it the chips' shadows are clipped. -->
      <template v-if="showScheduled">
        <div class="edge-bleed relative">
          <div
            data-testid="alert-row"
            class="scrollbar-hidden flex items-stretch gap-2 overflow-x-auto touch-pan-x snap-x py-1.5
                   [&>*:first-child]:ms-[var(--edge-bleed,0.75rem)]
                   [&>*:last-child]:me-[var(--edge-bleed,0.75rem)]"
          >
            <ServiceAlertChip
              v-for="alert in upcoming"
              :key="alert.id"
              :alert="alert"
              :when="when(alert)"
              :expanded="alert.id === openId"
              @toggle="toggle(alert)"
            />
          </div>
        </div>

        <ServiceAlertCard v-if="openScheduled" :key="openScheduled.id" :alert="openScheduled" />
      </template>
    </div>
  </section>
</template>
