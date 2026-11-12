<script setup lang="ts">
import { ItemIcon } from '@/components/ui/item-icon'
import type { RouteWaypointDisplay } from '@/composables/directions/useRouteWaypoints'

const props = defineProps<{
  waypoint: RouteWaypointDisplay
  /** The rail of the vertical timeline, or the cap of the trip bar. */
  size: 'rail' | 'bar'
}>()

const iconed = () => props.waypoint.role !== 'origin' || props.waypoint.ownIcon
</script>

<template>
  <ItemIcon
    v-if="iconed()"
    :icon="waypoint.display.icon"
    :icon-pack="waypoint.display.iconPack"
    :color="waypoint.display.color"
    :custom-color="waypoint.display.customColor"
    :image-url="waypoint.display.imageUrl ?? undefined"
    :size="size === 'rail' ? 'sm' : 'xs'"
    variant="solid"
    shape="circle"
    class="shrink-0"
    :class="size === 'rail' ? '!size-7 ring-2 ring-muted-light' : 'shadow-xs'"
  />
  <div v-else class="flex shrink-0 items-center justify-center" :class="size === 'rail' ? 'size-7' : 'size-5'">
    <div
      class="rounded-full bg-background border-[1.5px] border-foreground/60"
      :class="size === 'rail' ? 'size-4 ring-2 ring-muted-light' : 'size-2.5 shadow-xs'"
    />
  </div>
</template>
