<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { BOOKING_BRANDS, type BookingBrand, type BookingBrandKey } from '@/lib/place/booking-brands'

const props = defineProps<{
  brand?: BookingBrandKey | null
  /** A logo image the server supplied, for sellers we have no mark for. */
  src?: string | null
  icon?: Component
  /** Shown in a plain tile when nothing else applies. */
  name?: string
  tone?: 'primary'
}>()

const mark = computed((): BookingBrand | null => (props.brand ? BOOKING_BRANDS[props.brand] : null))
const broken = ref(false)
watch(() => props.src, () => (broken.value = false))
</script>

<template>
  <svg
    v-if="mark"
    viewBox="0 0 20 20"
    class="size-5 shrink-0 rounded ring-1 ring-inset ring-black/5 dark:ring-white/10"
    aria-hidden="true"
  >
    <rect width="20" height="20" :fill="mark.background" />
    <path v-if="mark.path" :d="mark.path" :fill="mark.foreground" />
    <text
      v-else
      :x="mark.accent ? 9 : 10"
      y="10.5"
      text-anchor="middle"
      dominant-baseline="central"
      font-size="12"
      font-weight="700"
      :fill="mark.foreground"
    >{{ mark.letter }}</text>
    <circle v-if="mark.accent" cx="14.6" cy="13.6" r="1.5" :fill="mark.accent" />
  </svg>
  <img
    v-else-if="src && !broken"
    :src="src"
    alt=""
    referrerpolicy="no-referrer"
    loading="lazy"
    class="size-5 shrink-0 rounded object-contain"
    @error="broken = true"
  />
  <span
    v-else
    class="flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-medium"
    :class="tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
    aria-hidden="true"
  >
    <component :is="icon" v-if="icon" class="size-3.5" />
    <template v-else>{{ name?.charAt(0).toUpperCase() }}</template>
  </span>
</template>
