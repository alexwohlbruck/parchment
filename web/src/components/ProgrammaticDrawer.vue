<script setup lang="ts">
import { ref, onMounted, markRaw, watch } from 'vue'
import BottomSheet from '@/components/BottomSheet.vue'
import type { DrawerOptions } from '@/types/app.types'

const props = defineProps<{
  options: DrawerOptions
  onClose: () => void
}>()

const isOpen = ref(false)

// Mark the component as raw to prevent Vue from making it reactive
const SafeComponent = markRaw(props.options.component)

function handleSnapPointChange(snapPoint: string) {
  props.options.onSnapPointChange?.(snapPoint)
}

// Watch for drawer close
watch(isOpen, (open) => {
  if (!open) {
    props.options.onClose?.()
    props.onClose()
  }
})

onMounted(() => {
  isOpen.value = true
})
</script>

<template>
  <!-- <BottomSheet
    v-model:open="isOpen"
    :peek-height="options.peekHeight"
    :dismissable="options.dismissable"
    @snap-point-change="handleSnapPointChange"
  >
    <SafeComponent v-bind="options.props" />
  </BottomSheet> -->
</template>
