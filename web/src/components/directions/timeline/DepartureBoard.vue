<script setup lang="ts">
import { ref } from 'vue'
import RouteBullet from '@/components/transit/RouteBullet.vue'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'

/** One card on the board: the run, plus how it should read to the rider.
 *  `departed` and `unreachable` are cosmetic hints only — every run stays
 *  selectable, because the rider knows their own situation better than the
 *  walk estimate does. */
export interface BoardCard {
  ms: number
  route?: { shortName?: string; color?: string; textColor?: string }
  card: {
    lead: string
    sub?: string
    /** Timetabled time, struck beside `sub` when the run is off-schedule. */
    scheduledSub?: string
    /** The countdown's colour, resolved by the caller so statuses can't race. */
    leadClass?: string
    title?: string
    planned?: boolean
    departed?: boolean
    unreachable?: boolean
    hurry?: boolean
    cancelled?: boolean
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
 * as a scroll-back hint — the leading struck cards are noise on open. They
 * stay reachable by scrolling back; this only picks the resting position.
 */
function scrollToFirstAvailable(el: HTMLElement, cards: BoardCard[]) {
  // Prefer the first comfortably catchable run; when nothing is reachable
  // (rider still far out) fall back to the first upcoming one, so the board
  // never rests on a wall of departed cards.
  let first = cards.findIndex(c => !c.card.departed && !c.card.unreachable)
  if (first < 0) first = cards.findIndex(c => !c.card.departed)
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

/** Gone, cancelled, or a stretch to reach — same muted treatment for all. */
function dimmed(card: BoardCard['card']) {
  return Boolean(card.departed || card.unreachable || card.cancelled)
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
        class="shrink-0 min-w-[80px] flex flex-col items-center justify-center gap-1 px-2.5 py-2 rounded-xl border-2 text-center tabular-nums transition-colors cursor-pointer"
        :class="[
          item.card.cancelled
            ? 'border-transparent bg-muted/20 hover:bg-muted/40'
            : item.card.planned
              ? (lineColor ? '' : 'border-parchment-500 bg-parchment-500/10')
              : item.card.departed
                ? 'border-transparent bg-muted/20 hover:bg-muted/40'
                : item.card.unreachable
                  ? 'border-dashed border-border/70 bg-muted/20 hover:bg-muted/50 hover:border-foreground/30'
                  : item.card.hurry
                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/60 dark:hover:bg-amber-900/40'
                    : 'border-border bg-muted/30 hover:bg-muted/60 hover:border-foreground/30',
          busy && 'opacity-50 pointer-events-none',
        ]"
        :style="item.card.planned && lineColor ? {
          borderColor: `#${lineColor}`,
          background: `#${lineColor}1f`,
        } : {}"
        :title="item.card.title"
        @click="item.card.clickable && emit('choose', item.ms)"
      >
        <!-- Route bullet + status cue. A pulled run says "cancelled"; a tight
             one says "hurry" (both spelled out, so they read without the
             tooltip and survive being the selected card). The live indicator
             sits alongside rather than instead of them — whether the time is a
             prediction is orthogonal to whether you can make it. A scheduled,
             comfortable run is just the bullet. -->
        <div
          class="flex items-center justify-center gap-1 leading-none"
          :class="dimmed(item.card) && 'opacity-50'"
        >
          <RouteBullet
            v-if="item.route?.shortName ?? lineName"
            size="sm"
            :label="item.route?.shortName ?? lineName"
            :color="item.route ? item.route.color : lineColor"
            :text-color="item.route ? item.route.textColor : lineTextColor"
          />
          <span
            v-if="item.card.cancelled"
            class="text-[10px] font-semibold text-red-700 dark:text-red-300"
          >cancelled</span>
          <span
            v-else-if="item.card.hurry"
            class="text-[10px] font-semibold text-amber-700 dark:text-amber-300"
          >hurry</span>
          <RealtimeIndicator
            v-if="item.card.live"
            :real-time="true"
            :class="!dimmed(item.card) && 'animate-pulse'"
          />
        </div>
        <!-- Countdown — 'now' for an arriving train, else N min. The colour is
             resolved by the caller (theme-safe tokens only, never the raw line
             colour as text) so two statuses can't both emit one and race. -->
        <div
          class="text-[13px] font-semibold leading-tight whitespace-nowrap"
          :class="item.card.leadClass"
        >{{ item.card.lead }}</div>
        <!-- Absolute clock time (always kept — even on a hurry or selected card
             the rider still needs the departure time; the "hurry" warning lives
             in the cue row above). When a live prediction has moved the run off
             its timetable, the scheduled time sits struck in front of it, so
             "2:21 → 2:24" reads without any extra chrome. -->
        <div
          v-if="item.card.sub"
          class="text-[10px] leading-none text-muted-foreground whitespace-nowrap"
          :class="dimmed(item.card) && 'opacity-60'"
        >
          <span
            v-if="item.card.scheduledSub"
            class="line-through opacity-60 mr-0.5"
          >{{ item.card.scheduledSub }}</span>{{ item.card.sub }}
        </div>
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
