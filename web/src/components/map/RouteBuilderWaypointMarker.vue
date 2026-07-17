<script setup lang="ts">
import { computed } from 'vue'

/**
 * Draggable numbered waypoint marker for the route builder. Start point is
 * accented; the final point is hollow with a ring (Apple-style start/finish);
 * intermediate points are small numbered dots.
 */
const props = defineProps<{
  index: number
  total: number
  type: 'start' | 'mid' | 'end'
}>()

const label = computed(() => String(props.index + 1))
</script>

<template>
  <div
    class="route-wp"
    :class="[`route-wp--${type}`]"
    :title="`Waypoint ${label}`"
  >
    <span v-if="type !== 'mid'" class="route-wp__dot" />
    <span v-else class="route-wp__num">{{ label }}</span>
  </div>
</template>

<style scoped>
.route-wp {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  background: var(--color-cobalt-500, #2563eb);
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  cursor: move;
  user-select: none;
}
.route-wp--start {
  width: 20px;
  height: 20px;
  background: var(--color-cobalt-500, #2563eb);
}
.route-wp--end {
  width: 20px;
  height: 20px;
  background: #fff;
  border: 3px solid var(--color-cobalt-500, #2563eb);
}
.route-wp__dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: #fff;
}
.route-wp--end .route-wp__dot {
  background: var(--color-cobalt-500, #2563eb);
}
.route-wp__num {
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: #fff;
}
</style>
