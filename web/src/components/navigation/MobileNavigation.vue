<script setup lang="ts">
import { computed, ref, watch, provide } from 'vue'
import { useRoute } from 'vue-router'
import { AppRoute } from '@/router'
import { Card } from '@/components/ui/card'
import DashboardHome from '@/components/dashboard/DashboardHome.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import AccountDropdown from '@/components/navigation/AccountDropdown.vue'

const route = useRoute()
const activeSnapPoint = ref<number | string | null>(null)
const activeSnapPointIndex = ref<number>(-1)
const cardRef = ref<InstanceType<typeof Card>>()
const paletteFocused = ref(false)
const PEEK_HEIGHT = '65px'

const isFullyExpanded = computed(() => activeSnapPointIndex.value === 2)

function minimizeSheet() {
  activeSnapPoint.value = PEEK_HEIGHT
}

provide('minimizeMobileSheet', minimizeSheet)
provide('expandMobileSheet', () => {
  activeSnapPoint.value = 1
})

watch(activeSnapPointIndex, () => {
  const el = (cardRef.value as any)?.$el as HTMLElement | undefined
  const scrollParent = el?.parentElement
  if (scrollParent) {
    scrollParent.scrollTop = 0
  }
})

const isMapSubview = computed(
  () =>
    route.matched.length > 1 &&
    route.name !== AppRoute.MAP &&
    !route.meta.dialog,
)

watch(
  () => route.fullPath,
  () => {
    if (isMapSubview.value) minimizeSheet()
  },
)
</script>

<template>
  <bottom-sheet
    open
    :peek-height="PEEK_HEIGHT"
    :dismissable="false"
    :z-index-offset="-10"
    v-model:active-snap-point="activeSnapPoint"
    v-model:active-snap-point-index="activeSnapPointIndex"
    class="w-full md:w-104 h-full"
  >
    <Card
      ref="cardRef"
      class="flex flex-col min-h-full p-2 bg-muted shadow-md rounded-b-none border-0"
    >
      <DashboardHome @update:palette-focused="v => paletteFocused = v" />

      <div v-show="!paletteFocused" class="mt-auto pt-4 px-1">
        <AccountDropdown @update:open="open => { if (open) minimizeSheet() }" />
      </div>
    </Card>
  </bottom-sheet>
</template>
