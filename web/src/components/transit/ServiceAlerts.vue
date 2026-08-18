<script setup lang="ts">
/**
 * Every alert affecting what the caller is looking at, fetched and laid out.
 *
 * Owns its own fetch so a page only has to say *what it is showing* — a route,
 * a stop, a trip — rather than wiring up a store. Renders nothing at all when
 * there are no alerts, so it can sit unconditionally in a layout.
 *
 * What is happening now leads; what starts later is filed underneath, because
 * a rider standing on a platform needs today's suspension before next
 * weekend's planned closure.
 */
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import ServiceAlertCard from './ServiceAlertCard.vue'
import { useTransitAlerts } from '@/composables/useTransitAlerts'
import type { AlertQuery } from '@/stores/transit-alerts.store'

const props = withDefaults(
  defineProps<{
    /**
     * What to ask about. `null` until the caller knows its ids. Pass
     * `includeUpcoming: true` to get the "Upcoming alerts" section — and pass
     * the *same* query a page uses for its own badges, so both share one fetch.
     */
    query: AlertQuery | null
    /** Heading over the in-effect list. Omit for no heading. */
    title?: string
  }>(),
  { title: undefined },
)

const { t } = useI18n()

const { inEffect, upcoming } = useTransitAlerts(toRef(props, 'query'))
</script>

<template>
  <section v-if="inEffect.length || upcoming.length" class="space-y-3">
    <div v-if="inEffect.length" class="space-y-2">
      <h2 v-if="title" class="text-sm font-semibold">{{ title }}</h2>
      <ServiceAlertCard v-for="alert in inEffect" :key="alert.id" :alert="alert" />
    </div>

    <div v-if="upcoming.length" class="space-y-2">
      <h2 class="text-sm font-semibold">{{ t('place.transit.alerts.upcoming') }}</h2>
      <ServiceAlertCard v-for="alert in upcoming" :key="alert.id" :alert="alert" />
    </div>
  </section>
</template>
