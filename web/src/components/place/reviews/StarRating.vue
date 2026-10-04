<script setup lang="ts">
import { computed, ref } from 'vue'
import { StarIcon } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    /** 0–1 normalized rating. */
    rating: number
    size?: 'sm' | 'md' | 'lg'
    editable?: boolean
  }>(),
  { size: 'md', editable: false },
)

const emit = defineEmits<{ 'update:rating': [rating: number] }>()

const hovered = ref<number | null>(null)
const filled = computed(() => hovered.value ?? Math.round(props.rating * 5))

const sizeClass = { sm: 'size-3', md: 'size-3.5', lg: 'size-6' }
</script>

<template>
  <div
    class="flex items-center gap-0.5"
    :role="editable ? 'radiogroup' : 'img'"
    :aria-label="`${(rating * 5).toFixed(1)} / 5`"
    @mouseleave="hovered = null"
  >
    <component
      :is="editable ? 'button' : 'span'"
      v-for="i in 5"
      :key="i"
      :type="editable ? 'button' : undefined"
      :role="editable ? 'radio' : undefined"
      :aria-checked="editable ? i === Math.round(rating * 5) : undefined"
      :aria-label="editable ? `${i} / 5` : undefined"
      :class="editable && 'p-0.5 -m-0.5 rounded-sm'"
      @mouseenter="editable && (hovered = i)"
      @click="editable && emit('update:rating', i / 5)"
    >
      <StarIcon
        :class="[
          sizeClass[size],
          i <= filled
            ? 'fill-amber-400 text-amber-400'
            : 'text-muted-foreground/30',
        ]"
      />
    </component>
  </div>
</template>
