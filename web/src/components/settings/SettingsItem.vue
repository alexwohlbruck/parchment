<script setup lang="ts">
import H6 from '@/components/ui/typography/H6.vue'
import Caption from '@/components/ui/typography/Caption.vue'

interface Props {
  title: string
  description?: string
}

defineProps<Props>()
</script>

<template>
  <div class="flex justify-between items-center">
    <div>
      <H6>{{ title }}</H6>
      <Caption v-if="description">
        {{ description }}
      </Caption>
    </div>
    <slot></slot>
  </div>
</template>
