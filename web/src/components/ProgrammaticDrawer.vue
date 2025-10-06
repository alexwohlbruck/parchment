<script setup lang="ts">
import { ref, onMounted, markRaw } from 'vue'
import BottomSheet from '@/components/BottomSheet.vue'
import type { DrawerOptions } from '@/types/app.types'

const props = defineProps<{
  options: DrawerOptions
  onClose: () => void
}>()

const isOpen = ref(false)

// Mark the component as raw to prevent Vue from making it reactive
const SafeComponent = markRaw(props.options.component)

function handleClose() {
  isOpen.value = false
  props.options.onClose?.()
  props.onClose()
}

function handleSnapPointChange(snapPoint: string) {
  props.options.onSnapPointChange?.(snapPoint)
}

onMounted(() => {
  isOpen.value = true
})
</script>

<template>
  <!-- <BottomSheet
    v-model:open="isOpen"
    :peek-height="options.peekHeight"
    :disable-swipe-close="options.disableSwipeClose"
    @close="handleClose"
    @snap-point-change="handleSnapPointChange"
  >
    <SafeComponent v-bind="options.props" />
  </BottomSheet> -->
</template>
