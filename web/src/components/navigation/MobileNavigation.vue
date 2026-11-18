<script setup lang="ts">
import { computed, ref, watch, provide } from 'vue'
import { useRoute } from 'vue-router'
import { AppRoute } from '@/router'
import { useAppStore } from '@/stores/app.store'
import { Card } from '@/components/ui/card'
import DashboardHome from '@/components/dashboard/DashboardHome.vue'
import BottomSheet from '@/components/sheet/BottomSheet.vue'
import AccountDropdown from '@/components/navigation/AccountDropdown.vue'
import SyncStatus from '@/components/sync/SyncStatus.vue'
import { SheetFooter } from '@/components/sheet'

const route = useRoute()
const appStore = useAppStore()
const activeSnapPoint = ref<number | string | null>(null)
const activeSnapPointIndex = ref<number>(-1)
const cardRef = ref<InstanceType<typeof Card>>()
const dashboardRef = ref<InstanceType<typeof DashboardHome>>()
const paletteFocused = ref(false)
const PEEK_HEIGHT = '65px'
const snapPoints = computed(() =>
  paletteFocused.value ? [PEEK_HEIGHT, 1] : [PEEK_HEIGHT, 0.5, 1],
)

function minimizeSheet() {
  activeSnapPoint.value = PEEK_HEIGHT
}

provide('minimizeMobileSheet', minimizeSheet)

provide('expandMobileSheet', () => {
  activeSnapPoint.value = 1
})

watch(activeSnapPointIndex, index => {
  if (index === 0) dashboardRef.value?.exitSearch()
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

// The middle detent is sized to the library. A routed view opened cold keeps
// the sheet down beneath it.
const startIndex = computed(() =>
  appStore.homeSheetStart === 'library' && !isMapSubview.value ? 1 : 0,
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
    :custom-snap-points="snapPoints"
    :dynamic-peek="!paletteFocused"
    :dynamic-peek-index="1"
    :dismissable="false"
    :z-index-offset="-10"
    :initial-snap-point-index="startIndex"
    v-model:active-snap-point="activeSnapPoint"
    v-model:active-snap-point-index="activeSnapPointIndex"
    class="w-full md:w-104 h-full"
  >
    <Card
      ref="cardRef"
      class="flex flex-col min-h-full p-2 bg-muted shadow-md rounded-b-none border-0"
    >
      <DashboardHome ref="dashboardRef" @update:palette-focused="v => paletteFocused = v" />
    </Card>

    <!-- The recents list below is endless, so the account row is pinned rather
         than parked at the bottom of it — scrolling to the end to reach your
         own account was never going to work. -->
    <SheetFooter
      v-if="!paletteFocused"
      class="relative bg-muted border-t border-border/60 px-3 py-2"
    >
      <div
        class="pointer-events-none absolute inset-x-0 bottom-full h-8 bg-gradient-to-t from-muted to-transparent"
      />
      <div class="mb-1.5 empty:hidden">
        <SyncStatus />
      </div>
      <AccountDropdown @update:open="open => { if (open) minimizeSheet() }" />
    </SheetFooter>
  </bottom-sheet>
</template>
