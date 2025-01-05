<script setup lang="ts">
import { H5, H6 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
import { Card } from '@/components/ui/card'
import { useI18n } from 'vue-i18n'

interface Props {
  title: string
  description?: string
  frame?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  frame: true,
  msg: () => useI18n().t('message'),
})
</script>

<template>
  <div class="flex flex-col gap-2 w-full">
    <div class="flex justify-between items-center">
      <div>
        <H5>{{ title }}</H5>
        <Caption>{{ description }}</Caption>
      </div>
      <slot name="actions"></slot>
    </div>

    <Card v-if="frame" class="w-full py-3 px-4 flex flex-col gap-4">
      <slot></slot>
    </Card>

    <div v-else class="w-full flex flex-col gap-4 shadow-sm">
      <slot></slot>
    </div>
  </div>
</template>
