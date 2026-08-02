<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { StarIcon, PhoneIcon, ClockIcon, MapPinIcon } from 'lucide-vue-next'
import type { Place } from '@/types/place.types'
import type { Bookmark } from '@/types/library.types'
import {
  placeToDisplay,
  bookmarkToDisplay,
  type PlaceDisplay,
} from '@/lib/place-display'
import { usePlaceService } from '@/services/place.service'
import { useThemeStore } from '@/stores/theme.store'
import { ItemIcon } from '@/components/ui/item-icon'

/**
 * The single surface for rendering a place anywhere in the app.
 *
 * Takes any place-like record — a `Place`, a saved `Bookmark`, or a
 * pre-adapted `PlaceDisplay` — and renders it at one of four shapes:
 *
 *  - `row`    full-width card; search results, saved lists, related places
 *  - `tile`   fixed-width card for horizontal scrollers (set the width via `class`)
 *  - `inline` borderless, for embedding inside another card (trip timelines)
 *  - `chip`   single-line pill
 *
 * `size` scales the icon, type and padding together; `density` decides how many
 * detail lines appear. The two are independent — a large icon with one line of
 * text is as valid as a small icon with the full detail stack.
 */
const props = withDefaults(
  defineProps<{
    place?: Place
    bookmark?: Bookmark
    /** Pre-adapted record, for sources that are neither a Place nor a Bookmark. */
    display?: PlaceDisplay

    variant?: 'row' | 'tile' | 'inline' | 'chip'
    size?: 'xs' | 'sm' | 'md' | 'lg'
    /**
     * How much detail to show.
     *  - `compact` title plus a single best-available subtitle
     *  - `default` title, type/hours, address
     *  - `rich`    everything the record has, including rating and phone
     */
    density?: 'compact' | 'default' | 'rich'

    showIcon?: boolean
    iconVariant?: 'solid' | 'ghost'
    iconShape?: 'circle' | 'square'
    /** Navigate to the place detail view on click. */
    navigate?: boolean
    /**
     * Root element when the card doesn't navigate. Use `button` where the card
     * performs an action rather than going somewhere — but not when the card
     * holds its own controls, since a nested button is invalid markup.
     */
    as?: string
    /** Overrides the derived title. */
    title?: string
    /**
     * Replaces every derived detail line with a single line of text. Passing an
     * empty string is meaningful: it claims the detail area and leaves it blank,
     * rather than falling back to the derived lines.
     */
    subtitle?: string
  }>(),
  {
    variant: 'row',
    size: 'sm',
    density: 'default',
    showIcon: true,
    iconVariant: 'solid',
    iconShape: 'circle',
    navigate: true,
    as: 'div',
  },
)

const emit = defineEmits<{
  click: [display: PlaceDisplay]
}>()

const { t } = useI18n()
const themeStore = useThemeStore()
const { setPartialPlace } = usePlaceService()

const item = computed<PlaceDisplay>(() => {
  const base = props.display
    ? props.display
    : props.bookmark
      ? bookmarkToDisplay(props.bookmark)
      : placeToDisplay(props.place!, { isDark: themeStore.isDark, t })

  return props.title ? { ...base, title: props.title } : base
})

// ── Scale ─────────────────────────────────────────────────────────────────

/**
 * Icon sizes come in pairs because the icon should match the height of the text
 * beside it, not the `size` prop alone. A title-only row is roughly one line
 * tall, so it takes the smaller icon; add detail lines and the block grows and
 * the icon steps up to match. Sizing the icon off `size` alone is what made
 * one-line rows 56px tall with a 40px icon floating next to a 19px title.
 */
const SIZES = {
  xs: {
    icon: 'xs',
    iconWithDetails: 'sm',
    title: 'text-xs font-medium',
    detail: 'text-[11px]',
    gap: 'gap-1.5',
    padding: 'px-1.5 py-1.5',
    chipPadding: 'pl-0.5 pr-2 py-0.5',
    detailIcon: 'size-2.5',
  },
  sm: {
    icon: 'sm',
    iconWithDetails: 'sm',
    title: 'text-sm font-semibold',
    detail: 'text-xs',
    gap: 'gap-2',
    padding: 'px-2 py-2',
    chipPadding: 'pl-1 pr-2.5 py-1',
    detailIcon: 'size-3',
  },
  md: {
    // A detailed `md` row is typically title + one line (~38px), which the
    // 40px icon would overhang — so both cases anchor on 32.
    icon: 'sm',
    iconWithDetails: 'sm',
    title: 'text-sm font-semibold',
    detail: 'text-xs',
    gap: 'gap-2.5',
    padding: 'px-2.5 py-2',
    chipPadding: 'pl-1 pr-3 py-1',
    detailIcon: 'size-3',
  },
  lg: {
    icon: 'md',
    iconWithDetails: 'lg',
    title: 'text-base font-semibold',
    detail: 'text-sm',
    gap: 'gap-3',
    padding: 'p-3',
    chipPadding: 'pl-1.5 pr-3.5 py-1.5',
    detailIcon: 'size-3.5',
  },
} as const

const scale = computed(() => SIZES[props.size])

// ── Which lines render ────────────────────────────────────────────────────

const isChip = computed(() => props.variant === 'chip')

/** The one line `compact` shows: the most identifying detail available. */
const primaryDetail = computed(
  () => item.value.placeType || item.value.address || item.value.summary,
)

const showHoursRow = computed(
  () =>
    !isChip.value &&
    props.density !== 'compact' &&
    (!!item.value.placeType || !!item.value.openState || !!item.value.hoursText),
)
const showAddress = computed(
  () => !isChip.value && props.density !== 'compact' && !!item.value.address,
)
const showSummary = computed(
  () => !isChip.value && props.density === 'rich' && !!item.value.summary,
)
const showPhone = computed(
  () => !isChip.value && props.density === 'rich' && !!item.value.phone,
)
const showRating = computed(
  () => !isChip.value && props.density === 'rich' && item.value.rating !== null,
)
const showPrimaryDetail = computed(
  () =>
    !isChip.value && props.density === 'compact' && !!primaryDetail.value,
)

const formattedRating = computed(() => item.value.rating?.toFixed(1) ?? null)

/** Every detail line this card will actually render, in order. */
const detailLines = computed(() => [
  showPrimaryDetail.value,
  showHoursRow.value,
  showSummary.value,
  showAddress.value,
  showPhone.value,
])

/** A title on its own — no detail lines — sits beside the smaller icon. */
const isTitleOnly = computed(() =>
  props.subtitle !== undefined
    ? !props.subtitle
    : !detailLines.value.some(Boolean),
)

const iconSize = computed(() =>
  isTitleOnly.value ? scale.value.icon : scale.value.iconWithDetails,
)

/**
 * Several lines push the block well past the icon, so the icon top-aligns
 * rather than centring against a tall stack. A `subtitle` override collapses
 * the whole detail area to one line, however many the record could fill.
 */
const isMultiline = computed(() =>
  props.subtitle !== undefined
    ? false
    : detailLines.value.filter(Boolean).length > 1,
)

// ── Surface ───────────────────────────────────────────────────────────────

const SURFACES = {
  row: 'w-full rounded-xl border bg-card',
  tile: 'shrink-0 rounded-xl border bg-card',
  inline: 'w-full rounded-lg bg-muted/40',
  chip: 'rounded-full border bg-background',
} as const

const isInteractive = computed(
  () => props.navigate && !!item.value.route,
)

const hoverClass = computed(() => {
  if (!isInteractive.value) return ''
  return props.variant === 'inline'
    ? 'hover:bg-muted/70 cursor-pointer'
    : 'hover:bg-secondary/40 cursor-pointer'
})

/**
 * A real link when it navigates, so middle-click and copy-link behave — a
 * `router.push` handler would swallow both.
 */
const rootTag = computed(() => (isInteractive.value ? RouterLink : props.as))

function onClick() {
  // Seed the detail view with the record already in hand so it renders
  // immediately rather than blocking on a refetch. Essential for geocoder
  // results, which have no stored record to re-fetch at all.
  if (props.place) setPartialPlace(props.place)
  emit('click', item.value)
}
</script>

<template>
  <component
    :is="rootTag"
    :to="isInteractive ? item.route : undefined"
    :type="rootTag === 'button' ? 'button' : undefined"
    class="transition-colors no-underline text-inherit text-left"
    :class="[
      SURFACES[variant],
      hoverClass,
      isChip ? `inline-flex items-center ${scale.chipPadding} ${scale.gap}` : `block ${scale.padding}`,
    ]"
    @click="onClick"
  >
    <div
      v-if="!isChip"
      class="flex"
      :class="[scale.gap, isMultiline ? 'items-start' : 'items-center']"
    >
      <slot name="icon">
        <ItemIcon
          v-if="showIcon"
          :icon="item.icon"
          :icon-pack="item.iconPack"
          :color="item.color"
          :custom-color="item.customColor"
          :image-url="item.imageUrl ?? undefined"
          :size="iconSize"
          :variant="iconVariant"
          :shape="iconShape"
          class="shrink-0"
          :class="isMultiline ? 'mt-0.5' : ''"
        />
      </slot>

      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <!-- Title, with the rating pinned opposite it -->
        <div class="flex items-center justify-between gap-2">
          <span
            class="text-foreground leading-snug truncate"
            :class="scale.title"
          >
            {{ item.title }}
          </span>
          <div v-if="showRating" class="flex items-center gap-1 shrink-0">
            <StarIcon :class="scale.detailIcon" class="text-amber-500 fill-amber-500" />
            <span class="text-xs font-medium text-foreground">{{ formattedRating }}</span>
            <span v-if="item.reviewCount" class="text-xs text-muted-foreground">
              ({{ item.reviewCount.toLocaleString() }})
            </span>
          </div>
        </div>

        <slot name="details">
          <!-- An explicit subtitle stands in for every derived line -->
          <div
            v-if="subtitle !== undefined"
            v-show="subtitle"
            class="text-muted-foreground leading-snug truncate"
            :class="scale.detail"
          >
            {{ subtitle }}
          </div>

          <template v-else>
            <div
              v-if="showPrimaryDetail"
              class="text-muted-foreground leading-snug truncate"
              :class="scale.detail"
            >
              {{ primaryDetail }}
            </div>

            <!-- Type and opening state share a line: both answer "what is this" -->
            <div
              v-if="showHoursRow"
              class="flex items-center gap-2 text-muted-foreground"
              :class="scale.detail"
            >
              <span v-if="item.placeType">{{ item.placeType }}</span>
              <span
                v-if="item.openState || item.hoursText"
                class="flex items-center gap-1"
                :class="
                  item.openState === 'open'
                    ? 'text-forest-600'
                    : item.openState === 'closed'
                      ? 'text-coral-500'
                      : 'text-muted-foreground'
                "
              >
                <ClockIcon :class="scale.detailIcon" class="shrink-0" />
                <span v-if="item.openState === 'open'">{{ t('place.listItem.openNow') }}</span>
                <span v-else-if="item.openState === 'closed'">{{ t('place.hours.closed') }}</span>
                <span v-if="item.hoursText">{{ item.hoursText }}</span>
              </span>
            </div>

            <div
              v-if="showSummary"
              class="text-muted-foreground leading-snug"
              :class="scale.detail"
            >
              {{ item.summary }}
            </div>

            <!-- The pin only earns its space at `rich`, where the address has
                 to be told apart from the summary and phone lines. On its own
                 it is unambiguous, and the glyph just eats width the address
                 needs. -->
            <div
              v-if="showAddress"
              class="flex items-start gap-1.5 text-muted-foreground"
              :class="scale.detail"
            >
              <MapPinIcon
                v-if="density === 'rich'"
                :class="scale.detailIcon"
                class="shrink-0 mt-[1px]"
              />
              <span class="truncate">{{ item.address }}</span>
            </div>

            <div
              v-if="showPhone"
              class="flex items-center gap-1.5 text-muted-foreground"
              :class="scale.detail"
            >
              <PhoneIcon :class="scale.detailIcon" class="shrink-0" />
              <span>{{ item.phone }}</span>
            </div>
          </template>
        </slot>
      </div>

      <slot name="trailing" />
    </div>

    <!-- Chip: icon and title only, on one line -->
    <template v-else>
      <ItemIcon
        v-if="showIcon"
        :icon="item.icon"
        :icon-pack="item.iconPack"
        :color="item.color"
        :custom-color="item.customColor"
        :image-url="item.imageUrl ?? undefined"
        :size="scale.icon"
        :variant="iconVariant"
        shape="circle"
        class="shrink-0 shadow-sm"
      />
      <span class="whitespace-nowrap" :class="scale.title">{{ item.title }}</span>
      <slot name="trailing" />
    </template>
  </component>
</template>
