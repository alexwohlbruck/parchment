<script setup lang="ts">
import { H5, H6 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
import { Card } from '@/components/ui/card'

interface Props {
  title: string
  description?: string
}

defineProps<Props>()
</script>

<template>
  <div class="flex flex-col gap-2 w-full">
    <div>
      <H5>{{ title }}</H5>
      <Caption>{{ description }}</Caption>
    </div>

    <Card class="w-full py-3 px-4 flex flex-col gap-4">
      <slot></slot>
    </Card>
  </div>
</template>
