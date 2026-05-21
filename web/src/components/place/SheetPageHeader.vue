<script setup lang="ts">
import { ArrowLeftIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useSheetPage } from '@/composables/useSheetPage'

defineProps<{
  title: string
}>()

const { popPage } = useSheetPage()
</script>

<template>
  <div class="flex items-center gap-2 mb-3">
    <Button
      variant="ghost"
      size="icon-sm"
      class="rounded-full shrink-0"
      @click="popPage"
    >
      <ArrowLeftIcon class="size-4" />
    </Button>
    <h2 class="text-base font-semibold truncate">{{ title }}</h2>
  </div>
</template>
