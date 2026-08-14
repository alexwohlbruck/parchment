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
 *   colour    → how does this run stand for you? (one ramp, one resolver)
 *   footnote  → the word for that, or the clock  (one line, one slot)
 *   live dot  → where did that time come from?   (prediction vs schedule)
 *
 * The countdown is the hero, so the *countdown itself* takes the status
 * colour. An earlier pass gave status its own filled badge, which made the
 * metadata louder than the departure time it described and forced every chip
 * to a different width. Colouring the number instead is both quieter and more
 * visible, and it keeps the chips on one grid.
 *
 * Colour is resolved once, in `status()`, so the number and the word beneath
 * it can never disagree — and so no two conditions can both emit a text colour
 * and race on stylesheet order.
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
 * The single status a run carries, worst news first — a cancelled run has
 * nothing else worth saying, and "probably can't" outranks "only just".
 * Returns the colour too, so the countdown and the word below it are always
 * resolved together and can never disagree.
 */
function status(card: Card): { word: string | null; tone: string } {
  if (card.cancelled) return { word: 'cancelled', tone: 'text-red-600 dark:text-red-400' }
  if (card.departed) return { word: null, tone: 'text-muted-foreground/70' }
  if (card.unreachable) return { word: 'may miss', tone: 'text-orange-600 dark:text-orange-400' }
  if (card.hurry) return { word: 'hurry', tone: 'text-amber-600 dark:text-amber-400' }
  if (card.arriving) return { word: null, tone: 'text-parchment-600 dark:text-parchment-400' }
  return { word: null, tone: '' }
}

/** Gone or pulled — the operator's word, not our guess. Recedes as context. */
function isPast(card: Card) {
  return Boolean(card.departed || card.cancelled)
}

/**
 * The countdown is the loudest thing on the chip, so it carries the status
 * colour itself rather than ceding the job to a badge that would out-shout it.
 * Struck only when the run is void.
 */
function numberClass(card: Card): string {
  const { tone } = status(card)
  if (card.cancelled) return 'line-through text-muted-foreground/70'
  return tone || 'text-foreground'
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
      <!-- Every chip is the same fixed width and the same three rows —
           identity, time, footnote — so the board reads as a rhythm and the
           eye can scan straight down one column. The border is transparent
           rather than absent so selecting a run doesn't shift the row by 2px. -->
      <button
        v-for="item in cards"
        :key="item.ms"
        type="button"
        class="shrink-0 w-[78px] flex flex-col items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl border-2 border-transparent bg-muted/40 text-center tabular-nums transition-colors cursor-pointer hover:bg-muted/70"
        :class="[
          item.card.planned && !lineColor && 'border-parchment-500',
          busy && 'opacity-50 pointer-events-none',
        ]"
        :style="item.card.planned && lineColor ? { borderColor: `#${lineColor}` } : {}"
        :title="item.card.title"
        :aria-label="item.card.title"
        @click="item.card.clickable && emit('choose', item.ms)"
      >
        <!-- Identity: which train this is, and whether its time is live. Past
             runs fade the bullet on its own rather than under a blanket card
             opacity, which would desaturate the line colour into mud. -->
        <div class="flex items-center justify-center gap-1 leading-none h-[22px]">
          <RouteBullet
            v-if="item.route?.shortName ?? lineName"
            size="sm"
            :label="item.route?.shortName ?? lineName"
            :color="item.route ? item.route.color : lineColor"
            :text-color="item.route ? item.route.textColor : lineTextColor"
            :class="isPast(item.card) && 'opacity-45'"
          />
          <RealtimeIndicator
            v-if="item.card.live"
            :real-time="true"
            :class="!isPast(item.card) && 'animate-pulse'"
          />
        </div>

        <!-- When it goes — the hero, and the element that carries the status
             colour. Nothing is allowed to be louder than this. -->
        <div
          data-testid="countdown"
          class="text-[15px] font-semibold leading-none whitespace-nowrap"
          :class="numberClass(item.card)"
        >{{ item.card.lead }}</div>

        <!-- One footnote slot, in priority order: what's wrong with this run,
             else the timetable it beat, else just the clock. Keeping it to a
             single line is what lets every chip share one width. -->
        <div data-testid="footnote" class="text-[10px] leading-none whitespace-nowrap">
          <span
            v-if="status(item.card).word"
            class="font-semibold"
            :class="status(item.card).tone"
          >{{ status(item.card).word }}</span>
          <template v-else-if="item.card.sub">
            <span
              v-if="item.card.scheduledSub"
              class="line-through text-muted-foreground/50 mr-0.5"
            >{{ item.card.scheduledSub }}</span><span
              :class="clockClass(item.card)"
            >{{ item.card.sub }}</span>
          </template>
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
