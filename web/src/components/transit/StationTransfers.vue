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

const props = defineProps<{
  lines: StationLine[]
  /** The station's coordinates — portolan's bullets are resolved against the
   *  pyramid covering this point, so a Brooklyn 4 is not a Long Island one. */
  lat?: number
  lng?: number
  /** Absent when the board never named its feed; a bullet is then inert. */
  feedId?: string
}>()

const emit = defineEmits<{ (e: 'open', line: StationLine): void }>()

const { t } = useI18n()

const styleOf = (line: StationLine) => bulletFor(line.id, props.lat, props.lng, line.type)

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
const groups = computed(() =>
  [
    { key: 'transfers', label: t('place.transit.transfers'), lines: props.lines.filter((l) => l.via === 'transfer') },
    { key: 'nearby', label: t('place.transit.nearby'), lines: props.lines.filter((l) => l.via === 'nearby') },
  ].filter((g) => g.lines.length),
)
</script>

<template>
  <section v-if="groups.length" class="mt-3 pt-3 border-t space-y-4">
    <div v-for="group in groups" :key="group.key">
    <h3 class="text-sm font-medium mb-2">{{ group.label }}</h3>

    <ul class="space-y-1.5">
      <li v-for="line in group.lines" :key="line.id">
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
          <!-- How far the walk is. Only nearby rows carry one. -->
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
