<script setup lang="ts">
/**
 * Lines a rider reaches from this station without leaving the paid area.
 *
 * Its own section, below the departures, because it answers a different
 * question from the board above it. These trains do not depart from here —
 * the J and Z at Brooklyn Bridge–City Hall are one connection away at
 * Chambers St — so they carry no times, and no "isn't running" state: what
 * this section asserts is that the transfer exists, which is all the
 * agency's transfers.txt tells us.
 *
 * Membership comes from Barrelman, which marks each line `station` or
 * `transfer`. A free transfer bought by a fare rule rather than a walk
 * between platforms is not published there, so it is not claimed here.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RouteBullet from '@/components/transit/RouteBullet.vue'
import { bulletFor } from '@/services/layers/features/portolan/portolan-bullets'
import { getRouteBulletLabel } from '@/lib/transit'
import type { StationLine } from '@/composables/usePlaceTransitLines'
import type { Dayjs } from 'dayjs'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'
import { ChevronRightIcon } from 'lucide-vue-next'
import { formatCountdown, type RouteGroup } from '@/lib/transit-departures'

const props = defineProps<{
  lines: StationLine[]
  /** The station's coordinates — portolan's bullets are resolved against the
   *  pyramid covering this point, so a Brooklyn 4 is not a Long Island one. */
  lat?: number
  lng?: number
  /** Absent when the board never named its feed; a bullet is then inert. */
  feedId?: string
  /** The connecting stations, each with its name and its own grouped board.
   *  A connection is a place: "the R in 6 minutes" only helps once you know it
   *  leaves from Court St, and the name is also what you tap to go there. */
  stations?: Array<{
    name: string
    lat?: number
    lng?: number
    osm?: string
    groups: RouteGroup[]
  }>
  /** Clock the countdowns are measured against. */
  now?: Date | Dayjs
}>()

const emit = defineEmits<{
  (e: 'open', line: StationLine): void
  (e: 'openRoute', routeId: string): void
  (e: 'openStation', station: {
    name: string
    lat?: number
    lng?: number
    osm?: string
  }): void
}>()

const { t } = useI18n()

const styleOf = (line: StationLine) => bulletFor(line.id, props.lat, props.lng, line.type)

/** The same lookup for a departure group's route, which carries `type`
 *  under a different name than a StationLine does. */
const bulletForRoute = (route: RouteGroup['route']) =>
  bulletFor(route.id, props.lat, props.lng, route.type)

/**
 * Two lists, because they are two different promises.
 *
 * A `transfer` is published in the agency's own transfers.txt: the operator
 * asserts the connection and it is normally made inside the paid area. A
 * `nearby` line is one no feed connects to this station, found by walking
 * distance alone — at Rector St the 1 is fifty metres away and reaching it
 * means leaving through the turnstiles and paying again. Drawn as one list
 * they read as one promise, and the second one would be a lie.
 *
 * The distance is shown rather than described, which is the honest signal: a
 * row that says "50 m" is plainly somewhere you walk to.
 */
/** Transfer lines still needing a bullet row: the ones no board covers. When
 *  a connection has departures, its times say everything the bullet did. */
const uncoveredTransfers = computed(() => {
  const withTimes = new Set(
    (props.stations ?? []).flatMap((st) => st.groups.map((g) => g.route.id)),
  )
  return props.lines.filter((l) => l.via === 'transfer' && !withTimes.has(l.id))
})

/** Walk-to lines. Never timed: the board that would answer when they leave is
 *  the other stop's, and no feed connects it to this one. */
const nearbyLines = computed(() => props.lines.filter((l) => l.via === 'nearby'))

const hasTransfers = computed(
  () => (props.stations?.length ?? 0) > 0 || uncoveredTransfers.value.length > 0,
)

const countdown = (dep: any) => (props.now ? formatCountdown(dep, props.now) : '')

/** A station is only a link when we know where it is. */
function openStation(station: {
  name: string
  lat?: number
  lng?: number
  osm?: string
}) {
  if (!station.osm && (station.lat == null || station.lng == null)) return
  emit('openStation', station)
}
</script>

<template>
  <section
    v-if="hasTransfers || nearbyLines.length"
    class="mt-3 pt-3 border-t space-y-4"
  >
    <!-- Transfers: a connecting station's own board, so these carry times -->
    <div v-if="hasTransfers">
      <h3 class="text-sm font-medium mb-2">{{ t('place.transit.transfers') }}</h3>

      <div class="space-y-4">
        <!-- One block per connecting station: its name, then what leaves it -->
        <div v-for="station in stations ?? []" :key="station.name">
          <component
            :is="station.osm || (station.lat != null && station.lng != null) ? 'button' : 'div'"
            class="flex items-center gap-1 mb-1.5 text-left group/station"
            :class="(station.osm || station.lat != null) && 'cursor-pointer'"
            @click="openStation(station)"
          >
            <span
              class="text-xs font-medium text-muted-foreground group-hover/station:text-foreground transition-colors"
            >
              {{ station.name }}
            </span>
            <ChevronRightIcon
              v-if="station.osm || (station.lat != null && station.lng != null)"
              class="h-3 w-3 text-muted-foreground/60 group-hover/station:text-foreground transition-colors"
            />
          </component>

          <div class="space-y-3">
            <div v-for="group in station.groups" :key="group.routeKey">
              <button
                class="flex items-center gap-2 mb-1.5 group/route cursor-pointer text-left"
                @click="emit('openRoute', group.route.id)"
              >
                <RouteBullet
                  :label="bulletForRoute(group.route)?.label || group.route.shortName || ''"
                  :color="bulletForRoute(group.route)?.color || group.route.color"
                  :shape="bulletForRoute(group.route)?.shape"
                  :text-color="bulletForRoute(group.route)?.color ? null : group.route.textColor"
                  class="group-hover/route:ring-2 ring-offset-1 ring-foreground/20 transition-shadow"
                />
                <span
                  class="text-sm text-muted-foreground truncate group-hover/route:text-foreground transition-colors"
                >
                  {{ group.route.longName || group.route.shortName }}
                </span>
              </button>

              <div class="space-y-1.5 ml-1">
                <div
                  v-for="dir in group.directions"
                  :key="dir.headsign"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="text-sm truncate min-w-0">{{ dir.headsign }}</span>
                  <div class="flex items-center gap-0.5 shrink-0">
                    <template v-for="(dep, i) in dir.departures" :key="i">
                      <span v-if="i > 0" class="text-muted-foreground text-xs">,</span>
                      <span class="text-sm tabular-nums">{{ countdown(dep) }}</span>
                      <RealtimeIndicator
                        v-if="dep.realTime"
                        :real-time="true"
                        :delay="dep.delay"
                        class="shrink-0"
                      />
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- A transfer no board covered: still worth saying it exists. -->
        <ul v-if="uncoveredTransfers.length" class="space-y-1.5">
          <li v-for="line in uncoveredTransfers" :key="line.id">
            <component
              :is="feedId ? 'button' : 'div'"
              class="flex items-center gap-2 w-full text-left"
              :class="feedId && 'group/transfer cursor-pointer'"
              @click="feedId && emit('open', line)"
            >
              <RouteBullet
                :label="styleOf(line)?.label || getRouteBulletLabel(line, t)"
                :color="styleOf(line)?.color || line.color"
                :shape="styleOf(line)?.shape"
                :text-color="styleOf(line)?.color ? null : line.textColor"
                class="group-hover/transfer:ring-2 ring-offset-1 ring-foreground/20 transition-shadow"
              />
              <span
                class="text-sm text-muted-foreground truncate group-hover/transfer:text-foreground transition-colors"
              >
                {{ line.longName || line.shortName }}
              </span>
            </component>
          </li>
        </ul>
      </div>
    </div>

    <!-- Nearby: a walk to another operator's stop, so distance, not times -->
    <div v-if="nearbyLines.length">
      <h3 class="text-sm font-medium mb-2">{{ t('place.transit.nearby') }}</h3>

      <ul class="space-y-1.5">
        <li v-for="line in nearbyLines" :key="line.id">
          <component
            :is="feedId ? 'button' : 'div'"
            class="flex items-center gap-2 w-full text-left"
            :class="feedId && 'group/transfer cursor-pointer'"
            @click="feedId && emit('open', line)"
          >
            <RouteBullet
              :label="styleOf(line)?.label || getRouteBulletLabel(line, t)"
              :color="styleOf(line)?.color || line.color"
              :shape="styleOf(line)?.shape"
              :text-color="styleOf(line)?.color ? null : line.textColor"
              class="group-hover/transfer:ring-2 ring-offset-1 ring-foreground/20 transition-shadow"
            />
            <span
              class="text-sm text-muted-foreground truncate group-hover/transfer:text-foreground transition-colors"
            >
              {{ line.longName || line.shortName }}
            </span>
            <span
              v-if="line.distanceM != null"
              class="text-xs text-muted-foreground/70 shrink-0 ml-auto tabular-nums"
            >
              {{ line.distanceM }} m
            </span>
          </component>
        </li>
      </ul>
    </div>
  </section>
</template>
