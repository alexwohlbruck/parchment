<script setup lang="ts">
/**
 * Every alert affecting what the caller is looking at.
 *
 * Owns its own fetch so a page only has to say *what it is showing* — a route,
 * a stop, a trip — rather than wiring up a store. Renders nothing at all when
 * there are no alerts, so it can sit unconditionally in a layout.
 *
 * ── Why a row and not a stack ────────────────────────────────────────
 * A New York line routinely carries a dozen alerts, nearly all of them
 * scheduled overnight work. Stacked full-width cards pushed the departures and
 * the stop list off the screen entirely, and the sheer wall of them read as
 * "this line is broken" when almost nothing was actually happening. So they
 * scroll sideways, one glanceable chip each, and only the one you tap opens.
 *
 * Ordering is by relevance rather than severity alone: what is happening now
 * comes first, because a rider standing on the platform cannot act on next
 * Tuesday's closure. What starts later is counted in the header and reachable
 * by scrolling, not hidden — a closure tonight still matters at 5pm.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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

/** In-effect first, then scheduled — the order the chips are laid out in. */
const ordered = computed(() => [...inEffect.value, ...upcoming.value])

const openId = ref<string | null>(null)
const open = computed(() => ordered.value.find(a => a.id === openId.value) ?? null)

// Navigating to another route must not leave the previous line's alert open.
watch(ordered, (list) => {
  if (openId.value && !list.some(a => a.id === openId.value)) openId.value = null
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
    <div v-if="title" class="flex items-baseline justify-between gap-2">
      <div class="text-sm font-semibold">{{ title }}</div>
      <span v-if="upcoming.length" class="text-[11px] text-muted-foreground">
        {{ t('place.transit.alerts.summary', {
          now: inEffect.length,
          later: upcoming.length,
        }) }}
      </span>
    </div>

    <!-- The row runs to the panel edges, so the chip cut off at the right is
         visibly cut off rather than stranded inside a margin — that is what
         says it scrolls.

         The scroller's `py-1.5` is real space, not decoration: a scroll
         container cannot have visible overflow on one axis only, so without it
         the chips' shadows are clipped. Cancelling it with a negative margin
         here also cancelled most of the section's gap, leaving the expanded
         card jammed against the row — so it stays, and the section spaces off
         the padded box. -->
    <div class="edge-bleed relative">
      <div
        data-testid="alert-row"
        class="scrollbar-hidden flex items-stretch gap-2 overflow-x-auto touch-pan-x snap-x py-1.5
               [&>*:first-child]:ms-[var(--edge-bleed,0.75rem)]
               [&>*:last-child]:me-[var(--edge-bleed,0.75rem)]"
      >
        <ServiceAlertChip
          v-for="alert in ordered"
          :key="alert.id"
          :alert="alert"
          :when="when(alert)"
          :expanded="alert.id === openId"
          @toggle="toggle(alert)"
        />
      </div>
    </div>

    <!-- The full text opens under the row rather than inside a chip, so chips
         keep one height and the opened alert gets the width it needs to be read. -->
    <ServiceAlertCard v-if="open" :key="open.id" :alert="open" />
  </section>
</template>
