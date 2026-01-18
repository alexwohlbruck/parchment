<script setup lang="ts">
import { computed, ref, watch, provide, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Card } from '@/components/ui/card'
import Palette from '@/components/palette/Palette.vue'
import DashboardHome from '@/components/dashboard/DashboardHome.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { Button } from '@/components/ui/button'
import AccountDropdown from '@/components/navigation/AccountDropdown.vue'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const activeSnapPoint = ref<number | string | null>(null)
const activeSnapPointIndex = ref<number>(-1)
const paletteRef = ref<InstanceType<typeof Palette>>()
const PEEK_HEIGHT = '65px'

const isFullyExpanded = computed(() => activeSnapPointIndex.value === 2)

function minimizeSheet() {
  activeSnapPoint.value = PEEK_HEIGHT
}

// Provide minimize function to child components
provide('minimizeMobileSheet', minimizeSheet)

function handlePaletteInputFocused() {
  activeSnapPoint.value = 1 // Fully expand the drawer
}

watch(isFullyExpanded, newVal => {
  if (!newVal) {
    paletteRef.value?.resetPalette()
  }
})

function test() {
  console.log('test')
}
</script>

<template>
  <bottom-sheet
    open
    :peek-height="PEEK_HEIGHT"
    :dismissable="false"
    :trackObstructing="false"
    v-model:active-snap-point="activeSnapPoint"
    v-model:active-snap-point-index="activeSnapPointIndex"
    class="z-50 w-full md:w-104 h-full"
  >
    <!-- <Button @click="test">test</Button> -->
    <Card
      class="flex flex-col min-h-full p-2 bg-muted shadow-md rounded-b-none border-0"
    >
      <div class="relative">
        <Palette
          ref="paletteRef"
          @input-focused="handlePaletteInputFocused"
          search-on-open
        />
      </div>

      <TransitionFade>
        <DashboardHome v-if="activeSnapPointIndex !== 0" />
      </TransitionFade>

      <!-- Account dropdown at the bottom when expanded -->
      <div v-if="activeSnapPointIndex !== 0" class="mt-auto pt-4 px-1">
        <AccountDropdown />
      </div>
    </Card>
  </bottom-sheet>
</template>
