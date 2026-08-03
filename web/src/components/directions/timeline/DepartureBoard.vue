<script setup lang="ts">
import { ref } from 'vue'
import RouteBullet from '@/components/transit/RouteBullet.vue'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'

/** One card on the board: the run, plus how it should read to the rider. */
export interface BoardCard {
  ms: number
  route?: { shortName?: string; color?: string; textColor?: string }
  card: {
    lead: string
    sub?: string
    title?: string
    planned?: boolean
    missed?: boolean
    hurry?: boolean
    live?: boolean
    arriving?: boolean
    clickable?: boolean
  }
}

/**
 * Glanceable countdown cards for the runs around the planned departure —
 * Transit-app style. Scrolls horizontally through roughly the next hour;
 * tapping a later run re-plans the trip around it.
 *
 * The scroll-position bookkeeping lives here rather than in the trip view: it
 * is per-board DOM state (which edge fades to show, and the one-time scroll
 * past already-departed runs), and the view was carrying a map of element
 * refs keyed by segment index to manage it from the outside.
 */
defineProps<{
  cards: BoardCard[]
  /** Line colour, used to tint the planned run. Hex without the leading '#'. */
  lineColor?: string
  lineTextColor?: string
  lineName?: string
  /** Dims the board while a re-plan is in flight. */
  busy?: boolean
}>()

const emit = defineEmits<{ choose: [ms: number] }>()

const scroller = ref<HTMLElement | null>(null)
const edges = ref({ start: false, end: false })
/** The scroll-past-departed nudge is one-shot; refreshes must not re-yank. */
const didInitialScroll = ref(false)

function updateEdges(el: HTMLElement) {
  edges.value = {
    start: el.scrollLeft > 4,
    end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
  }
}

/**
 * Put the first catchable run at the left edge, leaving a sliver of the past
 * as a scroll-back hint — the leading struck cards are noise on open.
 */
function scrollToFirstAvailable(el: HTMLElement, cards: BoardCard[]) {
  const first = cards.findIndex(c => !c.card.missed)
  if (first <= 0) return
  const button = el.children[first] as HTMLElement | undefined
  if (!button) return
  const delta =
    button.getBoundingClientRect().left - el.getBoundingClientRect().left
  el.scrollLeft += delta - 16
}

function onScrollerMount(el: unknown, cards: BoardCard[]) {
  if (!(el instanceof HTMLElement)) {
    scroller.value = null
    return
  }
  scroller.value = el
  requestAnimationFrame(() => {
    if (!didInitialScroll.value) {
      didInitialScroll.value = true
      scrollToFirstAvailable(el, cards)
    }
    updateEdges(el)
  })
}

function onScroll(e: Event) {
  if (e.target instanceof HTMLElement) updateEdges(e.target)
}

defineExpose({
  /** Re-measure after a resize; the view owns the window listener. */
  remeasure: () => scroller.value && updateEdges(scroller.value),
})
</script>

<template>
  <div class="relative -mx-3">
    <div
      :ref="el => onScrollerMount(el, cards)"
      class="dep-scroll px-3 flex items-stretch gap-1.5 overflow-x-auto"
      @scroll="onScroll"
    >
      <button
        v-for="item in cards"
        :key="item.ms"
        type="button"
        class="shrink-0 min-w-[80px] flex flex-col items-center justify-center gap-1 px-2.5 py-2 rounded-xl border-2 text-center tabular-nums transition-colors"
        :class="[
          item.card.planned
            ? (lineColor ? '' : 'border-parchment-500 bg-parchment-500/10')
            : item.card.missed
              ? 'border-transparent bg-muted/20 cursor-default'
              : item.card.hurry
                ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 cursor-pointer'
                : 'border-border bg-muted/30 hover:bg-muted/60 hover:border-foreground/30 cursor-pointer',
          busy && 'opacity-50 pointer-events-none',
        ]"
        :style="item.card.planned && lineColor ? {
          borderColor: `#${lineColor}`,
          background: `#${lineColor}1f`,
        } : {}"
        :title="item.card.title"
        :disabled="item.card.missed"
        @click="item.card.clickable && emit('choose', item.ms)"
      >
        <!-- Route bullet + status cue. A tight connection shows a spelled-out
             "hurry" (visible without the tooltip and kept even when this run is
             selected); otherwise a live prediction adds a pulsing indicator;
             scheduled is just the bullet. -->
        <div
          class="flex items-center justify-center gap-1 leading-none"
          :class="item.card.missed && 'opacity-50'"
        >
          <RouteBullet
            v-if="item.route?.shortName ?? lineName"
            size="sm"
            :label="item.route?.shortName ?? lineName"
            :color="item.route ? item.route.color : lineColor"
            :text-color="item.route ? item.route.textColor : lineTextColor"
          />
          <span
            v-if="item.card.hurry"
            class="text-[10px] font-semibold text-amber-700 dark:text-amber-300"
          >hurry</span>
          <RealtimeIndicator
            v-else-if="item.card.live"
            :real-time="true"
            :class="!item.card.missed && 'animate-pulse'"
          />
        </div>
        <!-- Countdown — 'now' for an arriving train, else N min. Statuses use
             theme-safe tokens (never the raw line colour as text): muted+struck
             when missed, amber when hurry, the parchment accent for 'now'. -->
        <div
          class="text-[13px] font-semibold leading-tight whitespace-nowrap"
          :class="[
            item.card.missed && 'line-through text-muted-foreground/50',
            item.card.hurry && 'text-amber-700 dark:text-amber-300',
            item.card.arriving && !item.card.hurry && 'text-parchment-600 dark:text-parchment-400',
          ]"
        >{{ item.card.lead }}</div>
        <!-- Absolute clock time (always kept — even on a hurry or selected card
             the rider still needs the departure time; the "hurry" warning lives
             in the cue row above). -->
        <div
          v-if="item.card.sub"
          class="text-[10px] leading-none text-muted-foreground"
          :class="item.card.missed && 'opacity-60'"
        >{{ item.card.sub }}</div>
      </button>
    </div>

    <!-- Edge fades hint there are more departures off-screen -->
    <div
      v-show="edges.start"
      class="pointer-events-none absolute inset-y-0 left-0 w-6"
      style="background: linear-gradient(to right, hsl(var(--card)), hsl(var(--card) / 0))"
    />
    <div
      v-show="edges.end"
      class="pointer-events-none absolute inset-y-0 right-0 w-6"
      style="background: linear-gradient(to left, hsl(var(--card)), hsl(var(--card) / 0))"
    />
  </div>
</template>

<style scoped>
/* Clean horizontal scroll, no visible scrollbar */
.dep-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.dep-scroll::-webkit-scrollbar {
  display: none;
}
</style>
