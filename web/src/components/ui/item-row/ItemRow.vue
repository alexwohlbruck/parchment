<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import {
  ITEM_ROW_SIZES,
  ITEM_ROW_SURFACES,
  type ItemRowSize,
  type ItemRowVariant,
} from './scale'

/**
 * The app's icon + title + details row: one surface, one scale, one set of
 * interaction rules, for every entity that lists like this — places,
 * collections, routes, trackers, layers, friends.
 *
 * It owns the chrome and the layout; what goes in the icon, detail and
 * trailing areas is the caller's. `PlaceCard` is the place-flavoured wrapper
 * over it and is worth reading as the reference usage.
 */
const props = withDefaults(
  defineProps<{
    title: string
    variant?: ItemRowVariant
    size?: ItemRowSize
    /** Route to navigate to; makes the row a real link. */
    to?: RouteLocationRaw | null
    /** Root element when the row doesn't navigate. Use `button` when it
        performs an action — but not when it holds its own controls, since a
        nested button is invalid markup. */
    as?: string
    /**
     * Whether any detail line renders. Steps the icon up to match the taller
     * text block — distinct from `multiline`, which is about alignment: a row
     * with exactly one detail line takes the bigger icon but still centres.
     */
    hasDetails?: boolean
    /** Top-align the icon, for two or more detail lines. */
    multiline?: boolean
    /** Adds hover affordance without a route, for a row wired to `click`. */
    interactive?: boolean
  }>(),
  {
    variant: 'row',
    size: 'sm',
    as: 'div',
    hasDetails: false,
    multiline: false,
    interactive: false,
  },
)

defineEmits<{ click: [] }>()

const scale = computed(() => ITEM_ROW_SIZES[props.size])
const isChip = computed(() => props.variant === 'chip')
const isLink = computed(() => !!props.to)

const hoverClass = computed(() => {
  if (!isLink.value && !props.interactive) return ''
  return props.variant === 'inline'
    ? 'hover:bg-muted/70 cursor-pointer'
    : 'hover:bg-secondary/40 cursor-pointer'
})

/**
 * A real link when it navigates, so middle-click and copy-link behave — a
 * `router.push` handler would swallow both.
 */
const rootTag = computed(() => (isLink.value ? RouterLink : props.as))

defineExpose({ scale })
</script>

<template>
  <component
    :is="rootTag"
    :to="to ?? undefined"
    :type="rootTag === 'button' ? 'button' : undefined"
    class="transition-colors no-underline text-inherit text-left"
    :class="[
      ITEM_ROW_SURFACES[variant],
      hoverClass,
      isChip
        ? `inline-flex items-center ${scale.chipPadding} ${scale.gap}`
        : `block ${scale.padding}`,
    ]"
    @click="$emit('click')"
  >
    <!-- Chip: icon and title on one line, no detail area -->
    <template v-if="isChip">
      <slot name="icon" :size="scale.icon" />
      <span class="whitespace-nowrap" :class="scale.title">{{ title }}</span>
      <slot name="trailing" />
    </template>

    <div
      v-else
      class="flex"
      :class="[scale.gap, multiline ? 'items-start' : 'items-center']"
    >
      <slot name="icon" :size="hasDetails ? scale.iconWithDetails : scale.icon" />

      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-foreground leading-snug truncate" :class="scale.title">
            {{ title }}
          </span>
          <slot name="title-trailing" />
        </div>
        <slot name="details" :detail-class="scale.detail" :icon-class="scale.detailIcon" />
      </div>

      <slot name="trailing" />
    </div>
  </component>
</template>
