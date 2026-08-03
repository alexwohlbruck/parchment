<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
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
import { ItemRow, ITEM_ROW_SIZES } from '@/components/ui/item-row'

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

const scale = computed(() => ITEM_ROW_SIZES[props.size])

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

function onClick() {
  // Seed the detail view with the record already in hand so it renders
  // immediately rather than blocking on a refetch. Essential for geocoder
  // results, which have no stored record to re-fetch at all.
  if (props.place) setPartialPlace(props.place)
  emit('click', item.value)
}
</script>

<template>
  <ItemRow
    :title="item.title"
    :variant="variant"
    :size="size"
    :to="navigate ? item.route : null"
    :as="as"
    :has-details="!isTitleOnly"
    :multiline="isMultiline"
    :interactive="!navigate && !!$attrs.onClick"
    @click="onClick"
  >
    <template #icon="{ size: iconScale }">
      <ItemIcon
        v-if="showIcon"
        :icon="item.icon"
        :icon-pack="item.iconPack"
        :color="item.color"
        :custom-color="item.customColor"
        :image-url="item.imageUrl ?? undefined"
        :size="iconScale"
        :variant="iconVariant"
        :shape="iconShape"
        class="shrink-0"
        :class="isMultiline ? 'mt-0.5' : ''"
      />
    </template>

    <!-- Rating sits opposite the title rather than in the detail stack -->
    <template v-if="showRating" #title-trailing>
      <div class="flex items-center gap-1 shrink-0">
        <StarIcon :class="scale.detailIcon" class="text-amber-500 fill-amber-500" />
        <span class="text-xs font-medium text-foreground">{{ formattedRating }}</span>
        <span v-if="item.reviewCount" class="text-xs text-muted-foreground">
          ({{ item.reviewCount.toLocaleString() }})
        </span>
      </div>
    </template>

    <template #details>
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

          <div
            v-if="showAddress"
            class="flex items-start gap-1.5 text-muted-foreground"
            :class="scale.detail"
          >
            <MapPinIcon :class="scale.detailIcon" class="shrink-0 mt-[1px]" />
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
    </template>

    <template #trailing>
      <slot name="trailing" />
    </template>
  </ItemRow>
</template>
