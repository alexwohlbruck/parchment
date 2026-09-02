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
</script>

<template>
  <section v-if="lines.length" class="mt-3 pt-3 border-t">
    <h3 class="text-sm font-medium mb-2">{{ t('place.transit.transfers') }}</h3>
    <p class="text-xs text-muted-foreground mb-2">
      {{ t('place.transit.transfersHint') }}
    </p>

    <ul class="space-y-1.5">
      <li v-for="line in lines" :key="line.id">
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
  </section>
</template>
