<script setup lang="ts">
import { ref } from 'vue'
import RouteBullet from '@/components/transit/RouteBullet.vue'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'

/**
 * One card on the board: the run, plus the plain facts about it. The caller
 * describes *what is true*; this component decides how that looks. Nothing
 * here is a gate — every run stays selectable, because the rider knows their
 * own situation better than a walking estimate does.
 */
export interface BoardCard {
  ms: number
  route?: { shortName?: string; color?: string; textColor?: string }
  card: {
    /** Countdown, e.g. "5 min" / "now" / "3m ago". */
    lead: string
    /** Clock time of the run. */
    sub?: string
    /** Timetabled time, when a live prediction has superseded it. */
    scheduledSub?: string
    /** Signed seconds off the timetable (+late / -early). */
    delaySec?: number
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
 * tapping a run re-plans the trip around it.
 *
 * ── The visual language ──────────────────────────────────────────────
 * Each channel answers exactly one question, and never borrows another's:
 *
 *   ring      → is this the run you're taking?  (selection, nothing else)
 *   badge     → is something wrong with it?     (cancelled ▸ may miss ▸ hurry)
 *   dimming   → is it still an option at all?   (operator facts only)
 *   the number→ when does it go?                (time, and only time)
 *   meta line → what time is that on the clock? (plus the timetable it beat)
 *   live dot  → where did that time come from?  (prediction vs schedule)
 *
 * The split that matters: an operator *fact* (departed, cancelled) dims the
 * whole card, because the run is genuinely not an option. Our own *estimate*
 * (hurry, may miss) only ever adds a badge — we are routinely wrong about
 * those, so they must never make a run look unavailable.
 *
 * Strikethrough means one thing only: this time is void or superseded. So a
 * cancelled run's countdown is struck, and a beaten timetable time is struck.
 * A departed run is not — it happened; "3m ago" already says so.
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

type Card = BoardCard['card']

/** Minutes off schedule worth colouring. Under a minute is timetable noise. */
const DELAY_NOTICE_SEC = 60

/**
 * The one badge this run earns, worst news first. A cancelled run has nothing
 * else worth saying; beyond that, "probably can't" outranks "only just".
 */
function badge(card: Card): { label: string; class: string } | null {
  if (card.cancelled) {
    return { label: 'cancelled', class: 'bg-red-600 text-white dark:bg-red-500 dark:text-red-50' }
  }
  if (card.unreachable) {
    return { label: 'may miss', class: 'bg-orange-500 text-white dark:bg-orange-500 dark:text-orange-50' }
  }
  if (card.hurry) {
    return { label: 'hurry', class: 'bg-amber-400 text-amber-950 dark:bg-amber-400 dark:text-amber-950' }
  }
  return null
}

/** Gone or pulled — the operator's word, not our guess. Recedes as context. */
function isPast(card: Card) {
  return Boolean(card.departed || card.cancelled)
}

/** The countdown speaks only about time. Struck when the run is void. */
function numberClass(card: Card): string {
  if (card.cancelled) return 'line-through text-muted-foreground'
  if (card.arriving) return 'text-parchment-600 dark:text-parchment-400'
  return 'text-foreground'
}

/** Running late reads warm, running early reads cool; on time stays quiet. */
function clockClass(card: Card): string {
  const delay = card.delaySec ?? 0
  if (delay >= DELAY_NOTICE_SEC) return 'text-red-600 dark:text-red-400'
  if (delay <= -DELAY_NOTICE_SEC) return 'text-sky-600 dark:text-sky-400'
  return 'text-muted-foreground'
}

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
 * Put the first comfortably catchable run at the left edge, leaving a sliver
 * of the past as a scroll-back hint. They stay reachable by scrolling; this
 * only picks the resting position. When nothing is reachable (rider still far
 * out) fall back to the first upcoming run, so the board never rests on a wall
 * of departed cards.
 */
function scrollToFirstAvailable(el: HTMLElement, cards: BoardCard[]) {
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
      <!-- Every card is the same three rows — identity, time, clock — so the
           eye can scan straight down one column across the whole board. The
           border is transparent rather than absent so selecting a run doesn't
           shift the row by 2px. -->
      <button
        v-for="item in cards"
        :key="item.ms"
        type="button"
        class="shrink-0 min-w-[80px] flex flex-col items-center justify-center gap-1 px-2.5 py-2 rounded-xl border-2 border-transparent bg-muted/30 text-center tabular-nums transition-all cursor-pointer hover:bg-muted/60"
        :class="[
          item.card.planned && !lineColor && 'border-parchment-500 bg-parchment-500/10',
          isPast(item.card) && 'opacity-45 hover:opacity-80',
          busy && 'opacity-50 pointer-events-none',
        ]"
        :style="item.card.planned && lineColor ? {
          borderColor: `#${lineColor}`,
          background: `#${lineColor}1f`,
        } : {}"
        :title="item.card.title"
        :aria-label="item.card.title"
        @click="item.card.clickable && emit('choose', item.ms)"
      >
        <!-- Identity: which train this is, whether the time is live, and the
             one badge it earned. The badge is filled so it carries the warning
             on its own — the countdown below stays about time. -->
        <div class="flex items-center justify-center gap-1 leading-none">
          <RouteBullet
            v-if="item.route?.shortName ?? lineName"
            size="sm"
            :label="item.route?.shortName ?? lineName"
            :color="item.route ? item.route.color : lineColor"
            :text-color="item.route ? item.route.textColor : lineTextColor"
          />
          <span
            v-if="badge(item.card)"
            class="rounded-full px-1.5 py-px text-[10px] font-semibold leading-[1.3] whitespace-nowrap"
            :class="badge(item.card)!.class"
          >{{ badge(item.card)!.label }}</span>
          <RealtimeIndicator
            v-if="item.card.live"
            :real-time="true"
            :class="!isPast(item.card) && 'animate-pulse'"
          />
        </div>

        <!-- When it goes. Nothing but time lives here. -->
        <div
          class="text-[13px] font-semibold leading-tight whitespace-nowrap"
          :class="numberClass(item.card)"
        >{{ item.card.lead }}</div>

        <!-- The clock time, and the timetable it beat. "2:21 2:24" reads as
             "was due 2:21, now running 2:24" without any extra chrome. -->
        <div
          v-if="item.card.sub"
          class="text-[10px] leading-none whitespace-nowrap"
        >
          <span
            v-if="item.card.scheduledSub"
            class="line-through text-muted-foreground/60 mr-0.5"
          >{{ item.card.scheduledSub }}</span><span
            :class="clockClass(item.card)"
          >{{ item.card.sub }}</span>
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
